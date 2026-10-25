/* jshint node: true */
/** Inline proposals are decorations until accepted into the native document. */
(function() {
    'use strict';

    function splitsSurrogate(text, index) {
        var left = text.charCodeAt(index - 1), right = text.charCodeAt(index);
        return left >= 0xD800 && left <= 0xDBFF &&
            right >= 0xDC00 && right <= 0xDFFF;
    }

    function plan(snapshot, from, to, parts) {
        if (typeof snapshot !== 'string' || !Number.isInteger(from) ||
            !Number.isInteger(to) || from < 0 || to < from ||
            to > snapshot.length || splitsSurrogate(snapshot, from) ||
            splitsSurrogate(snapshot, to)) {
            throw new Error('Invalid proposal range or Unicode boundary');
        }
        if (!Array.isArray(parts) || parts.length > 10000) {
            throw new Error('Invalid proposal parts');
        }
        var original = '', replacement = '', position = from, changes = [];
        var current = null, size = 0;
        parts.forEach(function(part) {
            if (!part || typeof part.text !== 'string' ||
                ['equal', 'delete', 'insert'].indexOf(part.type) === -1) {
                throw new Error('Invalid proposal part');
            }
            size += part.text.length;
            if (size > 200000) {
                throw new Error('Proposal is too large');
            }
            if (part.type !== 'insert') {
                original += part.text;
            }
            if (part.type !== 'delete') {
                replacement += part.text;
            }
            if (part.type === 'equal') {
                current = null;
                position += part.text.length;
            } else {
                if (!current) {
                    current = {from: position, to: position, removed: '',
                        added: '', status: 'pending'};
                    changes.push(current);
                }
                if (part.type === 'delete') {
                    current.removed += part.text;
                    position += part.text.length;
                    current.to = position;
                } else {
                    current.added += part.text;
                }
            }
        });
        if (original !== snapshot.slice(from, to)) {
            throw new Error('Proposal does not match the original source');
        }
        if (changes.length > 100) {
            // Bound decoration count for large, extensively rewritten text.
            return [{from: from, to: to, removed: original,
                added: replacement, status: 'pending'}];
        }
        return changes.filter(function(change) {
            return change.removed !== change.added;
        });
    }

    function show(field, options) {
        var wrapper = field && field.nextElementSibling;
        var cm = wrapper && wrapper.CodeMirror;
        if (!cm || cm.getValue() !== options.snapshot) {
            throw new Error('The editor source changed');
        }
        if (cm.state.aiReview) {
            cm.state.aiReview.destroy();
        }
        var changes = plan(options.snapshot, options.from, options.to,
            options.parts);
        var expected = options.snapshot, applying = false, closed = false;
        var stale = false, marks = [], widgets = [], bar, active = 0, api;
        var labels = options.labels || {};

        function button(text, action, className) {
            var node = document.createElement('button');
            node.type = 'button';
            node.textContent = labels[text] || text;
            node.className = className || '';
            node.addEventListener('click', action);
            return node;
        }
        function offset(index) {
            var delta = 0;
            changes.slice(0, index).forEach(function(change) {
                if (change.status === 'accepted') {
                    delta += change.added.length - change.removed.length;
                }
            });
            return changes[index].from + delta;
        }
        function pending() {
            return changes.reduce(function(list, change, index) {
                if (change.status === 'pending') {
                    list.push(index);
                }
                return list;
            }, []);
        }
        function notify() {
            if (options.onState) {
                options.onState({pending: closed ? 0 : pending().length,
                    accepted: changes.filter(function(c) {
                        return c.status === 'accepted';
                    }).length,
                    rejected: changes.filter(function(c) {
                        return c.status === 'rejected';
                    }).length, stale: stale});
            }
        }
        function clearUI() {
            marks.forEach(function(mark) { mark.clear(); });
            widgets.forEach(function(widget) { widget.clear(); });
            marks = []; widgets = [];
            if (bar) {
                bar.remove();
                bar = null;
            }
        }
        function destroy() {
            if (closed) {
                return;
            }
            closed = true;
            clearUI();
            cm.off('change', changed);
            field.removeEventListener('codemirror:destroy', destroy);
            if (cm.state.aiReview === api) {
                delete cm.state.aiReview;
            }
            cm.refresh();
            notify();
        }
        function changed() {
            if (!applying && cm.getValue() !== expected) {
                stale = true;
                destroy();
            }
        }
        function valid() {
            if (!closed && field.isConnected &&
                cm.getValue() === expected && !cm.getOption('readOnly')) {
                return true;
            }
            stale = true;
            destroy();
            return false;
        }
        function focus(index) {
            if (!closed && changes[index]) {
                active = index;
                cm.scrollIntoView(cm.posFromIndex(offset(index)), 100);
                cm.focus();
            }
        }
        function navigate(direction) {
            var list = pending(), index = list.indexOf(active);
            focus(list[(index + direction + list.length) % list.length]);
        }
        function render() {
            clearUI();
            if (closed) {
                return;
            }
            var list = pending();
            if (!list.length) {
                destroy();
                return;
            }
            bar = document.createElement('div');
            bar.className = 'cm-ai-review';
            bar.setAttribute('role', 'region');
            bar.setAttribute('aria-label', labels.review || 'Proposed changes');
            var count = document.createElement('span');
            count.textContent = list.length + ' ' +
                (labels.changes || 'proposed changes');
            count.setAttribute('aria-live', 'polite');
            bar.appendChild(count);
            bar.appendChild(button('Previous', function() { navigate(-1); }));
            bar.appendChild(button('Next', function() { navigate(1); }));
            bar.appendChild(button('Reject all', api.rejectAll));
            bar.appendChild(button('Accept all', api.acceptAll,
                'cm-ai-accept'));
            wrapper.parentNode.insertBefore(bar, field);
            list.forEach(function(index) {
                var change = changes[index], start = offset(index);
                var from = cm.posFromIndex(start);
                var to = cm.posFromIndex(start + change.removed.length);
                if (change.removed) {
                    marks.push(cm.markText(from, to, {
                        className: 'cm-ai-deleted',
                        title: labels.deleted || 'Proposed deletion'
                    }));
                }
                var chunk = document.createElement('div');
                chunk.className = 'cm-ai-chunk';
                chunk.setAttribute('data-change', index);
                if (change.added) {
                    var added = document.createElement('pre');
                    added.className = 'cm-ai-added';
                    added.setAttribute('aria-label',
                        labels.added || 'Proposed addition');
                    added.textContent = '+ ' + change.added;
                    chunk.appendChild(added);
                }
                var controls = document.createElement('div');
                controls.className = 'cm-ai-controls';
                var description = document.createElement('span');
                description.textContent = (labels.change || 'Change') + ' ' +
                    (list.indexOf(index) + 1) + '/' + list.length;
                controls.appendChild(description);
                controls.appendChild(button('Reject', function() {
                    api.reject(index);
                }));
                controls.appendChild(button('Accept', function() {
                    api.accept(index);
                }, 'cm-ai-accept'));
                chunk.appendChild(controls);
                widgets.push(cm.addLineWidget(to.line, chunk,
                    {coverGutter: false, noHScroll: true}));
            });
            cm.refresh();
            notify();
        }
        function accept(indices) {
            if (!valid()) {
                return;
            }
            applying = true;
            clearUI();
            // Separate AI edits from typing without clearing native undo.
            cm.changeGeneration(true);
            cm.operation(function() {
                indices.slice().sort(function(a, b) { return b - a; })
                .forEach(function(index) {
                    var change = changes[index];
                    if (!change || change.status !== 'pending') {
                        return;
                    }
                    var start = offset(index);
                    cm.replaceRange(change.added, cm.posFromIndex(start),
                        cm.posFromIndex(start + change.removed.length),
                        'aiassist');
                    change.status = 'accepted';
                });
            });
            cm.changeGeneration(true);
            cm.save();
            expected = cm.getValue();
            applying = false;
            field.dispatchEvent(new Event('input', {bubbles: true}));
            render();
        }
        api = {
            accept: function(index) { accept([index]); },
            reject: function(index) {
                if (valid() && changes[index] &&
                    changes[index].status === 'pending') {
                    changes[index].status = 'rejected';
                    render();
                }
            },
            acceptAll: function() { accept(pending()); },
            rejectAll: function() {
                if (valid()) {
                    changes.forEach(function(change) {
                        if (change.status === 'pending') {
                            change.status = 'rejected';
                        }
                    });
                    render();
                }
            },
            focus: focus, destroy: destroy
        };
        cm.state.aiReview = api;
        cm.on('change', changed);
        field.addEventListener('codemirror:destroy', destroy);
        render();
        return api;
    }

    var exported = {plan: plan, show: show};
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }
    if (typeof window !== 'undefined') {
        window.CodeMirrorAIReview = exported;
    }
}());
