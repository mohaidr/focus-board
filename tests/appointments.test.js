const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'appointments.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const markdown = fs.readFileSync(path.join(__dirname, '..', 'js', 'markdown.js'), 'utf8');
const paging = fs.readFileSync(path.join(__dirname, '..', 'js', 'paging.js'), 'utf8');
const recurrence = fs.readFileSync(path.join(__dirname, '..', 'js', 'appointment-recurrence.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const contact = { id: 8, name: 'Sam', phone: '123', email: 'sam@example.test', notes: 'Contact notes' };
const appointment = { id: 3, section_id: 1, contact_id: 8, person_name: 'Sam',
  person_phone: '123', person_email: 'sam@example.test', person_notes: 'Contact notes',
  title: 'Planning', date: '2026-11-17', start_time: '09:00', end_time: '10:00',
  description: 'Discuss next steps\nKeep this line', location: 'Office' };
const result = rows => rows.length ? [{ columns: Object.keys(rows[0]), values: rows.map(Object.values) }] : [];

function setup() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: id.endsWith('Format') ? 'plain' : id.endsWith('Direction') ? 'auto' : '',
      checked: false, disabled: false,
      innerHTML: '', hidden: false, textContent: '', scrollTop: 0, parentElement: { hidden: false },
      classList: { add() {}, remove() {}, toggle() {} }, focus() {}, reset() {}, reportValidity: () => true,
      setAttribute() {}, replaceChildren() {} });
    return elements.get(id);
  };
  const statements = [];
  const warnings = [];
  const backups = [];
  const contacts = [clone(contact)];
  const appointments = [clone(appointment)];
  let persisted = 0;
  let failPersist = false;
  const context = vm.createContext({
    Date, Set, Map, Number, Object,
    document: { getElementById: element, querySelector: () => element('focusTarget') },
    esc: value => String(value).replace(/[&<>"']/g, char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
    toast: message => warnings.push(message),
    console: { error() {} },
    confirm: () => true,
    renderMain() {}, renderSidebar() {}, closeSidebar() {}, closeModal() {}, checkDueDateNotifications() {},
    dayKey: () => '2026-11-17',
    activeSectionId: 1,
    unlockedProtectedItems: new Set(), decryptedProtectedItems: new Map(),
    persist: async () => { persisted++; if (failPersist) throw new Error('Storage full'); },
    requestChangeBackup: async reason => { backups.push(reason); return true; },
    db: {
      create_function() {},
      exec(sql, params = []) {
        if (sql === 'SELECT total_changes()') return [{ values: [[0]] }];
        if (sql.includes('last_insert_rowid')) return [{ columns: ['id'], values: [[77]] }];
        if (sql.startsWith('SELECT id FROM sections')) return [{ columns: ['id'], values: [[1]] }];
        if (sql.startsWith('SELECT * FROM contacts WHERE id')) return result(contacts.filter(row => row.id === params[0]));
        if (sql.startsWith('SELECT id, name, phone, email FROM contacts')) {
          return result(contacts.filter(row => [row.name, row.phone, row.email]
            .some(value => value.toLowerCase().includes(params[0].toLowerCase())))
            .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
            .slice(params.at(-1), params.at(-1) + params.at(-2)));
        }
        if (sql.startsWith('SELECT * FROM contacts')) return result(contacts);
        if (sql.startsWith('SELECT * FROM appointments')) return result(appointments);
        throw new Error('Unexpected query: ' + sql);
      },
      run: (sql, params = []) => statements.push({ sql, params: clone(params) }),
    },
  });
  context.escAttr = context.esc;
  vm.runInContext(markdown, context);
  vm.runInContext(paging, context);
  vm.runInContext(recurrence, context);
  vm.runInContext(source, context);
  context.getAppointments = () => [];
  context.getAppointment = id => appointments.find(row => row.id === id);
  const defaults = { appointmentId: '', appointmentSection: '1', appointmentTitle: 'Planning',
    appointmentDate: '2026-11-17', appointmentStart: '09:00', appointmentEnd: '10:00',
    appointmentContact: '', appointmentPersonName: 'New person', appointmentPersonPhone: '555',
    appointmentPersonEmail: 'new@example.test', appointmentPersonNotes: 'Details',
    appointmentDescription: 'Discuss next steps', appointmentLocation: 'Office',
    appointmentReminder: '15', appointmentRepeat: '', appointmentEditScope: 'occurrence' };
  for (const [id, value] of Object.entries(defaults)) element(id).value = value;
  element('appointmentSaveContact').checked = true;
  return { context, element, statements, warnings, backups, contacts, appointments,
    persisted: () => persisted, fail: () => { failPersist = true; } };
}

test('new appointment defaults to saving its person; editing a one-off preserves the opt-out', () => {
  const { context, element, appointments } = setup();
  context.openAppointmentModal(null, '14:00');
  assert.equal(element('appointmentSaveContact').checked, true);
  assert.equal(element('appointmentStart').value, '14:00');
  assert.equal(element('appointmentEnd').value, '15:00');
  appointments[0].contact_id = null;
  context.openAppointmentModal(3);
  assert.equal(element('appointmentSaveContact').checked, false);
  assert.equal(element('appointmentPersonName').value, 'Sam');
});

for (const saveContact of [true, false]) {
  test('appointment stores person details with contact checkbox ' + saveContact, async () => {
    const { context, element, statements, backups, persisted } = setup();
    element('appointmentSaveContact').checked = saveContact;
    await context.saveAppointment({ preventDefault() {} });
    assert.equal(statements.filter(row => row.sql.startsWith('INSERT INTO contacts')).length, saveContact ? 1 : 0);
    const saved = statements.find(row => row.sql.startsWith('INSERT INTO appointments'));
    assert.deepEqual(saved.params, [1, saveContact ? 77 : null, 'New person', '555',
      'new@example.test', 'Details', 'Planning', '2026-11-17', '09:00', '10:00', 'Discuss next steps', 'Office',
      'plain', 'auto', 'plain', 'auto']);
    assert.equal(persisted(), 1);
    assert.deepEqual(backups, ['appointment-created']);
  });
}

test('choosing a saved contact links it without creating a duplicate and rescheduling updates the appointment', async () => {
  const { context, element, statements, backups } = setup();
  element('appointmentId').value = '3';
  element('appointmentContact').value = '8';
  element('appointmentDate').value = '2026-11-18';
  element('appointmentStart').value = '13:15';
  element('appointmentEnd').value = '14:45';
  await context.saveAppointment({ preventDefault() {} });
  assert.equal(statements.some(row => row.sql.startsWith('INSERT INTO contacts')), false);
  const saved = statements.find(row => row.sql.startsWith('UPDATE appointments'));
  assert.equal(saved.params[1], 8);
  assert.deepEqual(saved.params.slice(2, 6), ['Sam', '123', 'sam@example.test', 'Contact notes']);
  assert.deepEqual(saved.params.slice(7, 10), ['2026-11-18', '13:15', '14:45']);
  assert.equal(saved.params.at(-1), 3);
  assert.deepEqual(backups, ['appointment-updated']);
});

test('contact picker loads bounded summaries and preserves an existing selection outside the first page', () => {
  const { context, element, contacts } = setup();
  for (let id = 100; id < 135; id++) {
    contacts.push({ ...contact, id, name: 'Contact ' + id });
  }
  const queries = [];
  const exec = context.db.exec;
  context.db.exec = (sql, params) => { queries.push({ sql, params }); return exec(sql, params); };
  context.getContacts = () => { throw new Error('Must not load all contacts for the picker'); };
  element('appointmentContactSearch').value = 'old search';
  context.openAppointmentModal(3);
  assert.equal(element('appointmentContactSearch').value, '');
  assert.equal((element('appointmentContact').innerHTML.match(/<option /g) || []).length, 22);
  assert.equal(element('appointmentContact').value, '8');
  assert.equal(element('appointmentNewPerson').disabled, true);
  assert.match(element('appointmentContactHint').textContent, /first 20 matches/);
  const query = queries.find(query => query.sql.startsWith('SELECT id, name, phone, email'));
  assert.match(query.sql, /LIMIT \? OFFSET \?$/);
  assert.deepEqual(clone(query.params.slice(-2)), [21, 0]);
  assert.equal(queries.some(query => query.sql === 'SELECT * FROM contacts ORDER BY name COLLATE NOCASE, id'), false);

  element('appointmentContactSearch').value = 'no match';
  context.fillAppointmentContactOptions('8');
  assert.equal((element('appointmentContact').innerHTML.match(/<option /g) || []).length, 2);
  assert.equal(element('appointmentContact').value, '8');
  assert.match(element('appointmentExistingContact').textContent, /Sam/);
  assert.match(element('appointmentContactHint').textContent, /No saved contacts match/);
  element('appointmentContact').value = '';
  context.onAppointmentContactChange();
  assert.equal(element('appointmentNewPerson').disabled, false);
  assert.equal(element('appointmentPersonName').value, 'Sam');
});

test('contact picker searches name, phone and email and escapes matching contact labels', () => {
  const { context, element, contacts } = setup();
  contacts.push({ ...contact, id: 9, name: '<Different> 100%_', phone: '789', email: 'other@example.test' });
  for (const term of [' sAM ', '123', 'SAM@EXAMPLE.TEST']) {
    element('appointmentContactSearch').value = term;
    context.fillAppointmentContactOptions();
    assert.match(element('appointmentContact').innerHTML, /value="8"/);
    assert.doesNotMatch(element('appointmentContact').innerHTML, /value="9"/);
  }
  element('appointmentContactSearch').value = '%_';
  context.fillAppointmentContactOptions();
  assert.match(element('appointmentContact').innerHTML, /&lt;Different&gt; 100%_/);
  assert.doesNotMatch(element('appointmentContact').innerHTML, /value="8"/);
  element('appointmentContactSearch').value = 'missing';
  context.fillAppointmentContactOptions();
  assert.equal((element('appointmentContact').innerHTML.match(/<option /g) || []).length, 1);
  assert.match(element('appointmentContactHint').textContent, /No saved contacts match/);
});

test('saving a removed selected contact reports an error instead of silently abandoning the save', async () => {
  const { context, element, contacts, statements, warnings, persisted } = setup();
  contacts.length = 0;
  element('appointmentContact').value = '8';
  await context.saveAppointment({ preventDefault() {} });
  assert.match(warnings[0], /Contact no longer exists/);
  assert.equal(statements.length, 0);
  assert.equal(persisted(), 0);
});

test('standalone contact creation persists without creating an appointment', async () => {
  const { context, element, statements, backups } = setup();
  element('contactPersonName').value = 'Independent contact';
  element('contactPersonPhone').value = '456';
  await context.saveContact({ preventDefault() {} });
  assert.deepEqual(statements.find(row => row.sql.startsWith('INSERT INTO contacts')).params,
    ['Independent contact', '456', '', '', 'plain', 'auto']);
  assert.equal(statements.some(row => row.sql.includes('INSERT INTO appointments')), false);
  assert.deepEqual(backups, ['contact-created']);
});

test('editing a shared contact requests a backup after persistence', async () => {
  const { context, element, statements, backups, persisted } = setup();
  element('contactId').value = '8';
  element('contactPersonName').value = 'Updated Sam';
  await context.saveContact({ preventDefault() {} });
  assert.equal(persisted(), 1);
  assert.ok(statements.some(row => row.sql.startsWith('UPDATE contacts')));
  assert.deepEqual(backups, ['contact-updated']);
});

test('appointment deletion requests a backup and does not delete the shared contact', async () => {
  const { context, statements, backups, persisted } = setup();
  await context.deleteAppointment(3);
  assert.equal(persisted(), 1);
  assert.ok(statements.some(row => row.sql === 'DELETE FROM appointments WHERE id = ?'));
  assert.equal(statements.some(row => row.sql.startsWith('DELETE FROM contacts')), false);
  assert.deepEqual(backups, ['appointment-deleted']);
});

test('overlaps include other boards, exclude the edited appointment, and permit adjacent times', () => {
  const { context } = setup();
  const others = [
    { ...appointment, id: 1, section_id: 2 },
    { ...appointment, id: 2, start_time: '10:00', end_time: '11:00' },
    { ...appointment, id: 3, start_time: '08:00', end_time: '09:00' },
    { ...appointment, id: 4, date: '2026-11-18' },
  ];
  assert.deepEqual(clone(context.findAppointmentConflicts(others, { ...appointment, id: 99 })).map(row => row.id), [1]);
  assert.equal(context.findAppointmentConflicts(others, { ...appointment, id: 1 }).length, 0);
});

for (const confirm of [true, false]) {
  test('overlap warning can be ' + (confirm ? 'accepted' : 'canceled'), async () => {
    const { context, statements, warnings } = setup();
    context.getAppointments = () => [{ ...appointment, section_id: 2, board_name: 'Other board' }];
    context.confirm = message => { warnings.push(message); return confirm; };
    await context.saveAppointment({ preventDefault() {} });
    assert.ok(warnings.some(message => message.includes('Other board')));
    assert.equal(statements.some(row => row.sql.startsWith('INSERT INTO appointments')), confirm);
  });
}

test('invalid dates, invalid times, reversed times and blank names cannot write data', async () => {
  for (const [field, value] of [['appointmentDate', '2026-02-30'], ['appointmentStart', '25:00'],
    ['appointmentEnd', '08:00'], ['appointmentEnd', '09:00'], ['appointmentPersonName', '   ']]) {
    const { context, element, statements, warnings } = setup();
    element(field).value = value;
    await context.saveAppointment({ preventDefault() {} });
    assert.equal(statements.length, 0);
    assert.equal(warnings.length, 1);
  }
});

test('storage failure restores both tables, keeps the draft, and creates no change backup', async () => {
  const { context, element, statements, warnings, backups, fail } = setup();
  fail();
  await context.saveAppointment({ preventDefault() {} });
  assert.ok(statements.some(row => row.sql === 'DELETE FROM appointments'));
  const restored = statements.filter(row => row.sql.startsWith('INSERT INTO appointments'));
  assert.deepEqual(restored.at(-1).params, [...Object.values(appointment), 'plain', 'auto', 'plain', 'auto', '', null, '', 0, 15]);
  assert.equal(element('appointmentId').value, '');
  assert.equal(element('appointmentPersonName').value, 'New person');
  assert.equal(element('appointmentSaveButton').disabled, false);
  assert.deepEqual(backups, []);
  assert.ok(warnings.some(message => message.includes('Storage full')));
});

test('timeline assigns readable lanes for overlaps and close short appointments', () => {
  const { context } = setup();
  const layout = clone(context.layoutAppointments([
    { ...appointment, id: 1, start_time: '09:00', end_time: '09:05' },
    { ...appointment, id: 2, start_time: '09:10', end_time: '09:15' },
    { ...appointment, id: 3, start_time: '11:00', end_time: '12:00' },
  ]));
  assert.equal(layout[0].lanes, 2);
  assert.notEqual(layout[0].lane, layout[1].lane);
  assert.equal(layout[2].lanes, 1);
  assert.equal(layout[2].lane, 0);
});

test('contact updates hydrate linked appointment details without changing one-off people', () => {
  const { context } = setup();
  const updated = context.hydrateAppointmentContact({ ...appointment, contact_name: 'Updated Sam',
    contact_phone: '999', contact_email: 'updated@example.test', contact_notes: 'Updated notes' });
  assert.equal(updated.person_name, 'Updated Sam');
  assert.equal(updated.person_phone, '999');
  assert.equal(context.hydrateAppointmentContact({ ...appointment, contact_id: null, contact_name: null }).person_name, 'Sam');
});

test('snapshots restore contacts before appointments and accept older backups', () => {
  const { context, statements } = setup();
  const snapshot = { sections: [{ columns: ['id', 'type'], values: [[1, 'appointment']] }],
    contacts: result([contact]), appointments: result([appointment]) };
  context.validateAppointmentSnapshot(snapshot);
  context.restoreAppointmentSnapshot(snapshot);
  assert.match(statements[0].sql, /^INSERT INTO contacts/);
  assert.match(statements[1].sql, /^INSERT INTO appointments/);
  assert.deepEqual(statements[1].params, [...Object.values(appointment), 'plain', 'auto', 'plain', 'auto', '', null, '', 0, 15]);
  assert.doesNotThrow(() => context.validateAppointmentSnapshot({ sections: [], items: [] }));
});

test('invalid appointment imports reject before deleting existing data', () => {
  const { context, statements } = setup();
  context.validateDescriptionMetadata = () => {};
  vm.runInContext(app.slice(app.indexOf('function applySnapshot('), app.indexOf('function formatBackupDate(')), context);
  for (const patch of [{ date: '2026-02-30' }, { contact_id: 99 }, { section_id: 99 },
    { end_time: '08:00' }, { person_name: '' }]) {
    const snapshot = { sections: [{ columns: ['id', 'type'], values: [[1, 'appointment']] }],
      items: [], contacts: result([contact]), appointments: result([{ ...appointment, ...patch }]) };
    assert.throws(() => context.applySnapshot(snapshot), /Invalid appointment/);
    assert.equal(statements.length, 0);
  }
});

test('board navigation renders appointment boards and still works with no boards', () => {
  const { context, element } = setup();
  context.activeView = 'board';
  context.backupFilesCache = [];
  context.sidebarSearchTerm = '';
  context.db.exec = sql => sql.includes('COUNT(*) FROM sections') ? [{ values: [[1]] }] : [];
  context.readListPage = (key, sql, params) => ({ rows: params[0] === 'appointment'
    ? [[1, 'Meetings <work>', '#123456', 0, 0, 0, 0, 2]] : [], hasMore: false });
  vm.runInContext(app.slice(app.indexOf('function renderSidebar('), app.indexOf('function renderMain(')), context);
  context.renderSidebar();
  assert.match(element('sidebarNav').innerHTML, /Meetings &lt;work&gt;/);
  assert.match(element('sidebarNav').innerHTML, /class="search-box sidebar-board-search"[^>]*id="sidebarBoardSearch"/);
  context.db.exec = () => [{ values: [[0]] }];
  context.renderSidebar();
  assert.match(element('sidebarNav').innerHTML, /No boards yet/);
  assert.match(element('sidebarNav').innerHTML, /Contacts/);
});

test('global search finds appointment details and renders escaped, navigable results', () => {
  const { context, element } = setup();
  context.getAppointment = () => ({ ...appointment, title: '<script>Planning</script>', board_name: 'Work' });
  context.readListPage = (key, sql, params) => ({ rows: params[0] === 'not found' ? [] : [[3]], hasMore: false });
  const matches = context.searchAppointments('next steps');
  assert.equal(matches.length, 1);
  assert.equal(context.searchAppointments('sam@example.test').length, 1);
  assert.equal(context.searchAppointments('not found').length, 0);
  context.db.exec = () => [];
  context.globalSearchPage = () => ({ page: { rows: [[1, 3]], hasMore: false }, total: 1 });
  context.decryptedProtectedItems = new Map();
  context.expandedItems = new Set();
  vm.runInContext(app.slice(app.indexOf('function renderSearchResults('), app.indexOf('function toggleComplete(')), context);
  context.renderSearchResults('next steps');
  assert.match(element('mainHeader').innerHTML, /1 match/);
  assert.match(element('mainBody').innerHTML, /navigateToAppointment\(3\)/);
  assert.match(element('mainBody').innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(element('mainBody').innerHTML, /<script>/);
});

test('contact search uses the existing styled search wrapper', () => {
  const { context, element } = setup();
  context.renderContacts();
  assert.match(element('mainBody').innerHTML, /class="section-search-wrap">\s*<input class="section-search" id="contactSearch"/);
  context.filterContacts('sam');
  assert.match(element('mainBody').innerHTML, /Sam/);
  context.filterContacts('missing');
  assert.match(element('mainBody').innerHTML, /No contacts found/);
});

const appointmentFilters = patch => ({ person: '', title: '', from: '', to: '',
  scope: 'board', sort: 'date-asc', ...patch });

test('appointment filters bind combined criteria and support board/all-board scope and open date ranges', () => {
  const { context } = setup();
  const filters = appointmentFilters({ person: " Sam %_' ", title: ' Planning ',
    from: '2026-11-01', to: '2026-11-30' });
  const query = context.appointmentFilterQuery(7, filters);
  assert.deepEqual(clone(query.params), ["Sam %_'", 'Planning', 7, '2026-11-01', '2026-11-30']);
  assert.match(query.sql, /COALESCE\(c.name, a.person_name\)/);
  assert.match(query.sql, /a.section_id = \? AND a.date >= \? AND a.date <= \?/);
  assert.doesNotMatch(query.sql, /Sam|Planning/);
  for (const dates of [{ from: '2026-11-17' }, { to: '2026-11-17' }, {}]) {
    const all = context.appointmentFilterQuery(7, appointmentFilters({ scope: 'all', ...dates }));
    assert.doesNotMatch(all.sql, /a.section_id = \?/);
    assert.equal(all.sql.includes('a.date >= ?'), !!dates.from);
    assert.equal(all.sql.includes('a.date <= ?'), !!dates.to);
  }
});

test('appointment sorting is whitelisted, deterministic, and rejects invalid search ranges', () => {
  const { context } = setup();
  for (const sort of ['date-asc', 'date-desc', 'name-asc', 'name-desc', 'title-asc', 'title-desc']) {
    const { order } = context.appointmentFilterQuery(1, appointmentFilters({ sort }));
    assert.match(order, /a.id(?: ASC| DESC)?$/);
    assert.match(order, sort.startsWith('date') ? /^a.date/ : sort.startsWith('name') ? /^COALESCE/ : /^a.title/);
    assert.match(order, sort.endsWith('desc') ? /DESC/ : /ASC/);
  }
  for (const patch of [{ sort: '__proto__' }, { sort: 'a.id; DELETE FROM appointments' },
    { scope: 'unknown' }, { from: '2026-02-30' }, { to: 'not-a-date' },
    { from: '2026-11-18', to: '2026-11-17' }]) {
    assert.throws(() => context.appointmentFilterQuery(1, appointmentFilters(patch)), /valid|From date/);
  }
  assert.equal(context.validateAppointmentFilters(appointmentFilters({
    from: '2026-11-17', to: '2026-11-17' })), null);
});

test('appointment result pages reset on search and sorting changes, preserve invalid drafts, and return to daily view', () => {
  const { context, element, warnings } = setup();
  const rows = Array.from({ length: 45 }, (_, index) =>
    [index + 1, '<Planning>', '2026-11-17', '09:00', '10:00', 'Sam', '<Work>']);
  const batches = [];
  context.db.exec = (sql, params = []) => {
    if (sql === 'SELECT total_changes()') return [{ values: [[0]] }];
    if (sql.startsWith('SELECT COUNT(*)')) return [{ values: [[45]] }];
    if (sql.startsWith('SELECT a.id, a.title')) {
      batches.push(clone(params.slice(-2)));
      return [{ values: rows.slice(params.at(-1), params.at(-1) + params.at(-2)) }];
    }
    throw new Error('Unexpected query: ' + sql);
  };
  context.renderMain = () => context.renderAppointmentBoard(context.activeSectionId, 'Work', '#123456');
  context.renderMain();
  const apply = patch => {
    const filters = appointmentFilters(patch);
    for (const [suffix, field] of [['Person', 'person'], ['Title', 'title'], ['From', 'from'],
      ['To', 'to'], ['Scope', 'scope'], ['Sort', 'sort']]) {
      element('appointmentFilter' + suffix).value = filters[field];
    }
    context.applyAppointmentFilters({ preventDefault() {} });
  };
  apply({ person: 'Sam' });
  assert.match(element('mainBody').innerHTML, /Showing 20 of 45 matching appointments/);
  assert.match(element('mainBody').innerHTML, /openAppointmentDetails\(1\)/);
  assert.match(element('mainBody').innerHTML, /&lt;Planning&gt;/);
  assert.match(element('mainBody').innerHTML, /&lt;Work&gt;/);
  assert.doesNotMatch(element('mainBody').innerHTML, /id="appointmentTimeline"/);
  context.loadMorePage('appointment-filters', context.renderMain);
  assert.match(element('mainBody').innerHTML, /Showing 40 of 45/);
  assert.deepEqual(batches.at(-1), [21, 20]);
  apply({ person: 'Sam', sort: 'name-desc' });
  assert.match(element('mainBody').innerHTML, /Showing 20 of 45/);
  assert.deepEqual(batches.at(-1), [21, 0]);
  const before = element('mainBody').innerHTML;
  apply({ from: '2026-11-18', to: '2026-11-17' });
  assert.equal(element('mainBody').innerHTML, before);
  assert.match(warnings.at(-1), /From date/);
  context.setAppointmentDay('2026-11-17');
  assert.match(element('mainBody').innerHTML, /id="appointmentTimeline"/);
  apply({ scope: 'all' });
  context.activeSectionId = 2;
  context.renderMain();
  assert.match(element('mainBody').innerHTML, /id="appointmentTimeline"/);
  assert.match(element('mainBody').innerHTML, /value="board" selected/);
});

test('day arrows update the navigation label, selected date and query, including year boundaries', () => {
  const { context, element, appointments } = setup();
  context.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-17T12:00:00'])); }
  };
  vm.runInContext(app.match(/function dayKey\(date\) \{[\s\S]*?\n\}/)[0], context);
  let queriedDay;
  context.db.exec = (sql, params = []) => {
    if (sql === 'SELECT total_changes()') return [{ values: [[0]] }];
    const rows = appointments.filter(row => row.date === params[0]);
    if (sql.startsWith('SELECT COUNT(*)')) return [{ values: [[rows.length]] }];
    if (sql.startsWith('SELECT a.id, a.title')) {
      queriedDay = params[0];
      return [{ values: rows.map(row => [row.id, row.title, row.date,
        row.start_time, row.end_time, row.person_name]) }];
    }
    throw new Error('Unexpected query: ' + sql);
  };
  context.renderMain = () => context.renderAppointmentBoard(1, 'Work', '#123456');
  const check = (day, label) => {
    const html = element('mainBody').innerHTML;
    assert.equal(html.match(/id="appointmentDayLabel">([^<]+)</)[1], label);
    assert.match(html, new RegExp('id="appointmentDayPicker" value="' + day + '"'));
    assert.equal(queriedDay, day);
    assert.equal(html.includes('onclick="setAppointmentDay(dayKey())"'), day !== '2026-11-17');
  };
  context.renderMain();
  check('2026-11-17', 'Today');
  assert.match(element('mainBody').innerHTML, /openAppointmentDetails\(3\)/);
  context.moveAppointmentDay(-1);
  check('2026-11-16', 'Yesterday');
  assert.doesNotMatch(element('mainBody').innerHTML, /openAppointmentDetails\(3\)|No appointments today/);
  context.moveAppointmentDay(1);
  check('2026-11-17', 'Today');
  context.moveAppointmentDay(1);
  check('2026-11-18', 'Tomorrow');
  context.moveAppointmentDay(1);
  check('2026-11-19', new Date('2026-11-19T12:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' }));
  context.setAppointmentDay(context.dayKey());
  check('2026-11-17', 'Today');
  context.setAppointmentDay('2026-12-31');
  context.moveAppointmentDay(1);
  check('2027-01-01', new Date('2027-01-01T12:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' }));
  context.moveAppointmentDay(-1);
  check('2026-12-31', new Date('2026-12-31T12:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' }));
});

function calendarSetup() {
  const setupResult = setup();
  const { context } = setupResult;
  const downloads = [];
  const anchor = { href: '', download: '', click() { downloads.push(this.download); } };
  let blob;
  context.Blob = Blob;
  context.URL = { createObjectURL(value) { blob = value; return 'blob:calendar'; }, revokeObjectURL() {} };
  context.document.createElement = () => anchor;
  vm.runInContext(app.slice(app.indexOf('function addToCalendar('), app.indexOf('function isFileSystemBackupSupported(')), context);
  return { ...setupResult, downloads, blob: () => blob };
}

test('recurrence honors intervals, chosen weekdays, inclusive endings and occurrence counts', () => {
  const { context, statements } = setup();
  const rule = patch => ({ frequency: 'weekly', interval: 2, start: '2026-11-18',
    days: [1, 3], until: '', count: 4, ...patch });
  const weekly = rule();
  assert.equal(context.firstAppointmentOccurrence(rule({ days: [1] })), '2026-11-30');
  assert.equal(context.firstAppointmentOccurrence(rule({ days: [1], until: '2026-11-25' })), null);
  context.truncateAppointmentSeries({ id: 42, date: weekly.start,
    recurrence: JSON.stringify(rule({ days: [1] })) }, '2026-11-30');
  assert.match(statements[0].sql, /^DELETE FROM appointments/);
  assert.deepEqual(['2026-11-16', '2026-11-18', '2026-11-23', '2026-11-30', '2026-12-02',
    '2026-12-14', '2026-12-16'].map(date => context.recurrenceOrdinal(weekly, date)), [0, 1, 0, 2, 3, 4, 0]);
  const daily = rule({ frequency: 'daily', interval: 3, count: null, until: '2026-11-24' });
  assert.equal(context.recurrenceOrdinal(daily, '2026-11-21'), 2);
  assert.equal(context.recurrenceOrdinal(daily, '2026-11-24'), 3);
  assert.equal(context.recurrenceOrdinal(daily, '2026-11-25'), 0);
  for (const patch of [{ interval: 0 }, { interval: 1.5 }, { days: [] }, { days: [7] },
    { until: '2026-11-17' }, { count: 0 }, { count: 10000 }, { frequency: 'hourly' }]) {
    assert.throws(() => context.validateAppointmentRecurrence(rule(patch)), /valid repeat/);
  }
});

test('monthly and yearly patterns skip missing dates and count actual occurrences', () => {
  const { context } = setup();
  const monthly = { frequency: 'monthly', interval: 1, start: '2026-01-31', days: [], until: '', count: 3 };
  assert.deepEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-07-31']
    .map(date => context.recurrenceOrdinal(monthly, date)), [1, 0, 2, 0, 3, 0]);
  const yearly = { ...monthly, frequency: 'yearly', start: '2024-02-29', count: 2 };
  assert.equal(context.recurrenceOrdinal(yearly, '2025-02-28'), 0);
  assert.equal(context.recurrenceOrdinal(yearly, '2028-02-29'), 2);
  assert.equal(context.recurrenceOrdinal(yearly, '2032-02-29'), 0);
});

test('series rules and canceled exceptions round-trip in backups; malformed references and reminders reject', () => {
  const { context, statements } = setup();
  const master = { ...appointment, recurrence: JSON.stringify({ frequency: 'daily', interval: 1,
    start: appointment.date, days: [], until: '', count: null }), recurrence_parent: null,
  original_date: '', cancelled: 0, reminder_minutes: 30 };
  const exception = { ...master, id: 4, recurrence: '', recurrence_parent: 3,
    original_date: '2026-11-18', date: '2026-11-18', cancelled: 1 };
  const snapshot = { sections: [{ columns: ['id', 'type'], values: [[1, 'appointment']] }],
    contacts: result([contact]), appointments: result([master, exception]) };
  context.validateAppointmentSnapshot(snapshot);
  context.restoreAppointmentSnapshot(snapshot);
  const restored = statements.filter(row => row.sql.startsWith('INSERT INTO appointments'));
  assert.deepEqual(restored[0].params.slice(-5), [master.recurrence, null, '', 0, 30]);
  assert.deepEqual(restored[1].params.slice(-5), ['', 3, '2026-11-18', 1, 30]);
  for (const patch of [{ recurrence_parent: 999 }, { original_date: 'invalid' }, { reminder_minutes: 7 },
    { recurrence: '{"frequency":"daily"}' }]) {
    assert.throws(() => context.validateAppointmentSnapshot({ ...snapshot,
      appointments: result([master, { ...exception, ...patch }]) }));
  }
});

test('editing one exception preserves its own reminder while series edits load the series setting', () => {
  const { context, element, appointments } = setup();
  const master = { ...appointment, recurrence: JSON.stringify({ frequency: 'daily', interval: 1,
    start: appointment.date, days: [], until: '', count: 5 }), reminder_minutes: 15 };
  const exception = { ...appointment, id: 4, date: '2026-11-18', recurrence_parent: 3,
    original_date: '2026-11-18', recurrence: '', reminder_minutes: 30 };
  appointments.splice(0, appointments.length, master, exception);
  const exec = context.db.exec;
  context.db.exec = (sql, params) => sql === 'SELECT * FROM appointments WHERE id = ?'
    ? result(appointments.filter(row => row.id === params[0])) : exec(sql, params);
  context.openAppointmentModal(4);
  assert.equal(element('appointmentReminder').value, 30);
  assert.equal(element('appointmentRepeat').disabled, true);
  context.changeAppointmentEditScope('series');
  assert.equal(element('appointmentReminder').value, 15);
  assert.equal(element('appointmentDate').value, '2026-11-17');
  assert.equal(element('appointmentRepeat').disabled, false);
  context.changeAppointmentEditScope('future');
  assert.equal(element('appointmentRepeatCount').value, 4);
});

test('appointment reminders respect lead time, off, end time, distinct start dismissal and bounded batches', () => {
  const { context } = setup();
  const banners = [];
  const alerts = [];
  const queries = [];
  const records = [
    [1, '<Planning>', '2026-11-17', '10:00', '11:00', 15],
    [2, 'Too early', '2026-11-17', '11:00', '12:00', 15],
    [3, 'At start only', '2026-11-17', '10:00', '11:00', 0],
    [4, 'Started', '2026-11-17', '09:30', '10:30', 15],
    ...Array.from({ length: 22 }, (_, index) => [index + 10, 'Batch ' + index, '2026-11-17', '10:00', '11:00', 15]),
  ];
  context.triggerReminderAttention = (...args) => alerts.push(args);
  context.db.exec = (sql, params) => {
    queries.push({ sql, params: clone(params) });
    return [{ values: records.slice(params.at(-1), params.at(-1) + params.at(-2)) }];
  };
  const container = { insertAdjacentHTML: (_, html) => banners.push(html) };
  context.appendAppointmentReminders(container, new Date('2026-11-17T09:50:00'), {
    'appointment:4:2026-11-17:09:30:soon': true,
  });
  assert.equal(banners.length, 24);
  assert.match(banners[0], /&lt;Planning&gt;/);
  assert.ok(alerts.some(([key, , , urgent]) => key === 'appointment:4:2026-11-17:09:30:start' && urgent));
  assert.ok(!alerts.some(([key]) => key.startsWith('appointment:2:') || key.startsWith('appointment:3:')));
  assert.deepEqual(queries.map(query => query.params.slice(-2)), [[20, 0], [20, 20]]);
  assert.match(queries[0].sql, /reminder_minutes >= 0/);
  assert.match(queries[0].sql, /end_time > \?/);
});

test('appointment details offer the shared calendar export with exact start/end and person details', async () => {
  const { context, element, appointments, downloads, blob } = calendarSetup();
  Object.assign(appointments[0], { start_time: '14:15', end_time: '15:45',
    description: 'First line\r\nSecond; line, with \\ slash', location: 'Room 1, Building; A' });
  context.openAppointmentDetails(3);
  assert.match(element('appointmentDetails').innerHTML, /addAppointmentToCalendar\(event, 3\)/);
  context.addAppointmentToCalendar({ stopPropagation() {} }, 3);
  const ics = await blob().text();
  const stamp = time => new Date(`2026-11-17T${time}:00`).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  assert.ok(ics.includes(`DTSTART:${stamp('14:15')}\r\n`));
  assert.ok(ics.includes(`DTEND:${stamp('15:45')}\r\n`));
  assert.ok(ics.includes('DESCRIPTION:First line\\nSecond\\; line\\, with \\\\ slash\\nWith: Sam\\n123\\nsam@example.test\r\n'));
  assert.ok(ics.includes('LOCATION:Room 1\\, Building\\; A\r\n'));
  assert.ok(ics.includes('TRIGGER:-PT15M\r\n'));
  assert.match(ics, /UID:dashora-appointment-3-/);
  assert.deepEqual(downloads, ['dashora-Planning.ics']);
  assert.equal(blob().type, 'text/calendar;charset=utf-8');
});

test('task calendar export retains its due time, one-hour duration and reminder', async () => {
  const { context, downloads, blob } = calendarSetup();
  context.db.exec = () => [{ values: [['Task title', 'Task description', '2026-11-17T10:00:00Z']] }];
  context.addToCalendar({ stopPropagation() {} }, 7);
  const ics = await blob().text();
  assert.ok(ics.includes('DTSTART:20261117T100000Z\r\n'));
  assert.ok(ics.includes('DTEND:20261117T110000Z\r\n'));
  assert.ok(ics.includes('DESCRIPTION:Task description\r\n'));
  assert.ok(ics.includes('TRIGGER:-PT15M\r\n'));
  assert.deepEqual(downloads, ['dashora-Task-title.ics']);
});

test('calendar export reports a deleted appointment instead of downloading it', () => {
  const { context, appointments, downloads, warnings } = calendarSetup();
  appointments.length = 0;
  context.addAppointmentToCalendar({ stopPropagation() {} }, 3);
  assert.deepEqual(downloads, []);
  assert.deepEqual(warnings, ['Appointment no longer exists']);
});

test('appointment calendar export uses the chosen reminder or omits its alarm when off', async () => {
  const { context, appointments, blob } = calendarSetup();
  for (const minutes of [-1, 0, 30, 1440]) {
    appointments[0].reminder_minutes = minutes;
    context.addAppointmentToCalendar({ stopPropagation() {} }, 3);
    const ics = await blob().text();
    if (minutes === -1) assert.doesNotMatch(ics, /VALARM|TRIGGER/);
    else assert.ok(ics.includes(`TRIGGER:-PT${minutes}M\r\n`));
  }
});

test('appointment descriptions and one-off contact notes preserve exact Markdown and independent directions', async () => {
  const { context, element, statements } = setup();
  const description = '  ## Meeting\n\n**Keep** two spaces  \nnext\n';
  const notes = '  > Contact notes\n\n- [ ] Follow up\n';
  element('appointmentDescription').value = description;
  element('appointmentDescriptionFormat').value = 'markdown';
  element('appointmentDescriptionDirection').value = 'rtl';
  element('appointmentPersonNotes').value = notes;
  element('appointmentPersonNotesFormat').value = 'markdown';
  element('appointmentPersonNotesDirection').value = 'ltr';
  element('appointmentSaveContact').checked = false;
  await context.saveAppointment({ preventDefault() {} });
  const saved = statements.find(row => row.sql.startsWith('INSERT INTO appointments'));
  assert.equal(saved.params[5], notes);
  assert.equal(saved.params[10], description);
  assert.deepEqual(saved.params.slice(12), ['markdown', 'rtl', 'markdown', 'ltr']);
});

test('saving a contact automatically retains its notes formatting for future appointments', async () => {
  const { context, element, statements } = setup();
  element('appointmentPersonNotes').value = '\n## Contact\n\n**Notes**\n';
  element('appointmentPersonNotesFormat').value = 'markdown';
  element('appointmentPersonNotesDirection').value = 'rtl';
  await context.saveAppointment({ preventDefault() {} });
  assert.deepEqual(statements.find(row => row.sql.startsWith('INSERT INTO contacts')).params.slice(3),
    ['\n## Contact\n\n**Notes**\n', 'markdown', 'rtl']);
});

test('standalone contact editor preserves exact Markdown notes and selected direction', async () => {
  const { context, element, statements } = setup();
  element('contactPersonName').value = 'New contact';
  element('contactPersonNotes').value = '  ## Notes\n\n> Exact source\n';
  element('contactPersonNotesFormat').value = 'markdown';
  element('contactPersonNotesDirection').value = 'rtl';
  await context.saveContact({ preventDefault() {} });
  assert.deepEqual(statements.find(row => row.sql.startsWith('INSERT INTO contacts')).params.slice(3),
    ['  ## Notes\n\n> Exact source\n', 'markdown', 'rtl']);
});

test('appointment reader forwards description and contact-note formatting to the common renderer', () => {
  const { context, appointments } = setup();
  Object.assign(appointments[0], { description_format: 'markdown', description_direction: 'rtl',
    person_notes_format: 'markdown', person_notes_direction: 'ltr' });
  const calls = [];
  context.renderDescription = (...args) => { calls.push(args); return '<p>Rendered</p>'; };
  context.openAppointmentDetails(3);
  assert.deepEqual(calls, [
    ['Contact notes', 'markdown', 'ltr'],
    ['Discuss next steps\nKeep this line', 'markdown', 'rtl'],
  ]);
});

test('new formatting metadata round-trips through snapshots while old snapshots default to plain Auto', () => {
  const { context, statements } = setup();
  const snapshot = { sections: [{ columns: ['id', 'type'], values: [[1, 'appointment']] }],
    contacts: result([{ ...contact, notes_format: 'markdown', notes_direction: 'rtl' }]),
    appointments: result([{ ...appointment, description_format: 'markdown', description_direction: 'ltr',
      person_notes_format: 'markdown', person_notes_direction: 'rtl' }]) };
  context.validateAppointmentSnapshot(snapshot);
  context.restoreAppointmentSnapshot(snapshot);
  assert.deepEqual(statements[0].params.slice(-2), ['markdown', 'rtl']);
  assert.deepEqual(statements[1].params.slice(13, 17), ['markdown', 'ltr', 'markdown', 'rtl']);
  const badContact = clone(snapshot);
  badContact.contacts[0].values[0].splice(-1, 1, 'sideways');
  assert.throws(() => context.validateAppointmentSnapshot(badContact), /Invalid contact/);
  const badAppointment = clone(snapshot);
  badAppointment.appointments[0].values[0].splice(-4, 1, 'html');
  assert.throws(() => context.validateAppointmentSnapshot(badAppointment), /Invalid appointment/);
});

test('saving waits for image paste in either rich-text field', async () => {
  const { context, element, statements, warnings } = setup();
  vm.runInContext("richTextImagePastes.add('appointmentDescription')", context);
  await context.saveAppointment({ preventDefault() {} });
  element('contactPersonName').value = 'Contact';
  await context.saveContact({ preventDefault() {} });
  assert.deepEqual(statements, []);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every(message => message.includes('image paste')));
});

function richEditorSetup() {
  const setupResult = setup();
  const { context, element } = setupResult;
  const input = element('appointmentDescription');
  context.Event = class { constructor(type) { this.type = type; } };
  context.document.execCommand = () => false;
  input.focus = () => { context.document.activeElement = input; };
  input.setSelectionRange = (start, end) => { input.selectionStart = start; input.selectionEnd = end; };
  input.setRangeText = (text, start, end) => {
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    input.selectionStart = input.selectionEnd = start + text.length;
  };
  input.dispatchEvent = () => {};
  input.closest = () => ({ classList: { contains: () => true } });
  vm.runInContext(app.slice(app.indexOf('function insertDescriptionText('), app.indexOf('async function pasteDescriptionImages(')), context);
  return { ...setupResult, input };
}

test('embedded editor uses existing formatting and preview helpers without rewriting Markdown', () => {
  const { context, element, input } = richEditorSetup();
  context.setRichTextEditor('appointmentDescription', 'hello', 'markdown', 'rtl');
  input.selectionStart = 0;
  input.selectionEnd = 5;
  context.formatRichTextEditor('appointmentDescription', 'bold');
  assert.equal(input.value, '**hello**');
  const calls = [];
  context.renderDescriptionContent = (...args) => { calls.push(args); return '<strong>hello</strong>'; };
  context.setRichTextEditorMode('appointmentDescription', 'preview');
  assert.equal(element('appointmentDescriptionPreview').innerHTML, '<strong>hello</strong>');
  assert.deepEqual(calls, [['**hello**', 'markdown', 'rtl']]);
  assert.equal(input.hidden, true);
  context.setRichTextEditorMode('appointmentDescription', 'write');
  assert.equal(input.value, '**hello**');
  assert.equal(input.hidden, false);
});

for (const changed of [false, true]) {
  test('embedded image paste ' + (changed ? 'rejects a changed editor' : 'inserts using the existing image Markdown helper'), async () => {
    const { context, input, warnings } = richEditorSetup();
    context.setRichTextEditor('appointmentDescription', 'before after', 'markdown', 'auto');
    input.selectionStart = input.selectionEnd = 7;
    input.focus();
    let release;
    context.readDescriptionImage = () => new Promise(resolve => { release = resolve; });
    const pending = context.onRichTextPaste({ currentTarget: input, preventDefault() {},
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => ({}) }] } }, 'appointmentDescription');
    if (changed) context.setRichTextEditor('appointmentDescription', 'New draft', 'markdown', 'auto');
    release('![Pasted image](data:image/png;base64,aGVsbG8=)');
    await pending;
    assert.equal(input.value, changed ? 'New draft' : 'before \n\n![Pasted image](data:image/png;base64,aGVsbG8=)\n\nafter');
    assert.equal(warnings.length, changed ? 1 : 0);
    assert.equal(vm.runInContext('richTextImagePastes.size', context), 0);
  });
}
