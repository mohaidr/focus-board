const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const appointmentsSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'appointments.js'), 'utf8');
const markdownSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'markdown.js'), 'utf8');
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

function appointmentDataSetup({ accepted = true, failPersist = false } = {}) {
  const base = setup();
  const { context } = base;
  const tables = {
    sections: [{ id: 1, name: 'Meetings', color: '#123456', type: 'appointment' }],
    items: [], followups: [], app_settings: [],
    contacts: [{ id: 8, name: 'Sam', phone: '123', email: 'sam@example.test', notes: 'Contact notes',
      notes_format: 'plain', notes_direction: 'auto' }],
    appointments: [{ id: 3, section_id: 1, contact_id: 8, person_name: 'Sam', person_phone: '123',
      person_email: 'sam@example.test', person_notes: 'Contact notes', title: 'Planning',
      date: '2026-11-17', start_time: '09:00', end_time: '10:00', description: 'Exact\nappointment details', location: 'Office',
      description_format: 'plain', description_direction: 'auto', person_notes_format: 'plain', person_notes_direction: 'auto' }],
  };
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', classList: { add() {}, remove() {} } });
    return elements.get(id);
  };
  let persisted = false;
  context.confirm = () => accepted;
  context.boardSaveInProgress = false;
  context.activeSectionId = 1;
  context.selectedColor = '#654321';
  context.selectedBoardType = 'appointment';
  context.closeModal = () => {};
  context.forgetItemViews = () => {};
  context.unlockedProtectedItems = new Set();
  context.decryptedProtectedItems = new Map();
  context.expandedItems = new Set();
  context.validateDescriptionMetadata = () => {};
  context.document = { getElementById: element };
  context.db.exec = sql => {
    const table = sql.match(/FROM (sections|items|followups|appointments|contacts|app_settings)\b/)?.[1];
    if (!table) throw new Error('Unexpected query: ' + sql);
    const rows = tables[table];
    if (!rows.length) return [];
    const selected = sql.match(/^SELECT (.*?) FROM/)[1];
    const columns = selected === '*' ? Object.keys(rows[0]) : selected.split(', ');
    return [{ columns, values: rows.map(row => columns.map(column => row[column])) }];
  };
  context.db.run = (sql, params = []) => {
    if (['BEGIN TRANSACTION', 'COMMIT', 'ROLLBACK'].includes(sql)) return;
    const deleted = sql.match(/^DELETE FROM (\w+)/);
    if (deleted) { tables[deleted[1]] = []; return; }
    const inserted = sql.match(/^INSERT INTO (\w+) \(([^)]+)\)/);
    if (inserted) {
      tables[inserted[1]].push(Object.fromEntries(inserted[2].split(', ').map((column, index) => [column, params[index]])));
      return;
    }
    if (sql.startsWith('UPDATE sections SET name')) {
      Object.assign(tables.sections[0], { name: params[0], color: params[1], type: params[2] });
      return;
    }
    throw new Error('Unexpected mutation: ' + sql);
  };
  context.persist = async () => {
    if (failPersist) throw new Error('Browser storage is full');
    persisted = true;
  };
  const requestBackup = context.requestChangeBackup;
  context.requestChangeBackup = reason => {
    assert.equal(persisted, true, 'Back up only after local saving succeeds');
    return requestBackup(reason);
  };
  vm.runInContext(markdownSource, context);
  vm.runInContext(appointmentsSource, context);
  vm.runInContext(app.slice(app.indexOf('async function saveSection('), app.indexOf('function onItemProtectionChange(')), context);
  return { ...base, tables, element };
}

test('JSON export contains the same complete contacts and appointments as folder backups', async () => {
  const { context, records } = appointmentDataSetup();
  let blob;
  const downloads = [];
  context.Blob = Blob;
  context.URL = { createObjectURL(value) { blob = value; return 'blob:export'; }, revokeObjectURL() {} };
  context.document.createElement = () => ({ click() { downloads.push(this.download); } });
  vm.runInContext(app.slice(app.indexOf('function exportData('), app.indexOf('function importData(')), context);
  context.exportData();
  const exported = JSON.parse(await blob.text());
  await context.createBackup('manual', { createdAt: date, silent: true });
  assert.deepEqual(exported.contacts, records[0].snapshot.contacts);
  assert.deepEqual(exported.appointments, records[0].snapshot.appointments);
  assert.equal(exported.contacts[0].values[0][1], 'Sam');
  assert.equal(exported.appointments[0].values[0][11], 'Exact\nappointment details');
  assert.match(downloads[0], /\.json$/);
});

test('each contact/appointment change creates its own backup, including repeated edits on the same day', async () => {
  const { context, records, files, tables } = appointmentDataSetup();
  await context.persist();
  const reasons = ['contact-created', 'contact-updated', 'contact-updated', 'appointment-created',
    'appointment-updated', 'appointment-updated', 'appointment-deleted'];
  for (const [index, reason] of reasons.entries()) {
    tables.contacts[0].notes = 'Version ' + index;
    if (reason === 'appointment-deleted') tables.appointments = [];
    await context.requestChangeBackup(reason);
  }
  assert.deepEqual(records.map(record => record.reason), reasons);
  assert.deepEqual(records.map(record => record.snapshot.contacts[0].values[0][4]),
    reasons.map((_, index) => 'Version ' + index));
  assert.deepEqual(records.at(-1).snapshot.appointments, []);
  assert.equal(files.size, 3);
});

test('editing an appointment board backs up its new metadata and linked appointments', async () => {
  const { context, records, element } = appointmentDataSetup();
  element('sectionName').value = 'Renamed meetings';
  element('editSectionId').value = '1';
  await context.saveSection();
  assert.equal(records.length, 1);
  assert.equal(records[0].reason, 'board-updated');
  assert.equal(records[0].snapshot.sections[0].values[0][1], 'Renamed meetings');
  assert.equal(records[0].snapshot.appointments[0].values.length, 1);
  assert.equal(records[0].snapshot.contacts[0].values.length, 1);
});

test('deleting an appointment board backs up the deletion while preserving shared contacts', async () => {
  const { context, records, tables } = appointmentDataSetup();
  await context.deleteSection(1);
  assert.deepEqual(tables.sections, []);
  assert.deepEqual(tables.appointments, []);
  assert.equal(tables.contacts.length, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].reason, 'board-deleted');
  assert.deepEqual(records[0].snapshot.sections, []);
  assert.deepEqual(records[0].snapshot.appointments, []);
  assert.equal(records[0].snapshot.contacts[0].values.length, 1);
});

test('canceled and failed board deletions do not back up a deletion that never succeeded', async () => {
  for (const options of [{ accepted: false }, { failPersist: true }]) {
    const { context, records, tables, warnings } = appointmentDataSetup(options);
    const before = clone(tables);
    await context.deleteSection(1);
    assert.deepEqual(tables, before);
    assert.deepEqual(records, []);
    assert.equal(context.activeSectionId, 1);
    if (options.failPersist) assert.ok(warnings.some(message => message.includes('Browser storage is full')));
  }
});

test('failed board edits restore their metadata without creating a backup', async () => {
  const { context, records, tables, element, warnings } = appointmentDataSetup({ failPersist: true });
  const before = clone(tables);
  element('sectionName').value = 'Unsaved name';
  element('editSectionId').value = '1';
  await context.saveSection();
  assert.deepEqual(tables, before);
  assert.deepEqual(records, []);
  assert.ok(warnings.some(message => message.includes('Browser storage is full')));
});

test('restoring a backup creates a new backup of the restored contacts and appointments', async () => {
  const { context, tables, records } = appointmentDataSetup();
  const snapshot = clone(context.snapshotCurrentData());
  tables.contacts[0].name = 'Newer name';
  context.refreshBackupFiles = async () => [{ id: 'restore-me', snapshot }];
  vm.runInContext(app.slice(app.indexOf('function applySnapshot('), app.indexOf('function formatBackupDate(')), context);
  vm.runInContext(app.slice(app.indexOf('async function restoreBackup('), app.indexOf('async function deleteBackup(')), context);
  await context.restoreBackup('restore-me');
  assert.equal(records.length, 1);
  assert.equal(records[0].reason, 'backup-restored');
  assert.deepEqual(records[0].snapshot.contacts, snapshot.contacts);
  assert.deepEqual(records[0].snapshot.appointments, snapshot.appointments);
});

test('import creates both a recovery backup and a backup of the imported contacts and appointments', async () => {
  const { context, tables, records } = appointmentDataSetup();
  const imported = clone(context.snapshotCurrentData());
  imported.contacts[0].values[0][1] = 'Imported name';
  let pending;
  context.FileReader = class {
    readAsText() { pending = this.onload({ target: { result: JSON.stringify(imported) } }); }
  };
  vm.runInContext(app.slice(app.indexOf('function importData('), app.indexOf('function openSettingsModal(')), context);
  context.importData({ target: { files: [{}], value: 'test.json' } });
  await pending;
  assert.equal(tables.contacts[0].name, 'Imported name');
  assert.deepEqual(records.map(record => record.reason), ['pre-import', 'data-imported']);
  assert.equal(records[0].snapshot.contacts[0].values[0][1], 'Sam');
  assert.deepEqual(records[1].snapshot.contacts, imported.contacts);
  assert.deepEqual(records[1].snapshot.appointments, imported.appointments);
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
