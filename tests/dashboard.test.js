const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'dashboard.js'), 'utf8');
const paging = fs.readFileSync(path.join(__dirname, '..', 'js', 'paging.js'), 'utf8');
const boards = [{ id: 1, name: 'Work' }, { id: 2, name: 'Home' }];
const now = new Date(2026, 9, 29, 12);
const stamp = (day, hour = 10) => new Date(2026, 9, day, hour).toISOString();
const task = (status, completed_at = null, due_date = null, section_id = 1) =>
  ({ section_id, status, completed_at, due_date });

function setup() {
  const elements = Object.fromEntries(['mainHeader', 'mainBody', 'searchBox', 'dashboardDays', 'dashboardBoard']
    .map(id => [id, { innerHTML: '', value: '' }]));
  const escape = value => String(value).replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const context = vm.createContext({
    Date, Set, Map, document: { getElementById: id => elements[id] },
    esc: escape, escAttr: escape, activeView: 'board', sectionSearchTerm: '',
    renderSidebar() {}, renderMain() {}, closeSidebar() {},
  });
  vm.runInContext(paging, context);
  vm.runInContext(source, context);
  return { context, elements };
}

test('empty data produces zero counts, an undefined rate, and seven local days', () => {
  const { context } = setup();
  const stats = context.buildDashboardStats([], boards, 7, '', now);
  assert.equal(stats.total, 0);
  assert.equal(stats.rate, null);
  assert.equal(stats.completed, 0);
  assert.equal(stats.daily.length, 7);
  assert.equal(stats.daily[0].key, '2026-10-23');
  assert.equal(stats.daily[6].key, '2026-10-29');
});

test('counts statuses and only dated, non-future completions in the inclusive period', () => {
  const { context } = setup();
  const tasks = [
    task(2, stamp(23)), task(2, stamp(22)), task(2, stamp(29)),
    task(2), task(2, 'invalid'), task(2, stamp(29, 13)),
    task(1, stamp(28)), task(0),
    task(2, stamp(29), null, 99),
  ];
  const stats = context.buildDashboardStats(tasks, boards, 7, '', now);
  assert.equal(stats.total, 8);
  assert.equal(stats.completed, 2);
  assert.equal(stats.status[2], 6);
  assert.equal(stats.active, 2);
  assert.equal(stats.rate, 75);
  assert.equal(stats.undatedDone, 2);
});

test('board filter applies to every metric and excludes reference/orphan records', () => {
  const { context } = setup();
  const stats = context.buildDashboardStats([
    task(2, stamp(29)), task(0, null, null, 2), task(2, stamp(29), null, 3),
  ], boards, 30, '2', now);
  assert.equal(stats.total, 1);
  assert.equal(stats.completed, 0);
  assert.equal(stats.rate, 0);
  assert.equal(stats.progress.length, 1);
  assert.equal(stats.progress[0].name, 'Home');
  assert.equal(stats.daily.length, 30);
  assert.equal(stats.daily[0].key, '2026-09-30');
});

test('overdue deadlines respect time, local date-only end of day, and task status', () => {
  const { context } = setup();
  const stats = context.buildDashboardStats([
    task(0, null, '2026-10-28'), task(1, null, '2026-10-29T11:59'),
    task(0, null, '2026-10-29'), task(0, null, '2026-10-29T12:00'),
    task(0, null, '2026-10-30'), task(0, null, 'invalid'),
    task(2, stamp(28), '2026-10-27'),
  ], boards, 7, '', now);
  assert.equal(stats.overdue, 2);
});

test('SQLite UTC timestamps and offset timestamps map to the correct local day', () => {
  const { context } = setup();
  assert.equal(context.dashboardTimestamp('2026-10-29 05:30:00').toISOString(), '2026-10-29T05:30:00.000Z');
  const completion = '2026-10-29T00:30:00+09:00';
  const expectedDay = context.dashboardDateKey(new Date(completion));
  const stats = context.buildDashboardStats([task(2, completion)], boards, 7, '', now);
  assert.equal(stats.daily.find(day => day.key === expectedDay).count, 1);
});

test('deleting, reopening, or resetting a task removes its completion from the snapshot', () => {
  const { context } = setup();
  assert.equal(context.buildDashboardStats([task(2, stamp(29))], boards, 7, '', now).completed, 1);
  for (const tasks of [[], [task(0)], [task(1)]]) {
    assert.equal(context.buildDashboardStats(tasks, boards, 7, '', now).completed, 0);
  }
});

test('renders accessible charts, escapes board names, filters, and handles empty data', () => {
  const { context, elements } = setup();
  const name = '<img src=x onerror=alert(1)>';
  context.readBoardOptions = () => ({ page: { hasMore: false }, rows: [[1, name]] });
  context.readListPage = () => ({ hasMore: false, rows: [[1, name, 2, 1]] });
  context.db = {
    create_function() {},
    exec: sql => sql.startsWith('SELECT COUNT(*)')
      ? [{ values: [[2, 1, 0, 1, 1, 0]] }] : [],
  };
  context.renderDashboard();
  assert.match(elements.mainBody.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(elements.mainBody.innerHTML, /<img/);
  assert.match(elements.mainBody.innerHTML, /role="img"/);
  assert.match(elements.mainBody.innerHTML, /<caption>Daily task completions/);
  assert.equal((elements.mainBody.innerHTML.match(/<th scope="row">/g) || []).length, 7);
  elements.dashboardDays.value = '30';
  elements.dashboardBoard.value = '1';
  context.updateDashboardFilters();
  assert.equal((elements.mainBody.innerHTML.match(/<th scope="row">/g) || []).length, 30);
  context.readBoardOptions = () => ({ page: { hasMore: false }, rows: [] });
  context.readListPage = () => ({ hasMore: false, rows: [] });
  context.db.exec = sql => sql.startsWith('SELECT COUNT(*)') ? [{ values: [[0, 0, 0, 0, 0, 0]] }] : [];
  context.renderDashboard();
  assert.match(elements.mainBody.innerHTML, /No tasks to measure yet/);
  assert.doesNotMatch(elements.mainBody.innerHTML, /NaN|Infinity/);
});
