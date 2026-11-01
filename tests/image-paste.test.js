const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const markdown = fs.readFileSync(path.join(__dirname, '..', 'js', 'markdown.js'), 'utf8');
const imageMarkdown = '![Pasted image](data:image/png;base64,aGVsbG8=)';

function setup({ format = 'markdown', files = [{ type: 'image/png', size: 5 }], deferred = false } = {}) {
  const calls = [];
  const readers = [];
  const input = {
    value: 'Before REPLACE after', selectionStart: 7, selectionEnd: 14, hidden: false,
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      this.selectionStart = this.selectionEnd = start + text.length;
    },
    dispatchEvent: event => calls.push(['input', event.type]),
  };
  const mode = { value: format };
  const modal = { classList: { contains: () => true } };
  const context = vm.createContext({
    descriptionEditorSession: 0, descriptionImagePastePending: false, itemSaveInProgress: false,
    document: {
      activeElement: input,
      getElementById: id => id === 'itemDescFormat' ? mode : modal,
      execCommand: () => false,
    },
    FileReader: class {
      constructor() { readers.push(this); }
      readAsDataURL(file) {
        this.result = `data:${file.type};base64,aGVsbG8=`;
        if (!deferred) this.onload();
      }
    },
    console: { error: (...args) => calls.push(['error', ...args]) },
    toast: message => calls.push(['toast', message]),
    Event: class { constructor(type) { this.type = type; } },
  });
  vm.runInContext(markdown, context);
  vm.runInContext(app.slice(app.indexOf('function onDescriptionPaste('),
    app.indexOf('function setDescriptionEditorMode(')), context);
  const event = {
    currentTarget: input,
    clipboardData: {
      items: files.map(file => ({ kind: 'file', type: file ? file.type : 'image/png', getAsFile: () => file })),
      getData: () => '',
    },
    preventDefault: () => calls.push(['prevent']),
  };
  return { context, calls, readers, input, mode, modal, event };
}

test('image paste embeds local data, replaces selected text, and notifies input listeners', async () => {
  const { context, calls, input, event } = setup();
  await context.onDescriptionPaste(event);
  assert.equal(input.value, `Before \n\n${imageMarkdown}\n\n after`);
  assert.equal(calls.some(call => call[0] === 'input'), true);
  assert.equal(calls[0][0], 'prevent');
  assert.equal(context.descriptionImagePastePending, false);
});

test('multiple images retain clipboard order and are separated as Markdown blocks', async () => {
  const { context, input, event } = setup({ files: [
    { type: 'image/png', size: 5 }, { type: 'image/jpeg', size: 5 },
  ] });
  input.value = '';
  input.selectionStart = input.selectionEnd = 0;
  await context.onDescriptionPaste(event);
  assert.equal(input.value, imageMarkdown + '\n\n![Pasted image](data:image/jpeg;base64,aGVsbG8=)');
});

test('plain-text mode does not intercept image paste', async () => {
  const { context, calls, readers, event } = setup({ format: 'plain' });
  await context.onDescriptionPaste(event);
  assert.deepEqual(calls, []);
  assert.equal(readers.length, 0);
});

for (const file of [null, { type: 'image/svg+xml', size: 5 }, { type: 'image/png', size: 0 }]) {
  test('invalid or unsupported images leave text unchanged and report errors: ' + JSON.stringify(file), async () => {
    const { context, calls, input, event } = setup({ files: [file] });
    await context.onDescriptionPaste(event);
    assert.equal(input.value, 'Before REPLACE after');
    assert.equal(calls.some(call => call[0] === 'error'), true);
    assert.equal(calls.some(call => call[0] === 'toast'), true);
    assert.equal(context.descriptionImagePastePending, false);
  });
}

for (const failure of ['onerror', 'onabort']) {
  test('FileReader ' + failure + ' is reported explicitly', async () => {
    const { context, calls, readers, input, event } = setup({ deferred: true });
    const result = context.onDescriptionPaste(event);
    readers[0][failure]();
    await result;
    assert.equal(input.value, 'Before REPLACE after');
    assert.equal(calls.some(call => call[0] === 'toast'), true);
    assert.equal(context.descriptionImagePastePending, false);
  });
}

for (const change of ['text', 'cursor', 'session', 'format', 'focus', 'closed', 'preview']) {
  test('asynchronous paste never inserts into a changed editor: ' + change, async () => {
    const { context, calls, readers, input, mode, modal, event } = setup({ deferred: true });
    const result = context.onDescriptionPaste(event);
    if (change === 'text') input.value = 'Changed text';
    if (change === 'cursor') input.selectionStart = 0;
    if (change === 'session') context.descriptionEditorSession++;
    if (change === 'format') mode.value = 'plain';
    if (change === 'focus') context.document.activeElement = {};
    if (change === 'closed') modal.classList.contains = () => false;
    if (change === 'preview') input.hidden = true;
    const expected = input.value;
    readers[0].onload();
    await result;
    assert.equal(input.value, expected);
    assert.match(calls.find(call => call[0] === 'toast')[1], /editor changed/);
  });
}

test('a second image paste is blocked while the first is reading', async () => {
  const { context, calls, readers, event } = setup({ deferred: true });
  const first = context.onDescriptionPaste(event);
  await context.onDescriptionPaste(event);
  assert.equal(readers.length, 1);
  assert.match(calls.find(call => call[0] === 'toast')[1], /still in progress/);
  readers[0].onload();
  await first;
});

test('image paste is blocked during an ongoing save', async () => {
  const { context, calls, readers, event } = setup();
  context.itemSaveInProgress = true;
  await context.onDescriptionPaste(event);
  assert.equal(readers.length, 0);
  assert.match(calls.find(call => call[0] === 'toast')[1], /still in progress/);
});

test('manual save waits for pending image paste', async () => {
  const context = vm.createContext({
    descriptionImagePastePending: true, itemSaveInProgress: false,
    toast: message => { context.message = message; },
    saveItemOnce: () => { throw new Error('Must not save while image is pending'); },
  });
  vm.runInContext(app.slice(app.indexOf('async function saveItem()'),
    app.indexOf('async function saveItemOnce(')), context);
  await context.saveItem();
  assert.match(context.message, /wait for the image paste/);
});
