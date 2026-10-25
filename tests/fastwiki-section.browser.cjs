// Catches section edits replacing surrounding text, lost AI selections, and stale AJAX editors.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.CODEMIRROR_TEST_URL || 'http://127.0.0.1:18960';
const origin = new URL(base);
assert(['localhost', '127.0.0.1'].includes(origin.hostname) ||
    (process.env.CODEMIRROR_ALLOW_PUBLIC_TEST === '1' && origin.protocol === 'https:' && origin.hostname.endsWith('.trycloudflare.com')));
const output = process.env.CODEMIRROR_TEST_OUTPUT || '/tmp/codemirror-section-browser';
const root = process.env.CODEMIRROR_TEST_ROOT || '/tmp/aiassist-extension-mirror/wiki';
const id = 'codemirror_block_test_' + Date.now();
const pageFile = path.join(root, 'data/pages', id + '.txt');
const source = '====== Fastwiki and AI editing lab ======\n\nIntro sentinel 한국어.\n\n' +
    '===== First block =====\n\nFIRST SENTINEL 그대로 유지.\n\n<code javascript>\nconst answer = 42;\n</code>\n\n' +
    '===== AI target block =====\n\nSelect exactly this sentence for AI.\n\nMiddle content stays here.\n\n' +
    '<code python>\ndef hello():\n    return "안녕하세요"\n</code>\n\n' +
    '===== Last block =====\n\nLAST SENTINEL 끝 문장.\n';
const checks = [], errors = [], results = {url: base + '/doku.php?id=' + id, checks, errors};
fs.mkdirSync(output, {recursive: true});
assert(!fs.existsSync(pageFile), 'Only create a fresh disposable page');

(async () => {
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined});
    const context = await browser.newContext({viewport: {width: 1440, height: 1100}});
    await context.route('**/*', route => new URL(route.request().url()).hostname === origin.hostname ? route.continue() : route.abort());
    const page = await context.newPage();
    let sectionRequests = 0;
    page.on('request', request => {
        const data = new URLSearchParams(request.postData() || '');
        if (request.method() === 'POST' && data.get('partial') === '1' &&
            data.get('do') === 'edit' && data.has('range')) sectionRequests += 1;
    });
    page.on('pageerror', error => errors.push(error.stack));
    page.on('dialog', dialog => dialog.accept());
    const cm = () => page.locator('.CodeMirror');
    const current = () => cm().evaluate(node => node.CodeMirror.getValue());
    const disk = () => fs.readFileSync(pageFile, 'utf8');
    const pass = message => {checks.push(message); console.log('PASS ' + message);};
    async function selectText(text) {
        await cm().evaluate((node, text) => {
            const editor = node.CodeMirror, doc = editor.getDoc(), offset = doc.getValue().indexOf(text);
            if (offset < 0) throw new Error('Selection text not found: ' + text);
            doc.setSelection(doc.posFromIndex(offset), doc.posFromIndex(offset + text.length)); editor.focus();
        }, text);
    }
    async function requestAI(command) {
        await page.locator('.aiassist_button').click();
        await page.locator('#aiassist-command').fill(command);
        await page.locator('#aiassist-profile-select').selectOption({index: 1});
        const response = page.waitForResponse(response => response.request().method() === 'POST' &&
            (response.request().postData() || '').includes('selected_text'));
        await page.locator('#aiassist-run').click();
        assert.equal((await response).status(), 200);
        await page.locator('#aiassist-card[data-state=result]').waitFor();
    }
    async function openTargetBlock() {
        const before = sectionRequests;
        const marker = await page.evaluate(() => {window.sectionTestMarker = Math.random(); return window.sectionTestMarker;});
        await page.locator('.editbutton_section').filter({has: page.locator('input[name=summary][value="[AI target block] "]')}).locator('button').click();
        await cm().waitFor();
        assert.equal(await page.evaluate(() => window.sectionTestMarker), marker, 'Section edit should stay on the current page');
        assert.equal(sectionRequests, before + 1, 'One section click must issue exactly one AJAX edit request');
        assert(await page.locator('.content_initial').isVisible());
        assert(!(await current()).includes('FIRST SENTINEL'));
        assert(!(await current()).includes('LAST SENTINEL'));
        assert((await current()).startsWith('===== AI target block ====='));
        return marker;
    }
    try {
        await page.goto(base + '/doku.php?do=login');
        await page.locator('[name=u]').fill('editor');
        await page.locator('[name=p]').fill('local-editor-password');
        await page.locator('#dw__login button[type=submit]').click();
        await page.goto(base + '/doku.php?id=' + id + '&do=edit');
        await cm().waitFor();
        await cm().evaluate((node, text) => node.CodeMirror.setValue(text), source);
        await selectText('Middle content stays here.');
        await page.keyboard.type('Middle content typed in CodeMirror.');
        assert.equal(await page.locator('#wiki__text').inputValue(), source.replace('Middle content stays here.', 'Middle content typed in CodeMirror.'));
        await cm().evaluate(node => node.CodeMirror.undo());
        assert.equal(await current(), source);
        pass('Real keyboard editing synchronizes the textarea and supports undo');

        await selectText('Select exactly this sentence for AI.');
        await page.waitForTimeout(10100);
        await requestAI('Make this selected sentence concise.');
        assert.equal(await current(), source, 'AI generation must not modify the source before Apply');
        const generated = await page.locator('#aiassist-result-edit').inputValue();
        assert(generated.trim());
        await page.screenshot({path: path.join(output, 'full-page-ai-review.png'), fullPage: true});
        await page.locator('#aiassist-apply').click();
        assert.equal(await current(), source.replace('Select exactly this sentence for AI.', generated));
        await cm().evaluate(node => node.CodeMirror.undo());
        assert.equal(await current(), source);
        pass('AI chat on the full editor applies only the selected sentence and can be undone');
        await page.locator('#edit__summary').fill('Seed disposable Fastwiki block-edit test');
        await page.locator('#edbtn__save').click();
        await page.locator('#wiki__text').waitFor({state: 'detached'});
        assert.equal(disk(), source);
        await page.goto(base + '/doku.php/' + id);
        assert(await page.evaluate(() => window.JSINFO.fastwiki.secedit));
        results.sectionButtons = await page.locator('.editbutton_section').count();
        await page.waitForFunction(() => document.querySelector('pre.javascript[data-codemirror-highlighted]'));
        const code = page.locator('pre.javascript');
        assert.equal(await code.evaluate(element => {
            const copy = element.cloneNode(true);
            copy.querySelectorAll('.code-copy-btn').forEach(button => button.remove());
            return copy.textContent;
        }), 'const answer = 42;');
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.evaluate(() => navigator.clipboard.writeText('clipboard sentinel'));
        assert.equal(await code.locator('.code-copy-btn').count(), 1);
        await code.locator('.code-copy-btn').click();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'const answer = 42;');
        pass('Highlighted code preserves its exact source and native Copy button copies only code');

        const marker = await openTargetBlock();
        const section = await current();
        assert.equal(await page.locator('.CodeMirror').count(), 1);
        await selectText('Middle content stays here.');
        await page.keyboard.type('Manual block edit 한국어.');
        assert.equal(await current(), section.replace('Middle content stays here.', 'Manual block edit 한국어.'));
        await page.locator('#edbtn__preview').click();
        await page.locator('#preview_container').waitFor();
        assert.equal(await page.evaluate(() => window.sectionTestMarker), marker);
        assert.equal(disk(), source, 'Preview must not save the page');
        assert((await current()).includes('Manual block edit 한국어.'));
        await page.locator('button[name="do[cancel]"]').click();
        await cm().waitFor({state: 'detached'});
        assert.equal(disk(), source);
        pass('Fastwiki inline block edit, keyboard input, AJAX preview and Cancel preserve the saved page');

        await openTargetBlock();
        const block = await current();
        await selectText('Select exactly this sentence for AI.');
        // Respect the AI Assistant per-user request interval between chat turns.
        await page.waitForTimeout(10100);
        await requestAI('Improve only the selected sentence inside this block.');
        assert.equal(await current(), block);
        await page.locator('#aiassist-retry-command').fill('Refine the wording once more.');
        await page.waitForTimeout(10100);
        const retryResponse = page.waitForResponse(response => response.request().method() === 'POST' &&
            (response.request().postData() || '').includes('selected_text'));
        await page.locator('#aiassist-retry').click();
        assert.equal((await retryResponse).status(), 200);
        await page.locator('#aiassist-card[data-state=result]').waitFor();
        assert.equal(await current(), block);
        await page.locator('#aiassist-result-edit').fill('AI-reviewed block sentence 한국어.');
        await page.screenshot({path: path.join(output, 'fastwiki-block-ai-review.png'), fullPage: true});
        await page.locator('#aiassist-apply').click();
        const expectedBlock = block.replace('Select exactly this sentence for AI.', 'AI-reviewed block sentence 한국어.');
        assert.equal(await current(), expectedBlock);
        await cm().evaluate(node => node.CodeMirror.undo());
        assert.equal(await current(), block);
        await cm().evaluate(node => node.CodeMirror.redo());
        assert.equal(await current(), expectedBlock);
        pass('AI chat works inside a Fastwiki block: selected scope, refinement, reviewed Apply, undo and redo');

        await page.locator('#edbtn__preview').click();
        await page.locator('#preview_container').waitFor();
        assert.equal(await current(), expectedBlock);
        await page.locator('#edit__summary').fill('[AI target block] AI-assisted section test');
        await page.locator('#edbtn__save').click();
        await cm().waitFor({state: 'detached'});
        const expected = source.replace('Select exactly this sentence for AI.', 'AI-reviewed block sentence 한국어.');
        assert.equal(disk(), expected, 'Saving one block must preserve all surrounding UTF-8 page content exactly');
        pass('Saving the AI-edited block preserves the first/last blocks and surrounding UTF-8 source exactly');

        await page.goto(base + '/doku.php/' + id);
        await openTargetBlock();
        assert.equal(await current(), expectedBlock);
        await page.screenshot({path: path.join(output, 'saved-block-reopened.png'), fullPage: true});
        await page.locator('button[name="do[cancel]"]').click();
        await cm().waitFor({state: 'detached'});
        pass('Saved block reopens through Fastwiki with the AI-applied source intact');
        await page.locator('.aiassist-agent-launch').click();
        await page.locator('#aiassist-agent-question').fill('What is the Orbit deployment process?');
        await page.waitForTimeout(10100);
        await page.locator('#aiassist-agent-ask').click();
        await page.locator('#aiassist-agent-answer').waitFor({state: 'visible'});
        assert((await page.locator('#aiassist-agent-answer').innerText()).includes('staging'));
        assert(await page.locator('#aiassist-agent-sources a').count() >= 2);
        assert.equal(disk(), expected, 'Read-only wiki chat must not change the edited page');
        await page.screenshot({path: path.join(output, 'wiki-chat-answer.png'), fullPage: true});
        await page.locator('#aiassist-agent-close').click();
        pass('Ask wiki chat searches and reads wiki sources, shows cited answers, and leaves the page unchanged');
        assert.deepEqual(errors, [], 'Unexpected browser errors');
    } catch (error) {
        results.failure = error.stack;
        await page.screenshot({path: path.join(output, 'failure.png'), fullPage: true});
        throw error;
    } finally {
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
        await browser.close();
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
