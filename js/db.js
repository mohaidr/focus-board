/* ================================================================
   FocusBoard – Database Layer
   Handles SQLite init, IndexedDB persistence, and seed data.
   ================================================================ */

// ── IndexedDB Helpers ──

function saveToIDB(data) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('StickyHubDB', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('db');
    req.onsuccess = () => {
      const tx = req.result.transaction('db', 'readwrite');
      tx.objectStore('db').put(data, 'sqlite');
      tx.oncomplete = resolve;
      tx.onerror = reject;
    };
    req.onerror = reject;
  });
}

function loadFromIDB() {
  return new Promise((resolve) => {
    const req = indexedDB.open('StickyHubDB', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('db');
    req.onsuccess = () => {
      const tx = req.result.transaction('db', 'readonly');
      const g = tx.objectStore('db').get('sqlite');
      g.onsuccess = () => resolve(g.result || null);
      g.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

function persist() {
  const data = db.export();
  saveToIDB(data.buffer);
}

// ── Schema ──

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS sections (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      color      TEXT DEFAULT '#7c6ff7',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id  INTEGER NOT NULL,
      title       TEXT NOT NULL,
      description TEXT DEFAULT '',
      link        TEXT DEFAULT '',
      completed   INTEGER DEFAULT 0,
      recurring   INTEGER DEFAULT 0,
      sort_order  INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
    )
  `);

  // Migration: add recurring column if missing
  try {
    db.exec('SELECT recurring FROM items LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE items ADD COLUMN recurring INTEGER DEFAULT 0');
  }
}

// ── Seed Data ──

function seedData() {
  // No seed data – app starts with a clean slate.
}

// ── Migrations ──

function migrateTasksFirst() {
  const res = db.exec("SELECT id FROM sections WHERE name = 'Tasks for Today'");
  if (!res.length || !res[0].values.length) return;

  const tasksId = res[0].values[0][0];
  const allSections = db.exec('SELECT id FROM sections ORDER BY sort_order, id');
  if (!allSections.length) return;

  let ids = allSections[0].values.map(r => r[0]);
  // Already first? Nothing to do
  if (ids[0] === tasksId) return;

  ids = ids.filter(id => id !== tasksId);
  ids.unshift(tasksId);
  ids.forEach((id, i) => db.run('UPDATE sections SET sort_order = ? WHERE id = ?', [i, id]));
}

function resetRecurringTasks() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const lastReset = localStorage.getItem('focusboard_last_reset');

  if (lastReset === today) return; // Already reset today

  // Un-complete all recurring tasks
  db.run('UPDATE items SET completed = 0 WHERE recurring = 1 AND completed = 1');

  localStorage.setItem('focusboard_last_reset', today);
}

// ── Database Init (called from app.js) ──

async function initDB() {
  const SQL = await initSqlJs({
    locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`,
  });

  const saved = await loadFromIDB();
  db = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();

  createTables();

  const count = db.exec('SELECT COUNT(*) FROM sections');
  if (count[0].values[0][0] === 0) seedData();

  // Ensure "Tasks for Today" is first
  migrateTasksFirst();

  // Reset recurring tasks at the start of each new day
  resetRecurringTasks();

  persist();

  // Select first section by default
  const first = db.exec('SELECT id FROM sections ORDER BY sort_order, id LIMIT 1');
  if (first.length && first[0].values.length) {
    activeSectionId = first[0].values[0][0];
  }

  renderSidebar();
  renderMain();
}
