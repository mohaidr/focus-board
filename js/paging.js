/* Bounded reads for interactive lists; exports and recovery snapshots stay complete. */
const LIST_PAGE_SIZE = 20;
const listPages = new Map();
const savedListRecords = new Map();

function rememberListRecord(kind, id) {
  savedListRecords.set(kind, id);
}

function withSavedListRow(kind, rows, sql, params, idColumn = 'id') {
  const id = savedListRecords.get(kind);
  if (!id || rows.some(row => row[0] === id)) return rows;
  const result = db.exec(sql + ` AND ${idColumn} = ?`, [...params, id]);
  return result.length ? [...rows, result[0].values[0]] : rows;
}

function invalidateListPages() {
  for (const page of listPages.values()) page.version = -1;
}

function resetListPage(key) {
  listPages.delete(key);
}

function globalSearchPage(term) {
  const query = `SELECT 0 AS kind, i.id, s.sort_order AS board_order, s.id AS board_id, i.sort_order AS item_order
    FROM items i JOIN sections s ON s.id = i.section_id
    WHERE item_matches(i.id, i.title, i.description, i.notes, i.protected, i.encrypted, s.type, ?)
    UNION ALL SELECT 1, a.id, a.date, a.start_time, a.end_time
    ${appointmentSearchFrom()} WHERE ${appointmentSearchWhere()}
    UNION ALL SELECT 2, id, sort_order, id, 0 FROM sections WHERE text_matches(name, ?)`;
  const params = [term, term, term];
  const page = readListPage('global-search', query + ' ORDER BY kind, board_order, board_id, item_order, id',
    params, listSearchRevision());
  const total = db.exec('SELECT COUNT(*) FROM (' + query + ')', params)[0].values[0][0];
  return { page, total };
}

function registerListSearch() {
  db.create_function('text_matches', (value, term) =>
    String(value || '').toLowerCase().includes(String(term).toLowerCase()) ? 1 : 0);
  db.create_function('item_matches', (id, title, description, notes, protectedItem, encrypted, type, term) => {
    if (type === 'reference' && isItemLocked(id, protectedItem)) return 0;
    const payload = encrypted === 1 ? decryptedProtectedItems.get(id) : null;
    return [payload ? payload.title : title, payload ? payload.description : description]
      .some(value => (value || '').toLowerCase().includes(term)) ||
      itemNotesMatch(payload ? validateItemNotes(payload.notes) : parseItemNotes(notes), term) ? 1 : 0;
  });
}

function listSearchRevision() {
  return JSON.stringify([[...unlockedProtectedItems], [...decryptedProtectedItems.keys()]]);
}

function hydrateListItem(row, encryptedIndex, sketchIndex, notesIndex) {
  const hydrated = [...row];
  hydrated[notesIndex] = parseItemNotes(row[notesIndex]);
  const payload = row[encryptedIndex] === 1 ? decryptedProtectedItems.get(row[0]) : null;
  if (payload) {
    hydrated[1] = payload.title || '';
    hydrated[2] = payload.description || '';
    hydrated[3] = payload.link || '';
    hydrated[sketchIndex] = payload.sketchData || null;
    hydrated[notesIndex] = validateItemNotes(payload.notes);
  }
  return hydrated;
}

function readListPage(key, sql, params = [], revision = '') {
  registerListSearch();
  const version = db.exec('SELECT total_changes()')[0].values[0][0];
  const signature = JSON.stringify([sql, params, revision]);
  let page = listPages.get(key);
  if (!page || page.database !== db || page.signature !== signature) {
    page = { key, database: db, signature, version, wanted: LIST_PAGE_SIZE, rows: [], hasMore: true };
    listPages.set(key, page);
  } else if (page.version !== version) {
    page.rows = [];
    page.hasMore = true;
    page.version = version;
  }
  while (page.hasMore && page.rows.length < page.wanted) {
    const result = db.exec(sql + ' LIMIT ? OFFSET ?', [...params, LIST_PAGE_SIZE + 1, page.rows.length]);
    const rows = result.length ? result[0].values : [];
    page.rows.push(...rows.slice(0, LIST_PAGE_SIZE));
    page.hasMore = rows.length > LIST_PAGE_SIZE;
  }
  return page;
}

function loadMorePage(key, render) {
  const page = listPages.get(key);
  if (!page) { toast('This list has changed. Please reopen it.'); return; }
  page.wanted += LIST_PAGE_SIZE;
  render();
}

function renderLoadMore(page, renderCall) {
  if (!page.hasMore) return '';
  const action = `loadMorePage(${JSON.stringify(page.key)}, () => ${renderCall})`;
  return `<div class="load-more-row"><button type="button" class="btn btn-ghost btn-sm"
    onclick="${escAttr(action)}">Load ${LIST_PAGE_SIZE} more</button>
    <span class="appointment-hint" role="status">Showing ${page.rows.length}</span></div>`;
}

function readListObjects(page, columns) {
  return page.rows.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
}

function readBoardOptions(key, type, term, selected) {
  const page = readListPage(key, `SELECT id, name FROM sections
    WHERE COALESCE(type, 'task') = ? AND text_matches(name, ?)
    ORDER BY prioritized DESC, CASE WHEN prioritized = 1 THEN sort_order END ASC, created_at DESC, id DESC`,
  [type, term]);
  const rows = [...page.rows];
  if (selected && selected !== 'new' && !rows.some(row => String(row[0]) === selected)) {
    const result = db.exec("SELECT id, name FROM sections WHERE id = ? AND COALESCE(type, 'task') = ?", [Number(selected), type]);
    if (result.length) rows.unshift(result[0].values[0]);
  }
  return { page, rows };
}
