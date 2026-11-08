const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const markdown = fs.readFileSync(path.join(__dirname, '..', 'js', 'markdown.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

function format(source, start, end, action) {
  const context = vm.createContext({});
  vm.runInContext(markdown, context);
  const edit = context.getDescriptionFormattingEdit(source, start, end, action);
  const value = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  assert.ok(edit.selectionStart >= 0 && edit.selectionEnd <= value.length);
  assert.ok(edit.selectionEnd >= edit.selectionStart);
  return { value, start: edit.selectionStart, end: edit.selectionEnd,
    selected: value.slice(edit.selectionStart, edit.selectionEnd) };
}

for (const [action, marker] of [['bold', '**'], ['italic', '*'], ['strike', '~~']]) {
  test(action + ' formats only selected text and toggles off without changing its neighbors', () => {
    const source = '# Heading\n\nBefore word after\n\n![image](data:image/png;base64,aGVsbG8=)\n';
    const start = source.indexOf('word');
    const added = format(source, start, start + 4, action);
    assert.equal(added.value, source.replace('word', marker + 'word' + marker));
    assert.equal(added.selected, 'word');
    assert.equal(format(added.value, added.start, added.end, action).value, source);
  });

  test(action + ' preserves leading/trailing whitespace and paragraph boundaries', () => {
    assert.equal(format('  one  \n\n two \n', 0, 15, action).value,
      '  ' + marker + 'one' + marker + '  \n\n ' + marker + 'two' + marker + ' \n');
  });

  test(action + ' inserts a selected placeholder at the cursor', () => {
    const result = format('before  after', 7, 7, action);
    assert.equal(result.value, 'before ' + marker + 'text' + marker + ' after');
    assert.equal(result.selected, 'text');
  });
}

test('italic adds emphasis to bold text instead of removing half its markers', () => {
  assert.equal(format('**word**', 2, 6, 'italic').value, '***word***');
  assert.equal(format('**word**', 0, 8, 'italic').value, '***word***');
});

test('italic toggles off nested bold/italic without adding or removing bold', () => {
  assert.equal(format('***word***', 3, 7, 'italic').value, '**word**');
  assert.equal(format('***word***', 0, 10, 'italic').value, '**word**');
});

test('formatting a mixed selection does not double already-formatted Markdown', () => {
  const source = '**one**\ntwo';
  assert.equal(format(source, 0, source.length, 'bold').value, '**one**\n**two**');
});

test('inline formatting preserves selected heading, quote, list, and checklist prefixes', () => {
  const source = '## Heading\n> Quote\n- Bullet\n2. Number\n- [x] Task';
  assert.equal(format(source, 0, source.length, 'bold').value,
    '## **Heading**\n> **Quote**\n- **Bullet**\n2. **Number**\n- [x] **Task**');
});

test('already-selected formatting markers can be toggled off', () => {
  assert.equal(format('**one**\n\n**two**', 0, 16, 'bold').value, 'one\n\ntwo');
});

for (const [action, expected] of [
  ['heading', '## one\n## two'],
  ['bullet', '- one\n- two'],
  ['numbered', '1. one\n2. two'],
  ['checklist', '- [ ] one\n- [ ] two'],
  ['quote', '> one\n> two'],
]) {
  test(action + ' applies to selected lines and toggles off', () => {
    const result = format('one\ntwo', 1, 6, action);
    assert.equal(result.value, expected);
    assert.equal(format(result.value, 0, result.value.length, action).value, 'one\ntwo');
  });
}

test('block formatting isolates adjacent paragraphs and excludes an unselected next line', () => {
  assert.equal(format('before\none\ntwo\nafter', 7, 11, 'bullet').value,
    'before\n\n- one\n\ntwo\nafter');
});

test('list conversion preserves indentation without duplicating list and checkbox markers', () => {
  assert.equal(format('- [x] one\n  4. two', 0, 18, 'numbered').value, '1. one\n  2. two');
});

test('adding checklists to a mixed selection preserves existing checked state', () => {
  const source = '- [x] one\ntwo';
  assert.equal(format(source, 0, source.length, 'checklist').value, '- [x] one\n- [ ] two');
});

test('heading formatting replaces an existing heading level', () => {
  assert.equal(format('### Heading', 4, 4, 'heading').value, '## Heading');
});

test('blockquote formatting preserves blank lines within the quote', () => {
  assert.equal(format('one\n\ntwo', 0, 8, 'quote').value, '> one\n> \n> two');
});

for (const action of ['heading', 'bullet', 'numbered', 'checklist', 'quote', 'code-block']) {
  test(action + ' provides a replaceable placeholder on an empty line', () => {
    const result = format('', 0, 0, action);
    assert.ok(result.selected.length > 0);
    assert.doesNotMatch(result.selected, /^(?:## |- |> |```)/);
  });
}

test('inline code uses a longer delimiter and padding for literal backticks', () => {
  const result = format('`a``b`', 0, 6, 'code');
  assert.equal(result.value, '``` `a``b` ```');
  assert.equal(result.selected, '`a``b`');
});

test('inline code preserves significant spaces', () => {
  assert.equal(format(' a ', 0, 3, 'code').value, '`  a  `');
});

test('code blocks use fences longer than literal backticks without rewriting their content', () => {
  const source = 'const ticks = "```";\n  keep indentation';
  const result = format(source, 0, source.length, 'code-block');
  assert.equal(result.value, '````\n' + source + '\n````');
  assert.equal(result.selected, source);
});

test('a whole existing fenced block can safely be wrapped as literal code', () => {
  const source = '```js\nconst a = 1;\n```';
  assert.equal(format(source, 0, source.length, 'code-block').value, '````\n' + source + '\n````');
});

for (const action of ['bold', 'heading', 'bullet', 'quote', 'code', 'code-block', 'link']) {
  test(action + ' refuses to insert Markdown syntax inside a fenced code block', () => {
    const source = '```js\nconst a = 1;\n```';
    assert.throws(() => format(source, 6, 11, action), /inside a fenced code block/);
  });
}

test('formatting remains available after a closing fence', () => {
  const source = '~~~\ncode\n~~~\nword';
  assert.equal(format(source, 13, 17, 'bold').value, '~~~\ncode\n~~~\n**word**');
});

test('links escape brackets and select only the URL for replacement', () => {
  const result = format('before [label] after', 7, 14, 'link');
  assert.equal(result.value, 'before [\\[label\\]](https://example.com) after');
  assert.equal(result.selected, 'https://example.com');
});

test('Arabic and mixed-language source is never changed into HTML or direction markers', () => {
  const source = '\u0645\u0631\u062d\u0628\u0627 English';
  const result = format(source, 0, 5, 'bold');
  assert.equal(result.value, '**\u0645\u0631\u062d\u0628\u0627** English');
  assert.doesNotMatch(result.value, /[<>\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
});

test('invalid actions, ranges, table markers, and multiline inline code/links fail explicitly', () => {
  assert.throws(() => format('word', 0, 4, 'html'), /Unsupported/);
  assert.throws(() => format('word', -1, 4, 'bold'), /selection is invalid/);
  assert.throws(() => format('word', 3, 2, 'bold'), /selection is invalid/);
  assert.throws(() => format('word', 0, 5, 'bold'), /selection is invalid/);
  assert.throws(() => format('| cell |', 0, 8, 'bold'), /table cell/);
  assert.throws(() => format('one\ntwo', 0, 7, 'code'), /single line/);
  assert.throws(() => format('one\ntwo', 0, 7, 'link'), /single line/);
});

function setup({ native = true, format = 'markdown', hidden = false, pending = false, saving = false } = {}) {
  const calls = [];
  const input = {
    value: 'before word after', selectionStart: 7, selectionEnd: 11,
    selectionDirection: 'backward', hidden,
    focus: () => calls.push('focus'),
    setSelectionRange(start, end, direction) {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
    setRangeText(text, start, end) {
      calls.push('replace');
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
    },
    dispatchEvent: event => calls.push(['event', event.type, event.bubbles]),
  };
  const context = vm.createContext({
    descriptionImagePastePending: pending, itemSaveInProgress: saving,
    document: {
      getElementById: id => id === 'itemDesc' ? input : { value: format },
      execCommand(command, ui, text) {
        calls.push(['insert', command, ui, text]);
        if (native) {
          input.value = input.value.slice(0, input.selectionStart) + text + input.value.slice(input.selectionEnd);
        }
        return native;
      },
    },
    console: { error: () => calls.push('error') },
    toast: message => calls.push(['toast', message]),
    Event: class { constructor(type, options) { this.type = type; this.bubbles = options.bubbles; } },
  });
  vm.runInContext(markdown, context);
  vm.runInContext(app.slice(app.indexOf('function onDescriptionDirectionChange('),
    app.indexOf('function onDescriptionPaste(')), context);
  vm.runInContext(app.slice(app.indexOf('function insertDescriptionText('),
    app.indexOf('async function pasteDescriptionImages(')), context);
  return { context, calls, input };
}

for (const native of [true, false]) {
  test('toolbar insertion restores focus and the selected text: native=' + native, () => {
    const { context, calls, input } = setup({ native });
    context.formatDescription('bold');
    assert.equal(input.value, 'before **word** after');
    assert.equal(input.value.slice(input.selectionStart, input.selectionEnd), 'word');
    assert.equal(input.selectionDirection, 'backward');
    assert.equal(calls[0], 'focus');
    assert.deepEqual(calls[1], ['insert', 'insertText', false, '**word**']);
    if (!native) assert.deepEqual(calls.slice(-2), ['replace', ['event', 'input', true]]);
  });
}

for (const options of [{ format: 'plain' }, { hidden: true }, { pending: true }, { saving: true }]) {
  test('toolbar cannot alter unavailable or busy editors: ' + JSON.stringify(options), () => {
    const { context, calls, input } = setup(options);
    context.formatDescription('bold');
    assert.equal(input.value, 'before word after');
    assert.deepEqual(calls.map(call => call[0]), ['toast']);
  });
}

test('formatting failures are logged and notified without changing the description', () => {
  const { context, calls, input } = setup();
  context.formatDescription('unknown');
  assert.equal(input.value, 'before word after');
  assert.equal(calls[0], 'error');
  assert.equal(calls[1][0], 'toast');
});

for (const [key, modifier, action] of [['b', 'ctrlKey', 'bold'], ['i', 'metaKey', 'italic'], ['k', 'ctrlKey', 'link']]) {
  test(modifier + '+' + key + ' is scoped to the Markdown textarea and cannot trigger global search', () => {
    const { context, calls, input } = setup();
    context.formatDescription = value => calls.push(['format', value]);
    context.onDescriptionKeydown({
      key, [modifier]: true, currentTarget: input,
      preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop'),
    });
    assert.deepEqual(calls, ['prevent', 'stop', ['format', action]]);
  });
}

for (const options of [{ format: 'plain' }, { hidden: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }]) {
  test('shortcuts preserve plain-text, preview, alternative modifiers and IME behavior: ' + JSON.stringify(options), () => {
    const { context, calls, input } = setup(options);
    context.onDescriptionKeydown({
      key: 'b', ctrlKey: true, currentTarget: input, ...options,
      preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop'),
    });
    assert.deepEqual(calls, []);
  });
}

test('text undo is not intercepted by sketch undo, which still works outside text inputs', () => {
  let listener;
  const calls = [];
  const context = vm.createContext({
    document: {
      addEventListener: (_, callback) => { listener = callback; },
      getElementById: id => id === 'itemFullscreen' ? { open: false } : { classList: { contains: () => true } },
    },
    sketchActive: true, sketchUndo: () => calls.push('sketch'),
  });
  vm.runInContext(app.slice(app.indexOf('// Keyboard shortcuts'),
    app.indexOf('// Clean up drag state')), context);
  for (const editable of [true, false]) {
    listener({ key: 'z', ctrlKey: true, target: { matches: () => editable },
      preventDefault: () => calls.push('prevent') });
    assert.deepEqual(calls, editable ? [] : ['prevent', 'sketch']);
  }
});
