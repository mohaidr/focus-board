const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');

const root = path.join(__dirname, '..');
const markdown = fs.readFileSync(path.join(root, 'js', 'markdown.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const share = fs.readFileSync(path.join(root, 'js', 'share.js'), 'utf8');
const preferenceKey = 'dashora_expansion_state';
const sharedKey = 'share:' + 'a'.repeat(64);
const notes = [
  { title: 'First', description: 'First note', descriptionFormat: 'plain', descriptionDirection: 'ltr' },
  { title: '\u0627\u0644\u062b\u0627\u0646\u064a\u0629', description: '\u0645\u0631\u062d\u0628\u0627', descriptionFormat: 'plain', descriptionDirection: 'rtl' },
  { title: 'Third', description: 'Literal **text**', descriptionFormat: 'plain', descriptionDirection: 'auto' },
];
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function setup({ storage = new Map(), readFails = false, writeFails = false, readyState = 'complete' } = {}) {
  const errors = [], warnings = [], loaded = [];
  const context = vm.createContext({
    esc, escAttr: esc, crypto: webcrypto, TextEncoder, URL, URLSearchParams,
    localStorage: {
      getItem: key => { if (readFails) throw new Error('Storage blocked'); return storage.get(key) ?? null; },
      setItem: (key, value) => { if (writeFails) throw new Error('Storage full'); storage.set(key, value); },
    },
    document: {
      readyState, querySelectorAll: () => [],
      addEventListener: (name, callback) => { assert.equal(name, 'DOMContentLoaded'); loaded.push(callback); },
    },
    console: { error: (...args) => errors.push(args) },
    toast: message => warnings.push(message),
    expandedItems: new Set(), getItemProtection: () => ({ isProtected: false }),
    renderMain: () => {}, renderSidebar: () => {}, closeSidebar: () => {},
    activeView: 'board', activeSectionId: null, sectionSearchTerm: '',
    requestChangeBackup: () => { throw new Error('View preferences must not trigger content backups'); },
    persist: () => { throw new Error('View preferences must not change item data'); },
  });
  vm.runInContext(markdown, context);
  vm.runInContext(app.slice(app.indexOf('function toggleExpand('), app.indexOf('function toggleDoneSection(')), context);
  vm.runInContext(app.slice(app.indexOf('function selectSection('), app.indexOf('function toggleSidebar(')), context);
  return { context, storage, errors, warnings, loaded };
}

function makeSection(key, states) {
  const section = {
    dataset: { viewKey: key },
    querySelectorAll: () => section.cards,
    querySelector: () => section.button,
  };
  section.cards = states.map((open, index) => ({
    open, isConnected: true, dataset: { viewKey: key, noteIndex: String(index) },
    closest: () => section,
  }));
  section.button = { textContent: '', attributes: {},
    closest: () => section,
    setAttribute(name, value) { this.attributes[name] = value; } };
  return section;
}

test('default views remain collapsed items with expanded descriptions and notes', () => {
  const { context } = setup();
  assert.deepEqual(clone(context.readExpandedItemIds()), []);
  assert.match(context.renderCollapsibleDescription('Main', 'plain', 'auto', 7), /class="item-description" open/);
  const html = context.renderItemNotes(notes, 7);
  assert.equal((html.match(/class="item-note" open/g) || []).length, 3);
  assert.match(html, /aria-label="Collapse all notes"/);
});

test('both open and closed item states survive navigation and a new page context', () => {
  const first = setup();
  first.context.toggleExpand(7);
  first.context.toggleExpand(8);
  first.context.toggleExpand(8);
  first.context.selectSection(2);
  first.context.selectSection(1);
  assert.equal(first.context.expandedItems.has(7), true);
  assert.equal(first.context.expandedItems.has(8), false);
  const second = setup({ storage: first.storage });
  assert.deepEqual(clone(second.context.readExpandedItemIds()), [7]);
  assert.equal(second.context.getExpansionState('item:8').item, false);
});

test('description and individual note states survive reload independently', () => {
  const first = setup();
  first.context.onDescriptionToggle({ isConnected: true, dataset: { viewKey: 'item:7' }, open: false });
  first.context.setExpansionValue('item:7', 'notes', [false, true, false]);
  const second = setup({ storage: first.storage });
  assert.doesNotMatch(second.context.renderCollapsibleDescription('Main', 'plain', 'rtl', 7), /class="item-description" open/);
  assert.deepEqual(clone(second.context.getNoteOpenStates('item:7', 3)), [false, true, false]);
  second.context.onDescriptionToggle({ dataset: { viewKey: 'item:7' }, open: true });
  const third = setup({ storage: first.storage });
  assert.match(third.context.renderCollapsibleDescription('Main', 'plain', 'rtl', 7), /class="item-description" open/);
});

test('collapse all and expand all affect only that item and synchronize mounted readers', () => {
  const { context, storage } = setup();
  const board = makeSection('item:7', [true, false, true]);
  const reader = makeSection('item:7', [true, false, true]);
  context.document.querySelectorAll = selector => {
    assert.equal(selector, '.item-notes[data-view-key="item:7"]');
    return [board, reader];
  };
  context.setExpansionValue('item:8', 'notes', [true, false]);
  context.toggleAllNotes(board.button);
  assert.deepEqual(board.cards.map(card => card.open), [false, false, false]);
  assert.deepEqual(reader.cards.map(card => card.open), [false, false, false]);
  assert.equal(board.button.textContent, 'Expand all');
  assert.equal(reader.button.attributes['aria-label'], 'Expand all notes');
  assert.deepEqual(clone(context.getNoteOpenStates('item:8', 2)), [true, false]);
  assert.match(setup({ storage }).context.renderItemNotes(notes, 7), /aria-label="Expand all notes"/);
  context.toggleAllNotes(reader.button);
  assert.deepEqual(board.cards.map(card => card.open), [true, true, true]);
  assert.deepEqual(clone(setup({ storage }).context.getNoteOpenStates('item:7', 3)), [true, true, true]);
});

test('individual note toggles update the bulk label and saved state without rerendering text', () => {
  const { context } = setup();
  const section = makeSection('item:7', [true, true]);
  context.document.querySelectorAll = () => [section];
  section.cards[0].open = false;
  context.onItemNoteToggle(section.cards[0]);
  section.cards[1].open = false;
  context.onItemNoteToggle(section.cards[1]);
  assert.equal(section.button.textContent, 'Expand all');
  section.cards[1].open = true;
  context.onItemNoteToggle(section.cards[1]);
  assert.equal(section.button.textContent, 'Collapse all');
  assert.deepEqual(clone(context.getNoteOpenStates('item:7', 2)), [false, true]);
});

test('stale toggle events from removed elements cannot overwrite a remapped state', () => {
  const { context } = setup();
  context.setExpansionValue('item:7', 'notes', [false, true]);
  context.onItemNoteToggle({ isConnected: false, dataset: { viewKey: 'item:7', noteIndex: '0' }, open: true });
  context.setExpansionValue('item:7', 'description', false);
  context.onDescriptionToggle({ isConnected: false, dataset: { viewKey: 'item:7' }, open: true });
  assert.deepEqual(clone(context.getNoteOpenStates('item:7', 2)), [false, true]);
  assert.equal(context.getExpansionState('item:7').description, false);
});

test('states follow moved/deleted notes, survive reload, and new notes start open', () => {
  const { context, storage } = setup();
  context.setExpansionValue('item:7', 'notes', [false, true, false]);
  context.remapNoteViews(7, 3, 0, 2);
  assert.deepEqual(clone(context.getNoteOpenStates('item:7', 3)), [true, false, false]);
  context.remapNoteViews(7, 3, 1);
  assert.deepEqual(clone(setup({ storage }).context.getNoteOpenStates('item:7', 3)), [true, false, true]);
});

test('deletion, import/reset and automatic-deletion pruning do not reuse unrelated view preferences', () => {
  const { context, storage } = setup();
  for (const id of [7, 8, 9]) context.rememberItemExpanded(id, true);
  context.setExpansionValue(sharedKey, 'notes', [false]);
  context.pruneItemViews([7, 9]);
  assert.equal(context.expandedItems.has(8), false);
  assert.deepEqual(clone(setup({ storage }).context.readExpandedItemIds()), [7, 9]);
  context.forgetItemViews([7]);
  assert.equal(context.getExpansionState('item:7').item, undefined);
  context.forgetItemViews();
  assert.deepEqual(clone(setup({ storage }).context.readExpandedItemIds()), []);
  assert.deepEqual(clone(context.getNoteOpenStates(sharedKey, 1)), [false]);
});

for (const raw of ['not JSON', '{"version":2,"states":{}}',
  '{"version":1,"states":[]}', '{"version":1,"states":{"item:7":{"notes":[null]}}}',
  '{"version":1,"states":{"item:7":{"item":"false"}}}', '{"version":1,"states":{"__proto__":{}}}',
  '{"version":1,"states":{"item:99999999999999999999":{"item":true}}}']) {
  test('invalid saved preferences are reported and fall back safely: ' + raw, () => {
    const { context, errors, warnings } = setup({ storage: new Map([[preferenceKey, raw]]) });
    assert.deepEqual(clone(context.readExpandedItemIds()), []);
    assert.equal(errors.length, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Could not load open\/closed preferences/);
  });
}

test('blocked storage reads notify after startup; failed writes keep the current view usable', () => {
  const unreadable = setup({ readFails: true, readyState: 'loading' });
  unreadable.context.readExpandedItemIds();
  assert.equal(unreadable.errors.length, 1);
  assert.equal(unreadable.warnings.length, 0);
  unreadable.loaded[0]();
  assert.equal(unreadable.warnings.length, 1);
  const unwritable = setup({ writeFails: true });
  unwritable.context.rememberItemExpanded(7, true);
  assert.equal(unwritable.context.expandedItems.has(7), true);
  assert.deepEqual(clone(unwritable.context.readExpandedItemIds()), [7]);
  assert.equal(unwritable.storage.has(preferenceKey), false);
  assert.match(unwritable.warnings[0], /only be remembered until reload/);
});

test('read-only full-screen notes share local collapse state without edit or drag controls', () => {
  const { context } = setup();
  vm.runInContext(share, context);
  context.setExpansionValue('item:7', 'notes', [false, true, false]);
  const html = context.renderSharedItemContent({ boardType: 'reference', description: '',
    notes, followups: [] }, 7);
  assert.match(html, /data-view-key="item:7"/);
  assert.equal((html.match(/class="item-note" open/g) || []).length, 1);
  assert.match(html, /aria-label="Collapse all notes"/);
  assert.doesNotMatch(html, /openItemNoteEditor|deleteItemNote|draggable=/);
  assert.match(html, /shareNote\(event, 7, 0\)/);
  const shared = context.renderSharedItemContent({ boardType: 'reference', description: '', notes, followups: [] });
  assert.doesNotMatch(shared, /shareNote\(/);
});

function sharedHarness() {
  const result = setup();
  const elements = new Map();
  result.context.document.getElementById = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', innerHTML: '', hidden: false, active: false,
      classList: { add: () => { elements.get(id).active = true; } },
      replaceChildren: () => { elements.get(id).innerHTML = ''; },
      focus: () => {},
    });
    return elements.get(id);
  };
  result.context.window = { location: { href: 'https://example.com/' } };
  result.context.closeModal = id => { result.context.document.getElementById(id).active = false; };
  vm.runInContext(share, result.context);
  const item = { boardType: 'reference', title: 'Private shared title', description: 'Private shared text',
    descriptionFormat: 'plain', descriptionDirection: 'auto', notes, followups: [] };
  result.context.decodeItemShareUrl = () => item;
  result.context.refreshSharedItemBoards = () => {};
  return { ...result, elements, item };
}

test('shared readers persist per-payload state using a digest, never plaintext item data or URLs', async () => {
  const { context, storage, item, elements } = sharedHarness();
  const key = 'share:' + createHash('sha256').update(JSON.stringify(item)).digest('hex');
  await context.openSharedItemFromUrl();
  assert.match(elements.get('sharedItemContent').innerHTML, new RegExp(key));
  context.setExpansionValue(key, 'description', false);
  context.setExpansionValue(key, 'notes', [false, false, false]);
  await context.openSharedItemFromUrl();
  const html = elements.get('sharedItemContent').innerHTML;
  assert.doesNotMatch(html, /class="item-description" open/);
  assert.match(html, /aria-label="Expand all notes"/);
  const stored = storage.get(preferenceKey);
  assert.ok(!stored.includes(item.title) && !stored.includes(item.description) && !stored.includes(notes[1].description));
  assert.deepEqual(clone(setup({ storage }).context.getNoteOpenStates(key, 3)), [false, false, false]);
});

test('closing a shared reader while its digest is loading cannot reopen it', async () => {
  const { context, elements } = sharedHarness();
  let release;
  context.crypto = { subtle: { digest: () => new Promise(resolve => { release = resolve; }) } };
  const pending = context.openSharedItemFromUrl();
  context.closeSharedItemModal(false);
  release(new Uint8Array(32).buffer);
  await pending;
  assert.equal(elements.get('sharedItemModal').active, false);
  assert.equal(elements.get('sharedItemContent').innerHTML, '');
});
