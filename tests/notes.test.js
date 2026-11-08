const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const markdown = fs.readFileSync(path.join(root, 'js', 'markdown.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const share = fs.readFileSync(path.join(root, 'js', 'share.js'), 'utf8');
const database = fs.readFileSync(path.join(root, 'js', 'db.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const source = '## \u0645\u0631\u062d\u0628\u0627\n\n**Keep** two spaces  \nnext line\n\n```js\nconst value = 1;\n```\n';
const note = { title: 'Investigation', description: source, descriptionFormat: 'markdown', descriptionDirection: 'rtl' };
const plain = { title: '', description: 'Literal **text**', descriptionFormat: 'plain', descriptionDirection: 'auto' };
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function helpers(extra = {}) {
  const errors = [];
  const context = vm.createContext({
    esc, escAttr: esc,
    document: { querySelectorAll: () => [] },
    console: { error: (...args) => errors.push(args) },
    ...extra,
  });
  vm.runInContext(markdown, context);
  return { context, errors };
}

test('notes retain exact Markdown, order, optional titles and separate directions', () => {
  const { context } = helpers();
  const notes = context.parseItemNotes(JSON.stringify([note, plain]));
  assert.deepEqual(clone(notes), [note, plain]);
  assert.deepEqual(clone(context.validateItemNotes()), []);
  assert.notEqual(notes[0], note);
});

for (const invalid of [null, {}, '', [null], [{}], [{ ...note, title: null }],
  [{ ...note, description: '' }], [{ ...note, description: ' \n' }],
  [{ ...note, descriptionFormat: 'html' }], [{ ...note, descriptionDirection: 'sideways' }],
  [{ ...note, descriptionDirection: 'rtl" onclick="alert(1)' }]]) {
  test('rejects invalid notes: ' + JSON.stringify(invalid), () => {
    const { context } = helpers();
    assert.throws(() => context.validateItemNotes(invalid));
    assert.throws(() => context.parseItemNotes(JSON.stringify(invalid)));
  });
}

test('legacy imports without notes are accepted; malformed notes reject before deletion', () => {
  const calls = [];
  const { context } = helpers({ db: { run: sql => calls.push(sql) } });
  vm.runInContext(app.slice(app.indexOf('function applySnapshot('), app.indexOf('async function restoreBackup(')), context);
  assert.doesNotThrow(() => context.validateDescriptionMetadata([{ columns: ['description'], values: [['Old text']] }]));
  assert.doesNotThrow(() => context.validateDescriptionMetadata([{ columns: ['notes'], values: [[JSON.stringify([note])]] }]));
  assert.throws(() => context.applySnapshot({
    sections: [], items: [{ columns: ['notes'], values: [['not JSON']] }],
  }));
  assert.deepEqual(calls, []);
});

for (const exists of [false, true]) {
  test('notes schema preserves older descriptions and migrates once: exists=' + exists, () => {
    const statements = [];
    const context = vm.createContext({
      db: {
        exec: sql => sql.startsWith('PRAGMA') ? [{ values: [
          [0, 'description_format'], [1, 'description_direction'], ...(exists ? [[2, 'notes']] : []),
        ] }] : [],
        run: sql => statements.push(sql),
      },
    });
    vm.runInContext(database, context);
    context.createTables();
    assert.match(statements.find(sql => sql.includes('CREATE TABLE IF NOT EXISTS items')), /notes TEXT NOT NULL DEFAULT '\[\]'/);
    assert.equal(statements.filter(sql => sql.startsWith('ALTER TABLE items ADD COLUMN notes')).length, exists ? 0 : 1);
    assert.equal(statements.some(sql => sql.includes('UPDATE items SET description')), false);
  });
}

test('plain note titles and bodies are escaped, with compact collapse/edit/delete controls', () => {
  const { context } = helpers();
  const html = context.renderItemNotes([{ ...plain, title: '<script>Title</script>', description: '<img src=x onerror=alert(1)>' }], 7);
  assert.match(html, /<details class="item-note" open\b/);
  assert.match(html, /&lt;script&gt;Title&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /openItemNoteEditor\(event, 7, 0\)/);
  assert.match(html, /deleteItemNote\(event, 7, 0\)/);
  assert.match(html, /\+ Add note/);
  assert.doesNotMatch(html, /<script>|<img /);
});

test('shared/read-only notes have no mutation controls, and empty readers have no extra panel', () => {
  const { context } = helpers();
  const html = context.renderItemNotes([plain]);
  assert.match(html, /Note 1/);
  assert.doesNotMatch(html, /openItemNoteEditor|deleteItemNote|Add note/);
  assert.equal(context.renderItemNotes([]), '');
  assert.match(context.renderItemNotes([], 7), /\+ Add note/);
});

test('task and reference notes use the wide editor with roomy writing and preview areas', () => {
  assert.match(app, /classList\.toggle\('item-modal-wide', isRef \|\| !!noteEditor\)/);
  assert.match(css, /#itemModal\.editing-note #itemDesc,\s*#itemModal\.editing-note \.description-preview\s*\{\s*min-height:\s*clamp\(220px, 42vh, 440px\)/);
  assert.match(css, /#itemModal\.editing-note \.modal-actions\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/);
  assert.match(css, /#itemModal\.editing-note \.modal\s*\{\s*max-height:\s*calc\(100dvh - 32px\)/);
});

test('damaged note rendering reports an explicit visible error', () => {
  const { context, errors } = helpers();
  assert.match(context.renderItemNotes(null), /role="alert"/);
  assert.equal(errors.length, 1);
});

test('the main description starts expanded and keeps its original text and writing direction', () => {
  const { context } = helpers();
  const html = context.renderCollapsibleDescription(source, 'plain', 'rtl', 7);
  assert.match(html, /<details class="item-description" open/);
  assert.match(html, /<summary><span class="item-description-title">Description<\/span><\/summary>/);
  assert.match(html, /<div class="item-detail-desc" dir="rtl">/);
  assert.ok(html.includes(esc(source)));
});

test('main-description collapse survives rerendering and resets independently per item', () => {
  const { context } = helpers();
  context.onDescriptionToggle({ dataset: { descriptionItemId: '7' }, open: false });
  assert.doesNotMatch(context.renderCollapsibleDescription('Main', 'plain', 'auto', 7), /class="item-description" open/);
  assert.match(context.renderCollapsibleDescription('Other item', 'plain', 'auto', 8), /class="item-description" open/);
  assert.match(context.renderCollapsibleDescription('Shared reader'), /class="item-description" open/);
  context.onDescriptionToggle({ dataset: { descriptionItemId: '7' }, open: true });
  assert.match(context.renderCollapsibleDescription('Main', 'plain', 'auto', 7), /class="item-description" open/);
});

test('changing description collapse synchronizes other mounted readers of the same item', () => {
  const changed = { dataset: { descriptionItemId: '7' }, open: false };
  const sibling = { open: true };
  const { context } = helpers({ document: { querySelectorAll: selector => {
    assert.equal(selector, '.item-description[data-description-item-id="7"]');
    return [changed, sibling];
  } } });
  context.onDescriptionToggle(changed);
  assert.equal(sibling.open, false);
  changed.open = true;
  context.onDescriptionToggle(changed);
  assert.equal(sibling.open, true);
});

test('shared and full-screen main descriptions collapse without nesting a second control in notes', () => {
  const { context } = helpers();
  vm.runInContext(share.slice(share.indexOf('function renderSharedItemContent('), share.indexOf('function openSharedItemFromUrl(')), context);
  const item = { boardType: 'reference', description: 'Original', descriptionFormat: 'plain',
    descriptionDirection: 'auto', notes: [plain], followups: [] };
  context.onDescriptionToggle({ dataset: { descriptionItemId: '7' }, open: false });
  const fullscreen = context.renderSharedItemContent(item, 7);
  assert.doesNotMatch(fullscreen, /class="item-description" open/);
  assert.equal((fullscreen.match(/class="item-description"/g) || []).length, 1);
  assert.ok(fullscreen.indexOf('<section class="item-notes"') > fullscreen.indexOf('</details>'));
  assert.doesNotMatch(context.renderItemNotes([plain]), /class="item-description"/);
  assert.match(context.renderSharedItemContent(item), /class="item-description" open/);
});

test('search matches note titles and bodies', () => {
  const { context } = helpers();
  assert.equal(context.itemNotesMatch([note], 'investigation'), true);
  assert.equal(context.itemNotesMatch([note], 'const value'), true);
  assert.equal(context.itemNotesMatch([note], '\u0645\u0631\u062d\u0628\u0627'), true);
  assert.equal(context.itemNotesMatch([note], 'absent'), false);
});

test('old share URLs default to no notes; multiple notes round-trip without credentials', () => {
  const { context } = helpers({
    URL, URLSearchParams, TextEncoder, TextDecoder,
    window: { location: { href: 'https://example.com/' } },
    bytesToBase64: bytes => Buffer.from(bytes).toString('base64'),
    base64ToBytes: value => Buffer.from(value, 'base64'),
  });
  vm.runInContext(share, context);
  const item = {
    title: 'Scenario', description: 'Original', descriptionFormat: 'plain', descriptionDirection: 'auto',
    link: '', sketchData: null, boardType: 'reference', status: 0, dueDate: null,
    recurring: 0, recurringDays: null, recurringTime: null, followups: [],
  };
  assert.deepEqual(clone(context.decodeItemShareUrl(context.encodeItemShareUrl(item)).notes), []);
  const encoded = context.encodeItemShareUrl({ ...item, notes: [note, plain], passwordHash: 'private-verifier' });
  assert.deepEqual(clone(context.decodeItemShareUrl(encoded).notes), [note, plain]);
  assert.throws(() => context.encodeItemShareUrl({ ...item, notes: [{ ...note, descriptionFormat: 'html' }] }));
  assert.ok(!Buffer.from(new URL(encoded).hash.slice(7), 'base64url').toString().includes('private-verifier'));
});

function mutations({ encrypted = false, failPersist = false, cancelEncryption = false } = {}) {
  const calls = [];
  const originalFields = [encrypted ? '[]' : JSON.stringify([plain]), encrypted ? 'old-cipher' : null,
    encrypted ? 'old-iv' : null, encrypted ? 1 : null];
  let fields = [...originalFields];
  const decrypted = new Map([[7, { title: 'Scenario', description: 'Original description', link: '', sketchData: null, notes: [plain] }]]);
  const elements = {
    itemTitle: { value: note.title }, itemDesc: { value: source, focus: () => {} }, itemModalTitle: {},
    itemModal: { classList: { contains: () => true } },
  };
  const { context } = helpers({
    document: { getElementById: id => elements[id] },
    getItemProtection: () => ({ isProtected: encrypted, isEncrypted: encrypted, passwordHash: 'verifier' }),
    getItemContent: () => ({ title: 'Scenario', description: 'Original description', link: '',
      sketchData: null, notes: encrypted ? clone(decrypted.get(7).notes) : JSON.parse(fields[0]) }),
    encryptProtectedItemContent: async (_, payload) => {
      calls.push({ payload: clone(payload) });
      return cancelEncryption ? null : { encryptedData: 'new-cipher', encryptionIv: 'new-iv', encryptionVersion: 1 };
    },
    db: {
      exec: () => [{ values: [[...fields]] }],
      run: (sql, args) => {
        assert.match(sql, /^UPDATE items SET notes/);
        assert.equal((sql.match(/\?/g) || []).length, args.length);
        assert.equal(args.at(-1), 7);
        calls.push({ sql, args: [...args] });
        fields = [...args].slice(0, 4);
      },
    },
    persist: async () => { if (failPersist) throw new Error('Storage unavailable'); calls.push('persist'); },
    requestChangeBackup: reason => calls.push({ backup: reason }),
    decryptedProtectedItems: decrypted, expandedItems: new Set(),
    itemSaveInProgress: false, itemEditorChanged: true, itemEditorChangeRevision: 0,
    itemNoteEditor: { itemId: 7, index: null, originalNotes: JSON.stringify([plain]) },
    readItemDescription: () => ({ source: elements.itemDesc.value, format: 'markdown', direction: 'rtl' }),
    closeItemModal: () => calls.push('close'),
    scheduleAutoSave: () => calls.push('schedule'),
    toast: text => calls.push({ toast: text }),
    renderSidebar: () => {}, renderMain: () => {},
    confirm: () => true,
  });
  vm.runInContext(app.slice(app.indexOf('function openItemNoteEditor('), app.indexOf('function deleteItem(')), context);
  vm.runInContext(app.slice(app.indexOf('function hasItemNoteChanges('), app.indexOf('function closeItemModal(')), context);
  return { context, calls, elements, originalFields, fields: () => fields, decrypted };
}

test('saving a note leaves parent fields unchanged and appends exactly once', async () => {
  const { context, calls, fields } = mutations();
  assert.equal(await context.saveItemNoteOnce(), true);
  assert.deepEqual(JSON.parse(fields()[0]), [plain, note]);
  assert.equal(calls.filter(call => call.sql).length, 1);
  assert.ok(calls.includes('close'));
  assert.ok(calls.some(call => call.backup === 'note-added'));
  assert.ok(context.expandedItems.has(7));
});

test('note auto-save keeps the editor open and subsequent saves update rather than duplicate', async () => {
  const { context, calls, elements, fields } = mutations();
  assert.equal(await context.saveItemNoteOnce(true), true);
  assert.equal(context.itemNoteEditor.index, 1);
  assert.equal(context.itemEditorChanged, false);
  context.markItemEditorChanged();
  assert.equal(context.itemEditorChanged, false, 'Blurring a saved textarea must not mark it dirty again');
  assert.equal(calls.includes('close'), false);
  elements.itemDesc.value += '\nAnother paragraph';
  assert.equal(await context.saveItemNoteOnce(true), true);
  assert.equal(JSON.parse(fields()[0]).length, 2);
  assert.equal(JSON.parse(fields()[0])[1].description, elements.itemDesc.value);
  assert.deepEqual(calls.filter(call => call.backup).map(call => call.backup), ['note-added', 'note-updated']);
});

test('empty notes are notified and cannot be stored', async () => {
  const { context, calls, elements, fields, originalFields } = mutations();
  elements.itemDesc.value = ' \n';
  assert.equal(await context.saveItemNoteOnce(), false);
  assert.ok(calls.some(call => call.toast === 'Note text is required'));
  assert.deepEqual(fields(), originalFields);
});

test('unchanged note auto-saves do not write duplicate backups', async () => {
  const { context, calls } = mutations();
  assert.equal(await context.saveItemNoteOnce(true), true);
  assert.equal(await context.saveItemNoteOnce(true), false);
  assert.equal(calls.filter(call => call.sql).length, 1);
  assert.deepEqual(calls.filter(call => call.backup).map(call => call.backup), ['note-added']);
});

test('storage failures roll back notes and keep the draft/editor intact', async () => {
  const { context, calls, fields, originalFields } = mutations({ failPersist: true });
  await assert.rejects(context.saveItemNoteOnce(), /Storage unavailable/);
  assert.deepEqual(fields(), originalFields);
  assert.equal(calls.includes('close'), false);
  assert.equal(context.itemNoteEditor.index, null);
});

test('notes changed during editing cannot be overwritten', async () => {
  const { context, fields, originalFields } = mutations();
  context.itemNoteEditor.originalNotes = '[]';
  await assert.rejects(context.saveItemNoteOnce(), /Notes changed while editing/);
  assert.deepEqual(fields(), originalFields);
});

test('encrypted notes join the parent ciphertext payload and never leak to the notes column', async () => {
  const { context, calls, fields, decrypted } = mutations({ encrypted: true });
  await context.saveItemNoteOnce();
  const payload = calls.find(call => call.payload).payload;
  assert.equal(payload.description, 'Original description');
  assert.deepEqual(payload.notes, [plain, note]);
  assert.deepEqual(fields(), ['[]', 'new-cipher', 'new-iv', 1]);
  assert.deepEqual(clone(decrypted.get(7).notes), [plain, note]);
});

test('canceling encryption leaves all stored fields and the draft untouched', async () => {
  const { context, calls, fields, originalFields } = mutations({ encrypted: true, cancelEncryption: true });
  assert.equal(await context.saveItemNoteOnce(), false);
  assert.deepEqual(fields(), originalFields);
  assert.equal(calls.some(call => call.sql), false);
});

test('delete removes only the requested note and rejects a stale index', async () => {
  const { context, fields, calls } = mutations();
  await context.updateItemNotes(7, notes => [...notes, note]);
  await context.deleteItemNote(null, 7, 0);
  assert.deepEqual(JSON.parse(fields()[0]), [note]);
  assert.ok(calls.some(call => call.backup === 'note-deleted'));
  await context.deleteItemNote(null, 7, 9);
  assert.deepEqual(JSON.parse(fields()[0]), [note]);
});

test('parent auto-save cannot accidentally overwrite the description while a note is open', async () => {
  const { context } = helpers({
    itemNoteEditor: { itemId: 7 },
    document: { getElementById: () => { throw new Error('Must not read parent fields'); } },
  });
  vm.runInContext(app.slice(app.indexOf('async function silentSaveItem('), app.indexOf('function scheduleAutoSave(')), context);
  assert.equal(await context.silentSaveItem(), false);
});

test('clipboard copies include every note in order without losing the original description', () => {
  let copied;
  const { context } = helpers({
    getItemProtection: () => ({ isProtected: false, isEncrypted: false }),
    getItemContent: () => ({ title: 'Scenario', description: 'Original', notes: [plain, note], link: 'https://example.com' }),
    copyItemText: value => { copied = value; },
    toast: () => {},
  });
  vm.runInContext(app.slice(app.indexOf('function copyItem('), app.indexOf('function copyItemText(')), context);
  context.copyItem(null, 7);
  assert.equal(copied, ['Scenario', 'Original', plain.description, note.title + '\n' + source, 'https://example.com'].join('\n'));
});

test('actual AES-GCM encryption preserves exact note content and contains no plaintext notes', async () => {
  const { context } = helpers({
    crypto: webcrypto, TextEncoder, TextDecoder, ENCRYPTION_VERSION: 1,
    bytesToBase64: bytes => Buffer.from(bytes).toString('base64'),
    base64ToBytes: value => Buffer.from(value, 'base64'),
  });
  vm.runInContext(app.slice(app.indexOf('async function encryptPayloadWithKey('), app.indexOf('function getItemProtection(')), context);
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const payload = { title: 'Private', description: 'Original', notes: [note, plain] };
  const encrypted = await context.encryptPayloadWithKey(payload, key);
  assert.ok(!JSON.stringify(encrypted).includes('Investigation'));
  assert.deepEqual(clone(await context.decryptPayloadWithKey(encrypted.encryptedData, encrypted.encryptionIv, key, encrypted.encryptionVersion)), payload);
});
