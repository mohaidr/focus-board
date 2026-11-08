const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const markdown = fs.readFileSync(path.join(root, 'js', 'markdown.js'), 'utf8');
const share = fs.readFileSync(path.join(root, 'js', 'share.js'), 'utf8');
const original = [
  { title: 'First', description: '## First\n\n**Bold**  \nnext line\n', descriptionFormat: 'markdown', descriptionDirection: 'ltr' },
  { title: '\u0627\u0644\u062b\u0627\u0646\u064a\u0629', description: '\u0645\u0631\u062d\u0628\u0627\n\n```js\nconst x = 1;\n```\n', descriptionFormat: 'markdown', descriptionDirection: 'rtl' },
  { title: 'Third', description: 'Literal **text**', descriptionFormat: 'plain', descriptionDirection: 'auto' },
];
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function makeCard(itemId, index, open = true) {
  const classes = new Set();
  const captured = new Set();
  const card = {
    dataset: { noteItemId: String(itemId), noteIndex: String(index) }, open, classes,
    classList: { add: name => classes.add(name), remove: (...names) => names.forEach(name => classes.delete(name)) },
    contains: node => node === card || node === card.handle,
    closest: selector => selector.startsWith('.item-note') ? card : null,
    querySelector: selector => selector === 'summary' ? card.summary : card.handle,
  };
  card.summary = { getBoundingClientRect: () => ({ top: index * 50, height: 40 }) };
  card.handle = {
    closest: () => card,
    setPointerCapture: id => captured.add(id),
    hasPointerCapture: id => captured.has(id),
    releasePointerCapture: id => captured.delete(id),
    focus: () => { card.focused = true; },
  };
  return card;
}

function setup({ encrypted = false, failPersist = false, cancelEncryption = false, delayedFrame = false } = {}) {
  const calls = [];
  const errors = [];
  let fields = [encrypted ? '[]' : JSON.stringify(original), encrypted ? 'old-cipher' : null, encrypted ? 'old-iv' : null, encrypted ? 1 : null];
  let cards = original.map((_, index) => makeCard(7, index, index !== 1));
  let point = null;
  let frame;
  const modal = { active: false, classList: { contains: () => modal.active } };
  const scroller = { clientHeight: 500, scrollHeight: 500, scrollTop: 0, getBoundingClientRect: () => ({ top: 0, bottom: 500 }) };
  const decrypted = new Map([[7, { title: 'Parent', description: 'Original parent', link: '', sketchData: null, notes: clone(original) }]]);
  const notes = () => encrypted ? clone(decrypted.get(7).notes) : JSON.parse(fields[0]);
  const context = vm.createContext({
    console: { error: (...args) => errors.push(args) },
    URL, URLSearchParams, TextEncoder, TextDecoder, esc, escAttr: esc,
    window: { innerHeight: 500, location: { href: 'https://example.com/' } },
    bytesToBase64: bytes => Buffer.from(bytes).toString('base64'),
    base64ToBytes: value => Buffer.from(value, 'base64'),
    itemSaveInProgress: false, noteDragState: null, dragItemId: 91, dragSectionId: 92,
    expandedItems: new Set(), decryptedProtectedItems: decrypted,
    document: {
      getElementById: id => id === 'itemModal' ? modal : scroller,
      querySelectorAll: selector => selector.startsWith('.item-note[data-note-item-id=') ? cards : cards.filter(card =>
        [...card.classes].some(name => ['note-dragging', 'note-drop-before', 'note-drop-after'].includes(name))),
      elementFromPoint: () => point,
    },
    requestAnimationFrame: callback => { if (delayedFrame) frame = callback; else callback(); },
    getItemProtection: () => ({ isProtected: encrypted, isEncrypted: encrypted, passwordHash: 'fake-verifier' }),
    getItemContent: () => ({
      title: 'Parent', description: 'Original parent', descriptionFormat: 'plain', descriptionDirection: 'auto',
      link: '', sketchData: null, notes: notes(), boardType: 'reference', status: 0, dueDate: null,
      recurring: 0, recurringDays: null, recurringTime: null, followups: [],
    }),
    encryptProtectedItemContent: async (_, payload) => {
      calls.push({ payload: clone(payload) });
      return cancelEncryption ? null : { encryptedData: 'new-cipher', encryptionIv: 'new-iv', encryptionVersion: 1 };
    },
    db: {
      exec: () => [{ values: [[...fields]] }],
      run: (sql, args) => {
        assert.match(sql, /^UPDATE items SET notes/);
        assert.equal((sql.match(/\?/g) || []).length, args.length);
        calls.push({ sql, args: [...args] });
        fields = [...args].slice(0, 4);
      },
    },
    persist: async () => { if (failPersist) throw new Error('Storage unavailable'); calls.push('persist'); },
    requestChangeBackup: reason => calls.push({ backup: reason }),
    renderMain: () => { cards = notes().map((_, index) => makeCard(7, index)); calls.push('render'); },
    toast: text => calls.push({ toast: text }),
  });
  vm.runInContext(markdown, context);
  const readContent = context.getItemContent;
  vm.runInContext(share, context);
  context.getItemContent = readContent;
  vm.runInContext(app.slice(app.indexOf('async function updateItemNotes('), app.indexOf('async function saveItemNoteOnce(')), context);
  vm.runInContext(app.slice(app.indexOf('function getNoteDropIndex('), app.indexOf('function deleteItem(')), context);
  vm.runInContext(app.slice(app.indexOf('function onItemDragOver('), app.indexOf('function onSectionDragStart(')), context);
  return { context, calls, errors, modal, scroller, notes, fields: () => fields, cards: () => cards,
    point: card => { point = card; }, frame: () => frame?.() };
}

function event(type, target, y = 0) {
  return {
    type, currentTarget: target, clientX: 20, clientY: y, stopped: false, prevented: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
    dataTransfer: { data: {}, setData(type, value) { this.data[type] = value; }, setDragImage() {} },
  };
}

for (let from = 0; from < 3; from++) {
  for (let target = 0; target < 3; target++) {
    for (const after of [false, true]) {
      test(`drop index is correct: ${from} ${after ? 'after' : 'before'} ${target}`, () => {
        const { context } = setup();
        const expected = [0, 1, 2];
        if (from !== target) {
          expected.splice(from, 1);
          expected.splice(expected.indexOf(target) + (after ? 1 : 0), 0, from);
        }
        const actual = [0, 1, 2];
        const index = context.getNoteDropIndex(from, target, after);
        actual.splice(from, 1);
        actual.splice(index, 0, from);
        assert.deepEqual(actual, expected);
      });
    }
  }
}

test('only grip buttons are draggable, and single-note/shared readers have no redundant grips', () => {
  const { context } = setup();
  const html = context.renderItemNotes(original, 7);
  assert.equal((html.match(/draggable="true"/g) || []).length, 3);
  assert.match(html, /onNotePointerDown/);
  assert.match(html, /aria-keyshortcuts="Alt\+ArrowUp Alt\+ArrowDown"/);
  assert.doesNotMatch(html.match(/<details[^>]+>/)[0], /draggable=/);
  assert.doesNotMatch(context.renderItemNotes(original), /draggable=|onNoteDrag|onNotePointer/);
  assert.doesNotMatch(context.renderItemNotes([original[0]], 7), /class="note-drag"/);
});

test('reordering persists exact note fields, collapse state and focus without changing the parent', async () => {
  const { context, notes, cards, calls } = setup();
  assert.equal(await context.moveItemNote(7, 0, 2), true);
  assert.deepEqual(notes(), [original[1], original[2], original[0]]);
  assert.equal(cards()[0].open, false);
  assert.equal(cards()[2].focused, true);
  assert.ok(calls.includes('persist'));
  assert.ok(calls.some(call => call.toast === 'Note order saved'));
  assert.ok(calls.some(call => call.backup === 'notes-reordered'));
  assert.ok(calls.filter(call => call.sql).every(call => !call.sql.includes('title =') && !call.sql.includes('status =')));
});

for (const [from, to] of [[-1, 0], [0, -1], [3, 0], [0, 3], [0.5, 1], [0, NaN]]) {
  test('invalid positions are reported without writing: ' + from + ' -> ' + to, async () => {
    const { context, calls, notes, errors } = setup();
    assert.equal(await context.moveItemNote(7, from, to), false);
    assert.deepEqual(notes(), original);
    assert.equal(calls.some(call => call.sql), false);
    assert.equal(errors.length, 1);
  });
}

test('dropping at the original position does not save or report a false move', async () => {
  const { context, calls } = setup();
  assert.equal(await context.moveItemNote(7, 1, 1), false);
  assert.equal(calls.some(call => call.sql || call.toast), false);
});

test('stale note content cannot be overwritten by a drag snapshot', async () => {
  const { context, notes, calls, errors } = setup();
  assert.equal(await context.moveItemNote(7, 0, 2, '[]'), false);
  assert.deepEqual(notes(), original);
  assert.equal(calls.some(call => call.sql), false);
  assert.equal(errors.length, 1);
});

test('editor and in-flight save guards prevent reorder writes', async () => {
  const { context, modal, calls } = setup();
  modal.active = true;
  assert.equal(await context.moveItemNote(7, 0, 1), false);
  modal.active = false;
  context.itemSaveInProgress = true;
  assert.equal(await context.moveItemNote(7, 0, 1), false);
  assert.equal(calls.some(call => call.sql), false);
});

for (const encrypted of [false, true]) {
  test('storage failure rolls back the original note order: encrypted=' + encrypted, async () => {
    const { context, notes, calls, errors, fields } = setup({ encrypted, failPersist: true });
    assert.equal(await context.moveItemNote(7, 0, 2), false);
    assert.deepEqual(notes(), original);
    if (encrypted) assert.deepEqual(fields(), ['[]', 'old-cipher', 'old-iv', 1]);
    assert.equal(calls.includes('render'), false);
    assert.equal(calls.some(call => call.toast === 'Note order saved'), false);
    assert.equal(errors.length, 1);
    assert.equal(context.itemSaveInProgress, false);
  });
}

test('encrypted ordering uses the existing ciphertext payload and keeps plaintext notes out of SQLite', async () => {
  const { context, calls, notes, fields } = setup({ encrypted: true });
  assert.equal(await context.moveItemNote(7, 2, 0), true);
  assert.deepEqual(notes(), [original[2], original[0], original[1]]);
  assert.equal(calls.find(call => call.payload).payload.description, 'Original parent');
  assert.deepEqual(calls.find(call => call.payload).payload.notes, notes());
  assert.deepEqual(fields(), ['[]', 'new-cipher', 'new-iv', 1]);
});

test('canceling encryption leaves the order unchanged and reports no success', async () => {
  const { context, notes, calls } = setup({ encrypted: true, cancelEncryption: true });
  assert.equal(await context.moveItemNote(7, 0, 2), false);
  assert.deepEqual(notes(), original);
  assert.equal(calls.some(call => call.sql || call.toast === 'Note order saved'), false);
});

test('native drag transfers only identifiers, stops propagation and drops after the target correctly', async () => {
  const { context, cards, notes } = setup();
  const start = event('dragstart', cards()[0].handle);
  context.onNoteDragStart(start, 7, 0);
  assert.equal(start.stopped, true);
  assert.deepEqual(JSON.parse(start.dataTransfer.data['application/x-dashora-note']), { itemId: 7, index: 0 });
  assert.equal(JSON.stringify(start.dataTransfer.data).includes(original[0].description), false);
  assert.equal(context.dragItemId, null);
  assert.equal(context.dragSectionId, null);
  const drop = event('drop', cards()[2], 130);
  await context.onNoteDrop(drop, 7, 2);
  assert.equal(drop.stopped, true);
  assert.deepEqual(notes(), [original[1], original[2], original[0]]);
  assert.equal(context.noteDragState, null);
});

test('native dragging cannot move a note to a different item or change parent-item status', async () => {
  const { context, cards, calls, notes } = setup();
  context.onNoteDragStart(event('dragstart', cards()[0].handle), 7, 0);
  await context.onNoteDrop(event('drop', makeCard(8, 0), 30), 8, 0);
  assert.deepEqual(notes(), original);
  assert.equal(calls.some(call => call.sql), false);
  context.onNoteDragStart(event('dragstart', cards()[0].handle), 7, 0);
  context.onColumnDrop(event('drop', {}), 2);
  assert.equal(calls.some(call => call.sql), false);
  assert.equal(context.noteDragState, null);
});

test('canceling a drag before the animation frame cannot leave a dragging class behind', () => {
  const { context, cards, frame } = setup({ delayedFrame: true });
  context.onNoteDragStart(event('dragstart', cards()[0].handle), 7, 0);
  context.clearNoteDrag();
  frame();
  assert.equal(cards()[0].classes.has('note-dragging'), false);
});

test('touch dragging reuses the same ordering logic and releases pointer capture', async () => {
  const { context, cards, point, notes } = setup();
  const handle = cards()[0].handle;
  const down = { ...event('pointerdown', handle, 10), pointerId: 3, pointerType: 'touch', button: 0 };
  context.onNotePointerDown(down, 7, 0);
  assert.equal(handle.hasPointerCapture(3), true);
  assert.equal(context.dragItemId, null);
  assert.equal(context.dragSectionId, null);
  point(cards()[2]);
  context.onNotePointerMove({ ...down, type: 'pointermove', clientY: 135 });
  await context.onNotePointerUp({ ...down, type: 'pointerup', clientY: 135 });
  assert.deepEqual(notes(), [original[1], original[2], original[0]]);
  assert.equal(handle.hasPointerCapture(3), false);
});

test('touch tap and pointer cancellation never reorder notes', async () => {
  const { context, cards, notes } = setup();
  const handle = cards()[0].handle;
  const down = { ...event('pointerdown', handle, 10), pointerId: 3, pointerType: 'touch', button: 0 };
  context.onNotePointerDown(down, 7, 0);
  await context.onNotePointerUp({ ...down, type: 'pointerup' });
  assert.deepEqual(notes(), original);
  context.onNotePointerDown(down, 7, 0);
  context.onNotePointerCancel({ ...down, type: 'pointercancel' });
  assert.equal(context.noteDragState, null);
  assert.equal(handle.hasPointerCapture(3), false);
});

test('touch dragging scrolls at an edge without moving notes until release', () => {
  const { context, cards, point, notes, scroller } = setup();
  scroller.scrollHeight = 1000;
  const down = { ...event('pointerdown', cards()[0].handle, 10), pointerId: 3, pointerType: 'touch', button: 0 };
  context.onNotePointerDown(down, 7, 0);
  point(cards()[2]);
  context.onNotePointerMove({ ...down, type: 'pointermove', clientY: 490 });
  assert.equal(scroller.scrollTop, 16);
  assert.deepEqual(notes(), original);
  context.onNotePointerCancel({ ...down, type: 'pointercancel' });
});

test('Alt+Up/Down orders notes without stealing ordinary arrow keys', async () => {
  const { context, cards, notes, calls } = setup();
  const key = { ...event('keydown', cards()[0].handle), key: 'ArrowDown', altKey: true };
  await context.onNoteOrderKeydown(key, 7, 0, 3);
  assert.deepEqual(notes(), [original[1], original[0], original[2]]);
  assert.equal(key.prevented, true);
  const count = calls.filter(call => call.sql).length;
  await context.onNoteOrderKeydown({ ...key, altKey: false }, 7, 0, 3);
  await context.onNoteOrderKeydown({ ...key, shiftKey: true }, 7, 0, 3);
  await context.onNoteOrderKeydown({ ...key, key: 'ArrowUp' }, 7, 0, 3);
  assert.equal(calls.filter(call => call.sql).length, count);
});

test('new share links preserve the reordered note sequence and exact Markdown', async () => {
  const { context } = setup();
  await context.moveItemNote(7, 0, 2);
  const item = context.getItemContent(7);
  const decoded = context.decodeItemShareUrl(context.encodeItemShareUrl(item));
  assert.deepEqual(clone(decoded.notes), [original[1], original[2], original[0]]);
});
