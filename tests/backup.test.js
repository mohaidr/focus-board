const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const date = '2026-11-08T12:00:00.000Z';

function setup() {
  const files = new Map();
  const records = [];
  const warnings = [];
  const timers = [];
  const errors = [];
  let version = 1;
  let denied = false;
  let failWrite = false;
  let blocked = null;
  let activeWrites = 0;
  let maximumWrites = 0;
  let aborted = 0;
  const folder = {
    queryPermission: async () => denied ? 'denied' : 'granted',
    requestPermission: async () => denied ? 'denied' : 'granted',
    async *entries() { for (const entry of files) yield entry; },
    removeEntry: async name => files.delete(name),
    getFileHandle: async (name, options) => {
      if (files.has(name)) throw new Error('A new backup must never overwrite an old file');
      assert.equal(options.create, true);
      const handle = {
        kind: 'file', name, content: '',
        getFile: async () => ({ text: async () => handle.content }),
        createWritable: async () => {
          activeWrites++;
          maximumWrites = Math.max(maximumWrites, activeWrites);
          return {
            write: async text => {
              if (failWrite) { failWrite = false; throw new Error('Test disk failure'); }
              if (blocked) await blocked;
              handle.content = text;
            },
            close: async () => { records.push(JSON.parse(handle.content)); activeWrites--; },
            abort: async () => { aborted++; activeWrites--; },
          };
        },
      };
      files.set(name, handle);
      return handle;
    },
  };
  const context = vm.createContext({
    crypto: webcrypto, Date, Promise,
    BACKUP_FILE_PREFIX: 'dashora-backup-', BACKUP_RETENTION: 3,
    backupWriteQueue: Promise.resolve(), pendingBackupWrites: 0,
    backupFolderHandle: folder, backupFilesCache: [], activeView: 'board',
    db: { exec: sql => sql.includes('FROM items') ? [{
      columns: ['id', 'title', 'notes', 'encrypted_data'], values: [[1, 'Version ' + version,
        JSON.stringify([{ title: 'Note ' + version, description: '## Note\n', descriptionFormat: 'markdown', descriptionDirection: 'rtl' }]), null]],
    }] : [] },
    console: { error: (...args) => errors.push(args) },
    toast: message => warnings.push(message),
    setTimeout: callback => timers.push(callback),
    isFileSystemBackupSupported: () => true,
    renderSidebar: () => {}, renderMain: () => {},
  });
  vm.runInContext(app.slice(app.indexOf('async function ensureBackupFolderPermission('), app.indexOf('async function initBackupSystem(')), context);
  vm.runInContext(app.slice(app.indexOf('function snapshotCurrentData('), app.indexOf('async function ensureDailyBackup(')), context);
  return { context, files, folder, records, errors, warnings, timers,
    version: value => { version = value; }, deny: value => { denied = value; },
    fail: () => { failWrite = true; }, block: value => { blocked = value; },
    maximumWrites: () => maximumWrites, aborted: () => aborted };
}

test('each successful content-change reason creates a new backup even when a backup exists today', async () => {
  const { context, records, files } = setup();
  await context.createBackup('daily', { createdAt: date, silent: true });
  for (const reason of ['new-item', 'item-updated', 'item-deleted', 'note-added', 'note-updated', 'note-deleted', 'notes-reordered']) {
    assert.equal(await context.requestChangeBackup(reason), true);
  }
  assert.deepEqual(records.map(record => record.reason), [
    'daily', 'new-item', 'item-updated', 'item-deleted', 'note-added', 'note-updated', 'note-deleted', 'notes-reordered',
  ]);
  assert.equal(files.size, 3);
});

test('queued backups retain their own snapshots rather than later edits', async () => {
  const { context, records, version, maximumWrites, block } = setup();
  let release;
  block(new Promise(resolve => { release = resolve; }));
  const first = context.createBackup('item-updated', { createdAt: date, silent: true });
  version(2);
  const second = context.createBackup('item-updated', { createdAt: date, silent: true });
  version(3);
  release();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(records.map(record => record.snapshot.items[0].values[0][1]), ['Version 1', 'Version 2']);
  assert.equal(maximumWrites(), 1);
  assert.equal(context.pendingBackupWrites, 0);
});

test('identical timestamps and reasons cannot overwrite earlier backup files', async () => {
  const { context, files } = setup();
  await Promise.all([
    context.createBackup('note-updated', { createdAt: date, silent: true }),
    context.createBackup('note-updated', { createdAt: date, silent: true }),
  ]);
  assert.equal(files.size, 2);
  assert.ok([...files.keys()].every(name => name.includes('note-updated-') && name.endsWith('.json')));
  assert.match(context.buildBackupFileName('manual', date, true), /-protected\.json$/);
});

test('daily duplicate checks remain unchanged while manual backups still create new files', async () => {
  const { context, records } = setup();
  assert.equal(await context.createBackup('daily', { createdAt: date, silent: true }), true);
  assert.equal(await context.createBackup('daily', { createdAt: date, silent: true }), false);
  assert.equal(await context.createBackup('manual', { createdAt: date, silent: true }), true);
  assert.equal(records.length, 2);
});

test('retention keeps three regular backups without deleting protected backups', async () => {
  const { context, files } = setup();
  await context.createBackup('manual', { createdAt: date, silent: true });
  const protectedFile = files.values().next().value;
  const data = JSON.parse(protectedFile.content);
  data.protected = true;
  protectedFile.content = JSON.stringify(data);
  for (let index = 1; index <= 4; index++) {
    await context.createBackup('item-updated', { silent: true, createdAt: `2026-11-08T12:00:0${index}.000Z` });
  }
  const backups = await context.refreshBackupFiles();
  assert.equal(backups.filter(backup => !backup.protected).length, 3);
  assert.ok(files.has(protectedFile.name));
  assert.equal(files.size, 4);
});

test('failed backup writes are logged, cleaned up, notified and do not poison the queue', async () => {
  const { context, fail, files, errors, timers, warnings, aborted } = setup();
  fail();
  assert.equal(await context.requestChangeBackup('note-updated'), false);
  assert.equal(files.size, 0);
  assert.equal(aborted(), 1);
  assert.ok(errors.length >= 1);
  timers.forEach(callback => callback());
  assert.ok(warnings.some(message => message.includes('Saved locally, but automatic backup failed')));
  assert.equal(await context.requestChangeBackup('notes-reordered'), true);
  assert.equal(files.size, 1);
});

test('denied folder permissions notify without falsely creating a backup', async () => {
  const { context, deny, files, errors, timers, warnings } = setup();
  deny(true);
  assert.equal(await context.requestChangeBackup('note-added'), false);
  timers.forEach(callback => callback());
  assert.equal(files.size, 0);
  assert.ok(errors.length >= 1);
  assert.ok(warnings.some(message => message.includes('automatic backup failed')));
});

test('browser-only mode skips folder backups without warning on every edit', async () => {
  const { context, files, warnings, errors } = setup();
  context.backupFolderHandle = null;
  assert.equal(await context.requestChangeBackup('item-updated'), false);
  assert.equal(files.size, 0);
  assert.deepEqual(warnings, []);
  assert.deepEqual(errors, []);
});

test('changing folders before a queued backup runs does not write into the wrong folder', async () => {
  const { context, files, errors } = setup();
  const pending = context.requestChangeBackup('note-deleted');
  context.backupFolderHandle = null;
  assert.equal(await pending, false);
  assert.equal(files.size, 0);
  assert.ok(errors.length >= 1);
});

test('note order, exact Markdown and encrypted rows are retained by snapshotting raw database values', async () => {
  const { context, records } = setup();
  const notes = [
    { title: 'Second', description: '## Second\n\n**Keep** spaces  \nnext\n', descriptionFormat: 'markdown', descriptionDirection: 'rtl' },
    { title: 'First', description: 'Literal **text**', descriptionFormat: 'plain', descriptionDirection: 'auto' },
  ];
  context.db.exec = sql => sql.includes('FROM items') ? [{
    columns: ['id', 'notes', 'encrypted_data'], values: [[1, JSON.stringify(notes), null], [2, '[]', 'opaque-ciphertext']],
  }] : [];
  await context.requestChangeBackup('notes-reordered');
  const values = records[0].snapshot.items[0].values;
  assert.deepEqual(JSON.parse(values[0][1]), notes);
  assert.deepEqual(values[1], [2, '[]', 'opaque-ciphertext']);
});

test('new backup reasons have accurate labels in the backup UI', () => {
  const { context } = setup();
  for (const [reason, label] of [['item-updated', 'Item updated'], ['item-deleted', 'Item deleted'], ['note-added', 'Note added'],
    ['note-updated', 'Note updated'], ['note-deleted', 'Note deleted'], ['notes-reordered', 'Notes reordered']]) {
    assert.equal(context.getBackupReasonLabel(reason), label);
  }
});

test('pending backups warn on page exit, without starting a second save', () => {
  let handler;
  let prevented = false;
  const context = vm.createContext({
    pendingBackupWrites: 1, itemSaveInProgress: false, itemNoteEditor: null,
    document: {}, window: { addEventListener: (_, callback) => { handler = callback; } },
    silentSaveItem: () => { throw new Error('Must not start another save'); },
  });
  vm.runInContext(app.slice(app.indexOf("window.addEventListener('beforeunload'"), app.indexOf('// Attach auto-save listeners')), context);
  const event = { preventDefault: () => { prevented = true; } };
  handler(event);
  assert.equal(prevented, true);
  assert.equal(event.returnValue, '');
});

function deletionSetup({ accepted = true, failPersist = false, missing = false } = {}) {
  const { context, records, files, errors, warnings } = setup();
  const item = { columns: ['id', 'title', 'notes', 'encrypted_data'],
    values: [[7, 'Encrypted item', '[]', 'encrypted-description-and-notes']] };
  const followup = { columns: ['id', 'item_id', 'text', 'completed'], values: [[4, 7, 'Follow-up', 0]] };
  let items = missing ? [] : clone(item.values);
  let followups = clone(followup.values);
  let persisted = false;
  const forgotten = [];
  context.confirm = () => accepted;
  context.itemSaveInProgress = false;
  context.unlockedProtectedItems = new Set([7]);
  context.decryptedProtectedItems = new Map([[7, { description: 'Visible only while unlocked' }]]);
  context.forgetItemViews = ids => forgotten.push(...ids);
  context.db.exec = sql => {
    const table = sql.includes('FROM followups') ? followup : sql.includes('FROM items') ? item : null;
    if (!table) return [];
    const values = table === item ? items : followups;
    return values.length ? [{ columns: table.columns, values: clone(values) }] : [];
  };
  context.db.run = (sql, params) => {
    assert.equal((sql.match(/\?/g) || []).length, params.length);
    if (sql.startsWith('DELETE FROM items')) items = [];
    else if (sql.startsWith('DELETE FROM followups')) followups = [];
    else if (sql.startsWith('INSERT INTO items')) items.push([...params]);
    else if (sql.startsWith('INSERT INTO followups')) followups.push([...params]);
    else throw new Error('Unexpected SQL: ' + sql);
  };
  context.persist = async () => {
    if (failPersist) throw new Error('Browser storage is full');
    persisted = true;
  };
  const requestBackup = context.requestChangeBackup;
  context.requestChangeBackup = reason => {
    assert.equal(persisted, true, 'Back up only after the deletion has been persisted');
    return requestBackup(reason);
  };
  vm.runInContext(app.slice(app.indexOf('async function deleteItem('), app.indexOf('function copyItem(')), context);
  return { context, records, files, errors, warnings, forgotten, item, followup,
    rows: () => ({ items, followups }) };
}

test('confirmed item deletion creates an actual queued backup of the post-deletion state', async () => {
  const { context, records, files, rows, forgotten } = deletionSetup();
  await context.deleteItem(7);
  await context.backupWriteQueue;
  assert.deepEqual(rows(), { items: [], followups: [] });
  assert.equal(records.length, 1);
  assert.equal(records[0].reason, 'item-deleted');
  assert.deepEqual(records[0].snapshot.items, []);
  assert.deepEqual(records[0].snapshot.followups, []);
  assert.equal(files.size, 1);
  assert.deepEqual(forgotten, [7]);
  assert.equal(context.decryptedProtectedItems.has(7), false);
  assert.equal(context.itemSaveInProgress, false);
});

test('canceling item deletion never changes content or requests a backup', async () => {
  const { context, records, rows, item, followup, forgotten } = deletionSetup({ accepted: false });
  await context.deleteItem(7);
  assert.deepEqual(rows(), { items: item.values, followups: followup.values });
  assert.equal(records.length, 0);
  assert.deepEqual(forgotten, []);
});

test('failed deletion persistence restores the exact item and follow-ups without creating a backup', async () => {
  const { context, records, rows, item, followup, forgotten, errors, warnings } = deletionSetup({ failPersist: true });
  await context.deleteItem(7);
  assert.deepEqual(rows(), { items: item.values, followups: followup.values });
  assert.equal(records.length, 0);
  assert.deepEqual(forgotten, []);
  assert.equal(context.unlockedProtectedItems.has(7), true);
  assert.equal(context.decryptedProtectedItems.has(7), true);
  assert.equal(context.itemSaveInProgress, false);
  assert.equal(errors.length, 1);
  assert.ok(warnings.includes('Could not delete item: Browser storage is full'));
  assert.ok(!warnings.includes('Item deleted'));
});

test('missing items and in-flight saves cannot create deletion backups', async () => {
  const missing = deletionSetup({ missing: true });
  await missing.context.deleteItem(7);
  assert.equal(missing.records.length, 0);
  assert.ok(missing.warnings.includes('Could not delete item: Item not found'));
  const busy = deletionSetup();
  busy.context.itemSaveInProgress = true;
  await busy.context.deleteItem(7);
  assert.equal(busy.records.length, 0);
  assert.deepEqual(busy.rows().items, busy.item.values);
});
