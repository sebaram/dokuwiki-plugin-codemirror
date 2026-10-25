const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const CodeMirror = require('codemirror/addon/runmode/runmode.node');

function load(file) {
    vm.runInNewContext(fs.readFileSync(require.resolve(file), 'utf8'), {
        CodeMirror, exports: {}, module: {}, require: () => CodeMirror
    });
}
load('codemirror/mode/javascript/javascript');
vm.runInNewContext(fs.readFileSync('mode.js', 'utf8'), {CodeMirror});
const spec = {
    name: 'doku', camelcase: true, smileys: [':-)'], acronyms: ['HTML'],
    entities: ['->'], schemes: ['https'],
    validLang: lang => lang.toLowerCase() === 'javascript',
    loadMode: lang => CodeMirror.getMode({}, lang && lang.toLowerCase() === 'javascript' ? 'javascript' : 'null')
};
function tokens(text) {
    const result = [];
    CodeMirror.runMode(text, spec, (text, style) => result.push({text, style}));
    return result;
}
function has(text, fragment, style) {
    assert(tokens(text).some(token => token.text.includes(fragment) && (token.style || '').split(' ').includes(style)),
        JSON.stringify({text, fragment, style, actual: tokens(text)}));
}
has('====== Heading ======', 'Heading', 'header');
has('**bold**', 'b', 'strong');
has('> **quoted**', 'q', 'strong');
has('WikiWord', 'WikiWord', 'link');
has('^ Header ^\n| Cell |', '^', 'def');
has('  * item', '*', 'def');
has('<code javascript>\nconst answer = 42;\n</code>', 'const', 'keyword');
has('<file JAVASCRIPT example.js>\nconst answer = 42;\n</file>', 'const', 'keyword');
has('<WRAP center>**text**</WRAP>', '<WRAP center>', 'tag');
has('{{tag>one two}}', '{{tag>one two}}', 'meta');
assert(!tokens('<nowiki>**plain**</nowiki>').some(token => token.style === 'strong'));
assert(!tokens('%%<WRAP>%%').some(token => token.text === '<WRAP>' && token.style === 'tag'));
console.log('PASS DokuWiki core, embedded code, plugin delimiters, protected text');
