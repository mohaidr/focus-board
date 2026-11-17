const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const markdown = fs.readFileSync(path.join(__dirname, '..', 'js', 'markdown.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const database = fs.readFileSync(path.join(__dirname, '..', 'js', 'db.js'), 'utf8');
const share = fs.readFileSync(path.join(__dirname, '..', 'js', 'share.js'), 'utf8');
const original = '    keep indentation\n\n## \u0645\u0631\u062d\u0628\u0627\n\n**bold**  \nnext line\n';

function esc(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

for (const direction of ['auto', 'ltr', 'rtl']) {
  test(direction + ' is validated and rendered without changing plain-text content', () => {
    const context = vm.createContext({ esc });
    vm.runInContext(markdown, context);
    assert.equal(context.isDescriptionDirection(direction), true);
    assert.equal(context.renderDescription('**literal**\n<script>', 'plain', direction),
      '<div class="item-detail-desc" dir="' + direction + '">**literal**\n&lt;script&gt;</div>');
  });
}

for (const direction of ['', null, undefined, 1, 'sideways', 'rtl" onclick="alert(1)']) {
  test('invalid direction is rejected: ' + String(direction), () => {
    const context = vm.createContext({});
    vm.runInContext(markdown, context);
    assert.equal(context.isDescriptionDirection(direction), false);
    assert.throws(() => context.validateDescriptionMetadata([{
      columns: ['description_direction'], values: [[direction]],
    }]), /Unsupported description direction/);
  });
}

test('invalid render directions produce an explicit error, never injected attributes', () => {
  const errors = [];
  const context = vm.createContext({ esc, console: { error: message => errors.push(message) } });
  vm.runInContext(markdown, context);
  const html = context.renderDescription('source', 'plain', 'rtl" onclick="alert(1)');
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /onclick=/);
  assert.equal(errors.length, 1);
});

test('old imports without direction remain valid; format and direction are both checked when present', () => {
  const context = vm.createContext({});
  vm.runInContext(markdown, context);
  for (const items of [[], [{ columns: ['description'], values: [[original]] }],
    [{ columns: ['description_format'], values: [['markdown'], ['plain']] }],
    [{ columns: ['description_format', 'description_direction'], values: [['markdown', 'rtl'], ['plain', 'auto']] }]]) {
    assert.doesNotThrow(() => context.validateDescriptionMetadata(items));
  }
  assert.throws(() => context.validateDescriptionMetadata([{
    columns: ['description_format', 'description_direction'], values: [['html', 'rtl']],
  }]), /Unsupported description format/);
});

for (const direction of ['auto', 'ltr', 'rtl']) {
  test('sanitized Markdown blocks use ' + direction + ' while code remains left-to-right', () => {
    const blocks = Array.from({ length: 8 }, () => ({ attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }));
    const codes = Array.from({ length: 2 }, () => ({ attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }));
    const fragment = { querySelectorAll: selector => selector === 'pre, code' ? codes : blocks };
    let parsed;
    let options;
    const context = vm.createContext({
      esc, escAttr: esc,
      marked: { Marked: class { parse(source) { parsed = source; return '<p>safe</p>'; } } },
      DOMPurify: { isSupported: true, sanitize(html, config) { options = config; return fragment; } },
      document: { createElement: () => ({ append: value => assert.equal(value, fragment), innerHTML: '<p>safe</p>' }) },
    });
    vm.runInContext(markdown, context);
    assert.equal(context.renderDescriptionContent(original, 'markdown', direction), '<p>safe</p>');
    assert.equal(parsed, original);
    assert.equal(options.RETURN_DOM_FRAGMENT, true);
    assert.equal(options.ALLOWED_ATTR.includes('style'), false);
    assert.equal(options.ALLOWED_ATTR.includes('dir'), false);
    assert.equal(options.ALLOWED_TAGS.includes('script'), false);
    assert.ok(blocks.every(element => element.attributes.dir === direction));
    assert.ok(codes.every(element => element.attributes.dir === 'ltr'));
  });
}

for (const existingDirection of [false, true]) {
  test('schema migration defaults older items to Auto without repeating the column: exists=' + existingDirection, () => {
    const statements = [];
    const context = vm.createContext({
      db: {
        exec: sql => sql.startsWith('PRAGMA') ? [{ values: [
          [0, 'id'], [1, 'description_format'], ...(existingDirection ? [[2, 'description_direction']] : []),
        ] }] : [],
        run: sql => statements.push(sql),
      },
    });
    vm.runInContext(database, context);
    context.createTables();
    const create = statements.find(sql => sql.includes('CREATE TABLE IF NOT EXISTS items'));
    assert.match(create, /description_direction TEXT NOT NULL DEFAULT 'auto' CHECK \(description_direction IN \('auto', 'ltr', 'rtl'\)\)/);
    const migrations = statements.filter(sql => sql.startsWith('ALTER TABLE items ADD COLUMN description_direction'));
    assert.equal(migrations.length, existingDirection ? 0 : 1);
  });
}

function setup({ format = 'markdown', direction = 'rtl', edit = true, encrypted = false, notes = [] } = {}) {
  const calls = [];
  const values = {
    itemTitle: 'Title', itemDesc: original, itemDescFormat: format, itemDescDirection: direction,
    itemLink: '', itemRecurring: '0', editItemId: edit ? '7' : '', itemSectionId: '1',
    itemDueDate: '', itemRecurringTime: '',
  };
  const elements = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, {
    value, checked: false, hidden: true, style: {}, dir: '',
    classList: { contains: () => true, add: () => {}, toggle: () => {} },
    setAttribute: () => {}, replaceChildren: () => {}, focus: () => {},
  }]));
  for (const id of ['itemModal', 'itemDescPreview', 'descriptionToolbar', 'descriptionWrite',
    'descriptionPreview', 'descriptionViews', 'itemDescHint', 'itemProtected']) {
    elements[id] ||= {
      value: '', checked: false, hidden: true, style: {}, dir: '',
      classList: { contains: () => true, add: () => {}, toggle: () => {} },
      setAttribute: () => {}, replaceChildren: () => {},
    };
  }
  elements.itemDesc.classList.toggle = () => {};
  const context = vm.createContext({
    document: { getElementById: id => elements[id] },
    localStorage: { getItem: () => null, setItem: () => {} },
    db: {
      exec: sql => [{ values: [[sql.includes('SELECT type') ? 'reference' : 10]] }],
      run: (sql, params) => {
        assert.equal((sql.match(/\?/g) || []).length, params.length, 'SQL placeholders match bound values');
        calls.push({ sql, params: [...params] });
      },
    },
    sketchActive: false, sketchCtx: null,
    itemSaveInProgress: false, descriptionImagePastePending: false, itemEditorChangeRevision: 0, itemEditorChanged: false,
    itemNoteEditor: null, getItemContent: () => ({ notes }),
    resolveItemProtection: async () => ({ isProtected: encrypted ? 1 : 0,
      passwordHash: null, passwordSalt: null, passwordIterations: null }),
    resolveItemEncryption: async (_, payload) => {
      calls.push({ payload });
      return { isEncrypted: encrypted ? 1 : 0,
        encryptedData: encrypted ? 'ciphertext' : null,
        encryptionIv: encrypted ? 'iv' : null, encryptionVersion: encrypted ? 1 : null };
    },
    decryptedProtectedItems: new Map(), unlockedProtectedItems: new Set(),
    persist: async () => calls.push('persist'),
    closeItemModal: saved => calls.push({ saved }),
    renderSidebar: () => {}, renderMain: () => {}, checkDueDateNotifications: () => {},
    createBackup: async () => {},
    requestChangeBackup: reason => calls.push({ backup: reason }),
    toast: message => calls.push({ toast: message }),
    descriptionEditorSession: 0,
    renderDescriptionContent: (...args) => { calls.push({ render: args }); return 'preview'; },
  });
  vm.runInContext(markdown, context);
  context.renderDescriptionContent = (...args) => { calls.push({ render: args }); return 'preview'; };
  vm.runInContext(app.slice(app.indexOf('function setDescriptionEditorMode('),
    app.indexOf('function openItemModal(')), context);
  vm.runInContext(app.slice(app.indexOf('function onDescriptionFormatChange('),
    app.indexOf('function onDescriptionPaste(')), context);
  vm.runInContext(app.slice(app.indexOf('async function saveItemOnce('),
    app.indexOf('async function deleteItem(')), context);
  vm.runInContext(app.slice(app.indexOf('async function silentSaveItem('),
    app.indexOf('function scheduleAutoSave(')), context);
  return { context, calls, elements };
}

for (const direction of ['auto', 'ltr', 'rtl']) {
  test('changing direction to ' + direction + ' updates editor and preview but never the source', () => {
    const { context, calls, elements } = setup({ direction });
    elements.itemDescPreview.hidden = false;
    context.onDescriptionDirectionChange();
    assert.equal(elements.itemDesc.dir, direction);
    assert.equal(elements.itemDescPreview.dir, direction);
    assert.equal(elements.itemDesc.value, original);
    assert.deepEqual(calls[0].render, [original, 'markdown', direction]);
  });
}

test('toolbar is only available in Markdown Write mode; view changes do not modify the source', () => {
  const { context, elements } = setup();
  context.setDescriptionEditorMode('write');
  assert.equal(elements.descriptionToolbar.hidden, false);
  context.setDescriptionEditorMode('preview');
  assert.equal(elements.descriptionToolbar.hidden, true);
  assert.equal(elements.itemDesc.hidden, true);
  elements.itemDescFormat.value = 'plain';
  context.setDescriptionEditorMode('write');
  assert.equal(elements.descriptionToolbar.hidden, true);
  assert.equal(elements.itemDesc.hidden, false);
  assert.equal(elements.itemDesc.value, original);
});

test('reading descriptions preserves Markdown exactly and retains existing plain-text trimming', () => {
  const markdownSetup = setup();
  assert.equal(markdownSetup.context.readItemDescription().source, original);
  const plainSetup = setup({ format: 'plain' });
  assert.equal(plainSetup.context.readItemDescription().source, original.trim());
});

test('invalid editor direction is notified and cannot be saved', () => {
  const { context, calls } = setup({ direction: 'sideways' });
  assert.equal(context.readItemDescription(), null);
  assert.equal(calls[0].toast, 'Choose a valid writing direction');
});

for (const edit of [true, false]) {
  for (const direction of ['auto', 'ltr', 'rtl']) {
    test('manual save preserves Markdown and direction: edit=' + edit + ', direction=' + direction, async () => {
      const { context, calls } = setup({ edit, direction });
      await context.saveItemOnce();
      const statement = calls.find(call => call.sql);
      assert.match(statement.sql, /description_format = \?, description_direction = \?|description_format, description_direction/);
      const offset = edit ? 0 : 1;
      assert.equal(statement.params[offset + 1], original);
      assert.equal(statement.params[offset + 2], 'markdown');
      assert.equal(statement.params[offset + 3], direction);
      assert.ok(calls.includes('persist'));
      assert.ok(calls.some(call => call.saved === true));
    });

    test('auto-save preserves Markdown and direction: edit=' + edit + ', direction=' + direction, async () => {
      const { context, calls } = setup({ edit, direction });
      assert.equal(await context.silentSaveItem(), true);
      const statement = calls.find(call => call.sql);
      const offset = edit ? 0 : 1;
      assert.equal(statement.params[offset + 1], original);
      assert.equal(statement.params[offset + 2], 'markdown');
      assert.equal(statement.params[offset + 3], direction);
      assert.ok(calls.includes('persist'));
      assert.ok(calls.some(call => call.backup === (edit ? 'item-updated' : 'new-item')));
    });
  }
}

test('encrypted saves keep formatted content inside encryption and persist direction as metadata', async () => {
  const { context, calls } = setup({ encrypted: true });
  await context.saveItemOnce();
  assert.equal(calls.find(call => call.payload).payload.description, original);
  const statement = calls.find(call => call.sql);
  assert.equal(statement.params[0], 'Encrypted item');
  assert.equal(statement.params[1], '');
  assert.equal(statement.params[2], 'markdown');
  assert.equal(statement.params[3], 'rtl');
  assert.ok(statement.params.includes('ciphertext'));
  assert.equal(statement.params.includes(original), false);
});

for (const encrypted of [false, true]) {
  test('editing the original description retains all independent notes: encrypted=' + encrypted, async () => {
    const notes = [{ title: 'Example', description: original, descriptionFormat: 'markdown', descriptionDirection: 'rtl' }];
    const { context, calls } = setup({ encrypted, notes });
    await context.saveItemOnce();
    assert.deepEqual(calls.find(call => call.payload).payload.notes, notes);
    assert.equal(calls.find(call => call.sql).params.at(-2), encrypted ? '[]' : JSON.stringify(notes));
  });
}

test('task, reference, and shared/full-screen readers forward direction to the common renderer', () => {
  const calls = [];
  const context = vm.createContext({
    db: { exec: () => [] }, isItemLocked: () => false,
    esc, escAttr: esc, RECURRENCE_LABELS: {},
    renderCollapsibleDescription: (source, format, direction) => { calls.push([source, format, direction]); return 'description'; },
    renderFollowups: () => '',
    renderItemNotes: () => '',
  });
  vm.runInContext(app.slice(app.indexOf('function renderRefItem('),
    app.indexOf('function renderFollowups(')), context);
  vm.runInContext(share.slice(share.indexOf('function renderSharedItemContent('),
    share.indexOf('async function openSharedItemFromUrl(')), context);
  context.renderItem(7, 'Title', original, '', 0, 0, 0, true, 1, null, 'markdown', 'rtl');
  context.renderRefItem(7, 'Title', original, '', true, 1, null, 0, 0, 'markdown', 'rtl');
  context.renderSharedItemContent({ boardType: 'reference', description: original,
    descriptionFormat: 'markdown', descriptionDirection: 'rtl', followups: [] });
  assert.deepEqual(calls, Array.from({ length: 3 }, () => [original, 'markdown', 'rtl']));
});

test('search results forward saved direction for both board types', () => {
  const calls = [];
  const elements = { mainBody: {}, mainHeader: {} };
  const context = vm.createContext({
    document: { getElementById: id => elements[id] },
    db: { exec: () => [{ values: ['task', 'reference'].map((type, index) =>
      [index + 1, 'Title', 'word', '', 0, 0, 1, 'Board', '#123456', 0, null, type, 0, 0, null, 'markdown', 'rtl']) }] },
    decryptedProtectedItems: new Map(), expandedItems: new Set(),
    isItemLocked: () => false, esc, escAttr: esc,
    searchAppointments: () => [], renderAppointmentSearchMatches: () => '',
    renderItem: (...args) => { calls.push(args); return 'task'; },
    renderRefItem: (...args) => { calls.push(args); return 'reference'; },
  });
  vm.runInContext(markdown, context);
  vm.runInContext(app.slice(app.indexOf('function renderSearchResults('),
    app.indexOf('function toggleComplete(')), context);
  context.renderSearchResults('word');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(args => args.at(-2) === 'rtl' && args.at(-3) === 'markdown'));
});
