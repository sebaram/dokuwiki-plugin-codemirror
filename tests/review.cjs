const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = path.join(__dirname, '../review.js');
const review = fs.existsSync(source) ? require(source) : {};
assert.equal(typeof review.plan, 'function', 'Inline review must plan source-preserving changes');
const parts = [
    {type: 'equal', text: '😀 '}, {type: 'delete', text: 'red'},
    {type: 'insert', text: 'green'}, {type: 'equal', text: ' and '},
    {type: 'delete', text: 'blue'}, {type: 'insert', text: 'gold'},
    {type: 'equal', text: '.'}
];
assert.deepEqual(review.plan('Before\n😀 red and blue.\nAfter', 7, 23, parts), [
    {from: 10, to: 22, removed: 'red and blue', added: 'green and gold', status: 'pending'}
]);
const multiline = [
    {type: 'delete', text: 'red'}, {type: 'insert', text: 'green'},
    {type: 'equal', text: ' one\n'}, {type: 'delete', text: 'blue'}, {type: 'insert', text: 'gold'},
    {type: 'equal', text: ' two\nUNCHANGED\n'}, {type: 'delete', text: 'old'}, {type: 'insert', text: 'new'}
];
assert.deepEqual(review.plan('red one\nblue two\nUNCHANGED\nold', 0, 30, multiline), [
    {from: 0, to: 12, removed: 'red one\nblue', added: 'green one\ngold', status: 'pending'},
    {from: 27, to: 30, removed: 'old', added: 'new', status: 'pending'}
]);
assert.equal(review.plan('red\r\nblue', 0, 9, [
    {type: 'delete', text: 'red'}, {type: 'insert', text: 'green'}, {type: 'equal', text: '\r\n'},
    {type: 'delete', text: 'blue'}, {type: 'insert', text: 'gold'}
]).length, 1, 'Adjacent CRLF lines form one batch');
assert.equal(review.plan('old\nKEEP\nlast', 0, 13, [
    {type: 'delete', text: 'old\n'}, {type: 'equal', text: 'KEEP\n'},
    {type: 'delete', text: 'last'}, {type: 'insert', text: 'new'}
]).length, 2, 'A deleted newline must not hide a fully unchanged line');
assert.equal(review.plan('KEEP\nold', 0, 8, [
    {type: 'insert', text: 'new line\n'}, {type: 'equal', text: 'KEEP\n'},
    {type: 'delete', text: 'old'}, {type: 'insert', text: 'new'}
]).length, 2, 'A full-line insertion must not consume an unchanged line between batches');
assert.deepEqual(review.plan('', 0, 0, [{type: 'insert', text: '새 줄\n'}]), [
    {from: 0, to: 0, removed: '', added: '새 줄\n', status: 'pending'}
]);
assert.deepEqual(review.plan('한글\r\n\t', 0, 5, [{type: 'delete', text: '한글\r\n\t'}]), [
    {from: 0, to: 5, removed: '한글\r\n\t', added: '', status: 'pending'}
]);
assert.deepEqual(review.plan('same', 0, 4, [{type: 'equal', text: 'same'}]), []);
for (const args of [
    ['abc', 0, 3, [{type: 'delete', text: 'wrong'}]],
    ['abc', -1, 3, []], ['abc', 0, 9, []],
    ['😀', 1, 2, [{type: 'delete', text: '\ude00'}]],
    ['abc', 0, 3, [{type: 'html', text: 'abc'}]]
]) assert.throws(() => review.plan(...args), /proposal|range|source|Unicode/i);
console.log('PASS inline review ranges, Unicode, insertion/deletion, exact source validation');
