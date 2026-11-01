const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const markdown = fs.readFileSync(path.join(__dirname, '..', 'js', 'markdown.js'), 'utf8');

function setup({ format = 'markdown', html = '<b>Bold</b>', native = true, fails = false } = {}) {
  const calls = [];
  const input = {
    selectionStart: 2, selectionEnd: 6,
    setRangeText: (...args) => calls.push(['replace', ...args]),
    dispatchEvent: event => calls.push(['event', event.type, event.bubbles]),
  };
  const context = vm.createContext({
    document: {
      getElementById: () => ({ value: format }),
      execCommand: (...args) => { calls.push(['insert', ...args]); return native; },
    },
    convertDescriptionHtmlToMarkdown: value => {
      calls.push(['convert', value]);
      if (fails) throw new Error('Conversion failed');
      return '**Bold**';
    },
    console: { error: () => calls.push(['error']) },
    toast: text => calls.push(['toast', text]),
    Event: class { constructor(type, options) { this.type = type; this.bubbles = options.bubbles; } },
  });
  vm.runInContext(app.slice(app.indexOf('function onDescriptionPaste('),
    app.indexOf('function setDescriptionEditorMode(')), context);
  const event = {
    currentTarget: input,
    clipboardData: { getData: type => type === 'text/html' ? html : 'Bold' },
    preventDefault: () => calls.push(['prevent']),
  };
  return { context, calls, event };
}

test('formatted paste converts only in Markdown mode and uses native undo-aware insertion', () => {
  const { context, calls, event } = setup();
  context.onDescriptionPaste(event);
  assert.deepEqual(calls, [
    ['convert', '<b>Bold</b>'], ['prevent'], ['insert', 'insertText', false, '**Bold**'],
  ]);
});

for (const options of [{ format: 'plain' }, { html: '' }, { html: '   ' }]) {
  test('ordinary paste is unchanged for ' + JSON.stringify(options), () => {
    const { context, calls, event } = setup(options);
    context.onDescriptionPaste(event);
    assert.deepEqual(calls, []);
  });
}

test('paste without accessible clipboard data is unchanged', () => {
  const { context, calls, event } = setup();
  event.clipboardData = null;
  context.onDescriptionPaste(event);
  assert.deepEqual(calls, []);
});

test('fallback replaces the selected range and notifies input listeners for auto-save', () => {
  const { context, calls, event } = setup({ native: false });
  context.onDescriptionPaste(event);
  assert.deepEqual(calls.slice(-2), [
    ['replace', '**Bold**', 2, 6, 'end'], ['event', 'input', true],
  ]);
});

test('conversion errors are logged and notified without blocking normal text paste', () => {
  const { context, calls, event } = setup({ fails: true });
  context.onDescriptionPaste(event);
  assert.equal(calls.some(call => call[0] === 'error'), true);
  assert.equal(calls.some(call => call[0] === 'toast'), true);
  assert.equal(calls.some(call => call[0] === 'prevent'), false);
});

test('missing conversion dependencies produce an explicit error', () => {
  const context = vm.createContext({});
  vm.runInContext(markdown, context);
  assert.throws(() => context.convertDescriptionHtmlToMarkdown('<b>Bold</b>'),
    /Formatted paste support could not load/);
});
