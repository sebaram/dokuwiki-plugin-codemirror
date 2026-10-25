// Run only against a disposable loopback wiki with Fastwiki, ProseMirror and AI Assistant.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.CODEMIRROR_TEST_URL || 'http://127.0.0.1:18962';
const output = process.env.CODEMIRROR_TEST_OUTPUT || '/tmp/codemirror-browser';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
fs.mkdirSync(output, {recursive: true});
const checks = [], errors = [], id = process.env.CODEMIRROR_TEST_PAGE || ('codemirror_test_' + Date.now());
const source = '====== CodeMirror compatibility ======\n\n한국어 **bold** and //italic//.\n\n' +
    '> **quoted**\n\n^ Heading ^ Value ^\n| WikiWord | 42 |\n\n  * First item\n\n' +
    '<WRAP center>Plugin content</WRAP>\n{{tag>test}}\n\n' +
    '<code javascript>\nconst answer = 42;\n</code>\n\n' +
    '<file python example.py>\ndef greet(name):\n    return "Hello " + name\n</file>\n';

(async () => {
    const browser = await chromium.launch({headless: true,
        executablePath: process.env.CHROMIUM_EXECUTABLE || undefined});
    const context = await browser.newContext({viewport: {width: 1440, height: 1100}});
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (process.env.CODEMIRROR_TEST_LEGACY_CHAT === '1' && url.pathname.endsWith('/aiassist/chat.js')) return route.abort();
        return ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.stack));
    page.on('dialog', dialog => dialog.accept());
    async function ready() {await page.locator('.CodeMirror').waitFor();}
    async function setText(text) {
        await ready();
        await page.evaluate(text => document.querySelector('.CodeMirror').CodeMirror.setValue(text), text);
    }
    async function text() {return page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());}
    function pass(message) {checks.push(message); console.log('PASS ' + message);}
    try {
        await page.goto(base + '/doku.php?do=login');
        await page.locator('[name=u]').fill(process.env.CODEMIRROR_TEST_USER || 'admin');
        await page.locator('[name=p]').fill(process.env.CODEMIRROR_TEST_PASSWORD || 'local-test-password');
        await page.locator('#dw__login button[type=submit]').click();
        await page.goto(base + '/doku.php?do=admin&page=extension');
        const inventory = await page.locator('section[data-ext]').evaluateAll(nodes => nodes.map(node => ({
            id: node.dataset.ext,
            enabled: !Array.from(node.querySelectorAll('button')).some(button => button.textContent.trim() === 'Enable')
        })));
        assert(inventory.find(plugin => plugin.id === 'codemirror' && plugin.enabled));
        fs.writeFileSync(path.join(output, 'extensions.json'), JSON.stringify(inventory, null, 2));
        pass('Extension Manager loads with CodeMirror enabled; installed extension states recorded');

        await page.goto(base + '/doku.php?id=' + id + '&do=edit');
        await setText(source);
        assert.equal(await page.locator('#wiki__text').inputValue(), source);
        await page.waitForFunction(() => {
            const cm = document.querySelector('.CodeMirror').CodeMirror;
            return cm.getTokenTypeAt({line: 15, ch: 5})?.includes('keyword') &&
                cm.getTokenTypeAt({line: 19, ch: 3})?.includes('keyword');
        });
        assert(await page.locator('.CodeMirror-code .cm-header').count());
        assert(await page.locator('.CodeMirror-code .cm-strong').count());
        await page.screenshot({path: path.join(output, 'syntax.png'), fullPage: true});
        pass('Rendered wiki headings, formatting, quotes, tables, plugin delimiters and embedded JavaScript/Python');

        for (const [language, code, style] of [
            ['PHP', '$answer = 42;', 'variable-2'], ['js', 'const answer = 42;', 'keyword'],
            ['typescript', 'const answer: number = 42;', 'keyword'], ['bash', 'echo "$HOME"', 'builtin'],
            ['sql', 'SELECT * FROM pages;', 'keyword'], ['css', 'body { color: red; }', 'tag'],
            ['html', '<div>Hello</div>', 'tag'], ['yml', 'enabled: true', 'atom']
        ]) {
            await setText('<code ' + language + '>\n' + code + '\n</code>');
            await page.waitForFunction(style => {
                const cm = document.querySelector('.CodeMirror').CodeMirror;
                return cm.getLineTokens(1, true).some(token => (token.type || '').split(' ').includes(style));
            }, style);
        }
        for (const language of ['unknown-language', 'constructor', '__proto__']) {
            await setText('<code ' + language + '>\nplain text\n</code>');
            assert.equal(await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getTokenTypeAt({line: 1, ch: 5})), null);
        }
        pass('Lazy-loaded PHP, JS/TS, shell, SQL, CSS, HTML, YAML, aliases and unknown-language fallback');

        await setText('앞 문장\nselected text\n뒤 문장');
        await page.evaluate(() => {
            const cm = document.querySelector('.CodeMirror').CodeMirror;
            cm.setSelection({line: 1, ch: 0}, {line: 1, ch: 13});
            window.insertTags('wiki__text', '**', '**', 'sample');
        });
        assert.equal(await text(), '앞 문장\n**selected text**\n뒤 문장');
        await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.undo());
        assert.equal(await text(), '앞 문장\nselected text\n뒤 문장');
        await page.evaluate(() => {
            const field = document.querySelector('#wiki__text');
            field.value = 'native plugin update';
            field.setSelectionRange(0, 6);
        });
        assert.equal(await text(), 'native plugin update');
        assert.equal(await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getSelection()), 'native');
        pass('Toolbar replacement, undo and native textarea value/selection interoperability');

        const original = '앞 문장\nselected text\n뒤 문장';
        await setText(original);
        await page.evaluate(() => {
            const cm = document.querySelector('.CodeMirror').CodeMirror;
            cm.setSelection({line: 1, ch: 0}, {line: 1, ch: 13}); cm.focus();
        });
        await page.keyboard.press('Control+k');
        await page.locator('#aiassist-command').waitFor();
        assert((await page.locator('#aiassist-scope').textContent()).includes('13'));
        await page.locator('#aiassist-profile-select').selectOption({index: 1});
        await page.locator('#aiassist-command').fill('Improve the selected text.');
        await page.locator('#aiassist-run').click();
        await page.locator('#aiassist-card[data-state=result]').waitFor();
        assert.equal(await text(), original);
        const replacement = await page.locator('#aiassist-result-edit').inputValue();
        await page.screenshot({path: path.join(output, 'ai-review.png'), fullPage: true});
        await page.locator('#aiassist-apply').click();
        assert.equal(await text(), '앞 문장\n' + replacement + '\n뒤 문장');
        assert.equal(await page.locator('#wiki__text').inputValue(), await text());
        await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.undo());
        assert.equal(await text(), original);
        pass('Ctrl+K AI side panel: selected profile, mock HTTP completion, review, Apply and undo');

        await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.focus());
        await page.keyboard.press('Control+k');
        // AI Assistant deliberately rate-limits consecutive requests per user.
        await page.waitForTimeout(10100);
        await page.locator('#aiassist-run').click();
        await page.locator('#aiassist-card[data-state=result]').waitFor();
        const edited = original + '\nEdited while reviewing.';
        await setText(edited);
        await page.locator('#aiassist-apply').click();
        await page.locator('#aiassist-card[data-state=error]').waitFor();
        assert.equal(await text(), edited);
        await page.locator('#aiassist-close').click();
        pass('Stale AI Apply cannot overwrite edits made in CodeMirror during review');

        await setText('====== WYSIWYG round trip ======\n\nA simple paragraph.\n');
        await page.locator('.plugin_prosemirror_useWYSIWYG').click();
        await page.locator('.ProseMirror').waitFor({state: 'visible'});
        assert.equal(await page.locator('.CodeMirror').count(), 0);
        await page.locator('.plugin_prosemirror_useWYSIWYG').click();
        await ready();
        assert((await text()).includes('A simple paragraph.'));
        pass('ProseMirror round trip tears down and recreates CodeMirror without text loss');

        await setText(source);
        await page.locator('#edbtn__preview').click();
        await page.locator('.preview').waitFor();
        await ready();
        assert.equal(await text(), source);
        await page.evaluate(() => document.querySelector('#dw__editform').requestSubmit(document.querySelector('#edbtn__save')));
        await page.locator('#wiki__text').waitFor({state: 'detached'});
        await page.waitForFunction(() => document.querySelector('pre.code .cm-keyword'));
        await page.waitForFunction(() => document.querySelector('pre.file .cm-keyword'));
        pass('Preview and native save preserve source; rendered code and file blocks receive syntax colors');

        const viewURL = base + '/doku.php/' + id;
        await page.goto(viewURL);
        const marker = await page.evaluate(() => {window.cmTestMarker = Math.random(); return window.cmTestMarker;});
        await page.locator('#dokuwiki__pagetools a[accesskey=e]').click();
        await ready();
        assert.equal(await page.evaluate(() => window.cmTestMarker), marker);
        assert.equal(await text(), source);
        await page.locator('button[name="do[cancel]"]').click();
        await page.locator('#wiki__text').waitFor({state: 'detached'});
        assert.equal(await page.locator('.CodeMirror').count(), 0);
        await page.locator('#dokuwiki__pagetools a[accesskey=e]').click();
        await ready();
        assert.equal(await page.locator('.CodeMirror').count(), 1);
        assert.equal(await page.locator('.cm-settings-menu').count(), 1);
        pass('Fastwiki view → AJAX Edit → Cancel → reopen creates exactly one editor and settings menu');

        await setText('link target');
        await page.evaluate(() => {
            const cm = document.querySelector('.CodeMirror').CodeMirror;
            cm.setSelection({line: 0, ch: 0}, {line: 0, ch: 11});
        });
        await page.locator('button[title^="Internal Link"]').click();
        await page.locator('#link__wiz_entry').fill('start');
        await page.evaluate(() => window.dw_linkwiz.insertLink('Start'));
        assert.equal(await text(), '[[start|link target]]');
        pass('Modern LinkWizard opens and inserts a selected-text link after Fastwiki AJAX Edit');

        await page.locator('.cm-settings-button').click();
        await page.locator('.cm-settings-menu').getByText('Native DokuWiki editor', {exact: true}).click();
        await page.locator('#wiki__text').waitFor({state: 'visible'});
        assert.equal(await page.locator('.CodeMirror').count(), 0);
        await page.locator('#wiki__text').fill(source + '\nNative edit.\n');
        await page.locator('.cm-settings-button').click();
        await page.locator('.cm-settings-menu').getByText('Native DokuWiki editor', {exact: true}).click();
        await ready();
        assert((await text()).endsWith('Native edit.\n'));
        pass('Settings switch between the native textarea and CodeMirror without losing edits');

        const longText = source + Array.from({length: 70}, (_, i) => 'Line ' + i).join('\n');
        await setText(longText);
        await page.evaluate(() => {
            const cm = document.querySelector('.CodeMirror').CodeMirror;
            cm.setSelection({line: 40, ch: 0}, {line: 40, ch: 4}); cm.scrollTo(null, 450); cm.focus();
        });
        await Promise.all([page.waitForNavigation(), page.keyboard.press('Control+s')]);
        await ready();
        await page.locator('#aiassist-editor-save-status').waitFor();
        assert.equal(await text(), longText);
        assert.equal(await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getSelection()), 'Line');
        assert(await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getScrollInfo().top > 0));
        pass('AI Assistant Ctrl+S saves and continues in CodeMirror with selection and scroll restored');

        await page.setViewportSize({width: 390, height: 844});
        await page.evaluate(() => {document.querySelector('.CodeMirror').CodeMirror.focus(); window.handleAIAssist();});
        await page.locator('#aiassist-card').waitFor();
        const bounds = await page.locator('#aiassist-card').boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= 391);
        await page.screenshot({path: path.join(output, 'mobile.png'), fullPage: true});
        pass('AI editing card remains within a 390px mobile viewport');
        await page.locator('#aiassist-close').click();
        await page.locator('button[name="do[cancel]"]').click();
        const readerContext = await browser.newContext();
        await readerContext.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
            ? route.continue() : route.abort());
        const reader = await readerContext.newPage();
        reader.on('pageerror', error => errors.push(error.stack));
        await reader.goto(base + '/doku.php?do=login');
        await reader.locator('[name=u]').fill('reader');
        await reader.locator('[name=p]').fill('local-reader-password');
        await reader.locator('#dw__login button[type=submit]').click();
        await reader.goto(base + '/doku.php?id=' + id + '&do=edit');
        await reader.locator('.CodeMirror').waitFor();
        assert(await reader.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getOption('readOnly')));
        assert.equal(await reader.locator('.aiassist_button').count(), 0);
        await readerContext.close();
        pass('Source view initializes a read-only highlighted editor without an edit lock timer');
        assert.deepEqual(errors, [], 'Unexpected browser errors');
    } catch (error) {
        await page.screenshot({path: path.join(output, 'failure.png'), fullPage: true});
        throw error;
    } finally {
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({checks, errors}, null, 2) + '\n');
        await browser.close();
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
