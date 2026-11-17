const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const paging = fs.readFileSync(path.join(__dirname, '..', 'js', 'paging.js'), 'utf8');
const markdown = fs.readFileSync(path.join(__dirname, '..', 'js', 'markdown.js'), 'utf8');

function setup() {
  const records = Array.from({ length: 53 }, (_, id) => [id, 'Record ' + id]);
  const requests = [];
  const functions = {};
  let version = 0;
  const context = vm.createContext({
    Map, Set,
    unlockedProtectedItems: new Set(), decryptedProtectedItems: new Map(),
    isItemLocked: (id, protectedItem) => protectedItem === 1 && !context.unlockedProtectedItems.has(id),
    escAttr: value => value.replace(/"/g, '&quot;'), toast() {},
    db: {
      create_function: (name, fn) => { functions[name] = fn; },
      exec: (sql, params = []) => {
        if (sql === 'SELECT total_changes()') return [{ values: [[version]] }];
        if (sql.endsWith(' AND id = ?')) {
          requests.push({ sql, params: [...params], point: true });
          const rows = records.filter(row => row[0] === params.at(-1) &&
            (params.length === 1 || row[1].includes(params[0])));
          return rows.length ? [{ values: rows }] : [];
        }
        assert.match(sql, / LIMIT \? OFFSET \?$/);
        const [limit, offset] = params.slice(-2);
        assert.equal(limit, 21);
        requests.push({ sql, params: [...params], offset });
        const matches = params.length > 2 ? records.filter(row => row[1].includes(params[0])) : records;
        const rows = matches.slice(offset, offset + limit);
        return rows.length ? [{ values: rows }] : [];
      },
    },
  });
  vm.runInContext(markdown, context);
  vm.runInContext(paging, context);
  return { context, records, requests, functions, change: () => { version++; } };
}

test('load more fetches only the next batch; re-rendering does not re-fetch previously loaded rows', () => {
  const { context, requests } = setup();
  const read = () => context.readListPage('list', 'SELECT id, name FROM records ORDER BY id');
  let page = read();
  assert.equal(page.rows.length, 20);
  assert.equal(page.hasMore, true);
  read();
  assert.equal(requests.length, 1);
  context.loadMorePage('list', read);
  assert.deepEqual(requests.map(request => request.offset), [0, 20]);
  assert.equal(page.rows.length, 40);
  context.loadMorePage('list', read);
  assert.equal(page.rows.length, 53);
  assert.equal(page.hasMore, false);
  assert.equal(new Set(page.rows.map(row => row[0])).size, 53);
  read();
  assert.equal(requests.length, 3);
});

test('filter changes start at the first page, while writes refresh loaded batches without stale or deleted rows', () => {
  const { context, records, requests, change } = setup();
  const read = () => context.readListPage('list', 'SELECT id, name FROM records ORDER BY id');
  read();
  context.loadMorePage('list', read);
  records.shift();
  change();
  const updated = read();
  assert.equal(updated.rows.length, 40);
  assert.equal(updated.rows[0][0], 1);
  assert.deepEqual(requests.slice(-2).map(request => request.offset), [0, 20]);
  const filtered = context.readListPage('list', 'SELECT id, name FROM records WHERE matches(name, ?) ORDER BY id', ['Record 52']);
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0][0], 52);
  assert.equal(filtered.hasMore, false);
  assert.equal(requests.at(-1).offset, 0);
});

test('persistence invalidation refreshes data even when exporting SQLite resets its change counter', () => {
  const { context, records, requests } = setup();
  context.readListPage('list', 'SELECT id, name FROM records ORDER BY id');
  records[0][1] = 'Updated';
  context.invalidateListPages();
  assert.equal(context.readListPage('list', 'SELECT id, name FROM records ORDER BY id').rows[0][1], 'Updated');
  assert.equal(requests.length, 2);
  context.resetListPage('list');
  assert.equal(context.readListPage('list', 'SELECT id, name FROM records ORDER BY id').rows.length, 20);
});

test('database search respects Unicode, note contents, locks, and decrypted fields without changing stored data', () => {
  const { context, functions } = setup();
  context.registerListSearch();
  assert.equal(functions.text_matches('Émilie', 'émil'), 1);
  const notes = JSON.stringify([{ title: 'Agenda', description: 'Special note', descriptionFormat: 'plain', descriptionDirection: 'auto' }]);
  assert.equal(functions.item_matches(1, 'Title', '', notes, 0, 0, 'reference', 'special'), 1);
  assert.equal(functions.item_matches(1, 'Title', '', notes, 1, 0, 'reference', 'special'), 0);
  context.unlockedProtectedItems.add(1);
  context.decryptedProtectedItems.set(1, { title: 'Secret title', description: 'Private description', notes: [] });
  assert.equal(functions.item_matches(1, 'Encrypted item', '', '[]', 1, 1, 'reference', 'private'), 1);
  context.decryptedProtectedItems.clear();
  context.unlockedProtectedItems.clear();
  assert.equal(functions.item_matches(1, 'Encrypted item', '', '[]', 1, 1, 'reference', 'private'), 0);
});

test('changing the unlocked search context invalidates cached matches', () => {
  const { context, requests } = setup();
  const read = () => context.readListPage('search', 'SELECT id, name FROM records ORDER BY id', [], context.listSearchRevision());
  read();
  context.loadMorePage('search', read);
  context.unlockedProtectedItems.add(9);
  assert.equal(read().rows.length, 20);
  assert.equal(requests.at(-1).offset, 0);
});

test('a just-saved record outside the loaded page remains visible through one lookup without bypassing filters', () => {
  const { context, requests } = setup();
  const page = context.readListPage('list', 'SELECT id, name FROM records ORDER BY id');
  context.rememberListRecord('item', 52);
  const rows = context.withSavedListRow('item', page.rows, 'SELECT id, name FROM records WHERE 1 = 1', []);
  assert.equal(rows.length, 21);
  assert.equal(rows.at(-1)[0], 52);
  assert.equal(requests.at(-1).point, true);
  const filtered = context.withSavedListRow('item', page.rows, 'SELECT id, name FROM records WHERE matches(name, ?)', ['Missing']);
  assert.equal(filtered.length, 20);
  const before = requests.length;
  assert.equal(context.withSavedListRow('item', rows, '', []).length, 21);
  assert.equal(requests.length, before);
});
