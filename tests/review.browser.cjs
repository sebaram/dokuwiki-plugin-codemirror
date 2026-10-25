const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
(async () => {
    const browser = await chromium.launch({headless: true,
        executablePath: process.env.CHROMIUM_EXECUTABLE || undefined});
    try {
        const page = await browser.newPage({viewport: {width: 1100, height: 800}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<form><textarea id="wiki__text"></textarea></form>');
        await page.addStyleTag({path: require.resolve('codemirror/lib/codemirror.css')});
        await page.addScriptTag({path: require.resolve('codemirror/lib/codemirror.js')});
        if (fs.existsSync(path.join(root, 'review.js'))) await page.addScriptTag({path: path.join(root, 'review.js')});
        assert.equal(await page.evaluate(() => typeof window.CodeMirrorAIReview?.show), 'function',
            'Inline review controls must exist');
        await page.evaluate(() => {
            window.field = document.getElementById('wiki__text');
            window.cm = CodeMirror.fromTextArea(field);
            cm.on('change', () => cm.save());
            window.base = 'Before\n😀 red.\nKeep this line.\nblue.\nAfter';
            window.parts = [
                {type: 'equal', text: '😀 '}, {type: 'delete', text: 'red'},
                {type: 'insert', text: 'green'}, {type: 'equal', text: '.\nKeep this line.\n'},
                {type: 'delete', text: 'blue'}, {type: 'insert', text: 'gold'},
                {type: 'equal', text: '.'}
            ];
            window.openReview = () => {
                cm.setValue(base); cm.clearHistory();
                window.review = CodeMirrorAIReview.show(field, {snapshot: base, from: 7, to: base.indexOf('\nAfter'), parts,
                    onState: state => window.reviewState = state});
            };
            openReview();
        });
        assert.equal(await page.locator('#wiki__text').inputValue(), 'Before\n😀 red.\nKeep this line.\nblue.\nAfter');
        assert.equal(await page.locator('.cm-ai-chunk').count(), 2);
        assert(await page.evaluate(() => field.nextElementSibling.CodeMirror === cm), 'Review must preserve the native textarea/CodeMirror adjacency used by save-position helpers');
        await page.evaluate(() => review.accept(1));
        assert.equal(await page.locator('#wiki__text').inputValue(), 'Before\n😀 red.\nKeep this line.\ngold.\nAfter');
        await page.evaluate(() => review.accept(0));
        assert.equal(await page.locator('#wiki__text').inputValue(), 'Before\n😀 green.\nKeep this line.\ngold.\nAfter');
        await page.evaluate(() => cm.undo());
        assert.equal(await page.locator('#wiki__text').inputValue(), 'Before\n😀 red.\nKeep this line.\ngold.\nAfter');
        await page.evaluate(() => {openReview(); review.acceptAll(); cm.undo();});
        assert.equal(await page.locator('#wiki__text').inputValue(), 'Before\n😀 red.\nKeep this line.\nblue.\nAfter');
        await page.evaluate(() => {openReview(); review.rejectAll();});
        assert.equal(await page.locator('#wiki__text').inputValue(), 'Before\n😀 red.\nKeep this line.\nblue.\nAfter');
        await page.evaluate(() => {openReview(); cm.replaceRange('X', {line: 0, ch: 0}); review.acceptAll();});
        assert.equal(await page.locator('#wiki__text').inputValue(), 'XBefore\n😀 red.\nKeep this line.\nblue.\nAfter');
        assert.equal(await page.evaluate(() => reviewState.stale), true);
        assert.equal(await page.locator('.cm-ai-chunk').count(), 0);
        await page.evaluate(() => {
            window.batchOriginal = 'red one\nblue two\nKEEP\nold';
            cm.setValue(batchOriginal); cm.clearHistory();
            window.openBatch = () => window.review = CodeMirrorAIReview.show(field, {snapshot: batchOriginal, from: 0, to: batchOriginal.length, parts: [
                {type: 'delete', text: 'red'}, {type: 'insert', text: 'green'}, {type: 'equal', text: ' one\n'},
                {type: 'delete', text: 'blue'}, {type: 'insert', text: 'gold'}, {type: 'equal', text: ' two\nKEEP\n'},
                {type: 'delete', text: 'old'}, {type: 'insert', text: 'new'}
            ]});
            openBatch();
        });
        assert.equal(await page.locator('.cm-ai-chunk').count(), 2, 'Adjacent changed lines share one batch; an unchanged line separates batches');
        await page.locator('.cm-ai-chunk').first().getByRole('button', {name: 'Accept', exact: true}).click();
        assert.equal(await page.locator('#wiki__text').inputValue(), 'green one\ngold two\nKEEP\nold');
        await page.evaluate(() => cm.undo());
        assert.equal(await page.locator('#wiki__text').inputValue(), 'red one\nblue two\nKEEP\nold', 'One Undo restores the entire accepted multiline batch');
        assert.equal(await page.locator('.cm-ai-chunk').count(), 0, 'Undo invalidates remaining stale batches');
        await page.evaluate(() => {openBatch(); review.reject(0); review.accept(1);});
        assert.equal(await page.locator('#wiki__text').inputValue(), 'red one\nblue two\nKEEP\nnew', 'Rejecting a batch preserves all its lines');
        for (const newline of ['\r\n', '\r']) {
            await page.evaluate(newline => {
                cm.setValue('red\nKEEP\nblue END'); cm.clearHistory();
                window.review = CodeMirrorAIReview.show(field, {snapshot: cm.getValue(), from: 0, to: cm.getValue().length, parts: [
                    {type: 'delete', text: 'red'}, {type: 'insert', text: 'green' + newline + 'text'},
                    {type: 'equal', text: '\nKEEP\n'}, {type: 'delete', text: 'blue'},
                    {type: 'insert', text: 'gold'}, {type: 'equal', text: ' END'}
                ]});
                review.accept(0); review.accept(1);
            }, newline);
            assert.equal(await page.locator('#wiki__text').inputValue(), 'green\ntext\nKEEP\ngold END',
                'Partial acceptance must use normalized newline offsets and preserve surrounding source');
            await page.evaluate(() => cm.undo());
            assert.equal(await page.locator('#wiki__text').inputValue(), 'green\ntext\nKEEP\nblue END');
            await page.evaluate(() => cm.undo());
            assert.equal(await page.locator('#wiki__text').inputValue(), 'red\nKEEP\nblue END');
        }
        await page.evaluate(() => {
            openReview(); field.dispatchEvent(new CustomEvent('codemirror:destroy'));
        });
        assert.equal(await page.locator('.cm-ai-review').count(), 0);
        assert.deepEqual(errors, []);
        console.log('PASS real CodeMirror inline review, partial offsets, Accept/Reject, Undo and stale lifecycle');
    } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
