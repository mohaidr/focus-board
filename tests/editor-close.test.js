const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

function setup({ changed = false, pending = false, saving = false, accept = false } = {}) {
  const calls = [];
  const modal = { active: true, classList: { contains: () => modal.active } };
  const context = vm.createContext({
    itemEditorChanged: changed, descriptionImagePastePending: pending,
    itemSaveInProgress: saving, descriptionEditorSession: 0, sketchActive: false,
    autoSaveTimer: null, itemNoteEditor: null,
    document: { getElementById: id => id === 'itemModal' ? modal : { value: 'secret' } },
    confirm: message => { calls.push(['confirm', message]); return accept; },
    toast: message => calls.push(['toast', message]),
    setDescriptionEditorMode: () => calls.push(['reset']),
    clearTimeout: () => {},
    closeModal: () => { modal.active = false; calls.push(['close']); },
    renderSidebar: () => {}, renderMain: () => {},
  });
  vm.runInContext(source.slice(source.indexOf('function markItemEditorChanged('),
    source.indexOf('async function saveItem()')), context);
  return { context, calls, modal };
}

test('unchanged editor closes without a prompt', () => {
  const { context, calls, modal } = setup();
  context.closeItemModal();
  assert.equal(modal.active, false);
  assert.equal(calls.some(([type]) => type === 'confirm'), false);
});

for (const options of [{ changed: true }, { pending: true }]) {
  test('declining discard preserves editor and pending paste session: ' + JSON.stringify(options), () => {
    const { context, calls, modal } = setup(options);
    context.closeItemModal();
    assert.equal(modal.active, true);
    assert.equal(context.descriptionEditorSession, 0);
    assert.deepEqual(calls.map(([type]) => type), ['confirm']);
  });
}

test('accepting discard closes and clears dirty state', () => {
  const { context, modal } = setup({ changed: true, accept: true });
  context.closeItemModal();
  assert.equal(modal.active, false);
  assert.equal(context.itemEditorChanged, false);
  assert.equal(context.descriptionEditorSession, 1);
});

test('successful manual save closes without prompting even while save is in progress', () => {
  const { context, calls, modal } = setup({ changed: true, saving: true });
  context.closeItemModal(true);
  assert.equal(modal.active, false);
  assert.equal(calls.some(([type]) => type === 'confirm'), false);
});

test('closing during a save is blocked', () => {
  const { context, calls, modal } = setup({ changed: true, saving: true, accept: true });
  context.closeItemModal();
  assert.equal(modal.active, true);
  assert.deepEqual(calls.map(([type]) => type), ['toast']);
});

test('dirty flag uses events only while the editor is active', () => {
  const { context, modal } = setup();
  modal.active = false;
  context.markItemEditorChanged();
  assert.equal(context.itemEditorChanged, false);
  modal.active = true;
  context.markItemEditorChanged();
  assert.equal(context.itemEditorChanged, true);
});

test('overlay clicks do not close the item editor but still close other modals', () => {
  let listener;
  const calls = [];
  const context = vm.createContext({
    document: { addEventListener: (_, callback) => { listener = callback; } },
    closeShareModal: () => calls.push('share'),
  });
  vm.runInContext(source.slice(source.indexOf('// Close modals on overlay click'),
    source.indexOf('// Keyboard shortcuts')), context);
  listener({ target: { id: 'itemModal', classList: { contains: () => true } } });
  assert.deepEqual(calls, []);
  listener({ target: { id: 'shareItemModal', classList: { contains: () => true } } });
  assert.deepEqual(calls, ['share']);
});

test('save failures are logged and notified without clearing edited state', async () => {
  const calls = [];
  const context = vm.createContext({
    descriptionImagePastePending: false, itemSaveInProgress: false, itemEditorChanged: true,
    saveItemOnce: async () => { throw new Error('Storage unavailable'); },
    console: { error: () => calls.push('error') },
    toast: message => calls.push(message),
  });
  vm.runInContext(source.slice(source.indexOf('async function saveItem()'),
    source.indexOf('async function saveItemOnce(')), context);
  await context.saveItem();
  assert.equal(context.itemSaveInProgress, false);
  assert.equal(context.itemEditorChanged, true);
  assert.deepEqual(calls, ['error', 'Could not save item: Storage unavailable']);
});
