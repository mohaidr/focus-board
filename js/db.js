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
// "Tasks for Today" is first so it's selected on first launch.

function seedData() {
  const sections = [
    { name: 'Tasks for Today',       color: '#44cc88' },
    { name: 'Regressions',           color: '#e05577' },
    { name: 'By Design Limitations', color: '#e0a055' },
    { name: 'Important Links',       color: '#55aadd' },
    { name: 'Watch',                 color: '#d4c955' },
    { name: 'Notes',                 color: '#7c6ff7' },
  ];

  sections.forEach((s, i) => {
    db.run(
      'INSERT INTO sections (name, color, sort_order) VALUES (?, ?, ?)',
      [s.name, s.color, i]
    );
  });

  // Section IDs match insert order: 1 = Tasks, 2 = Regressions, etc.
  const items = [
    // Tasks for Today  (section 1)
    { sid: 1, title: 'Review pull requests' },
    { sid: 1, title: 'Reply to team messages' },
    { sid: 1, title: 'Triage incoming issues' },

    // Regressions  (section 2)
    { sid: 2, title: 'Example regression item' },

    // By Design Limitations  (section 3)
    { sid: 3, title: 'Example limitation',
      desc: 'Describe the known limitation and any recommended workaround.' },

    // Important Links  (section 4)
    { sid: 4, title: 'Project Wiki',
      link: 'https://example.com/wiki' },

    // Watch  (section 5)
    { sid: 5, title: 'Track issue #1234' },

    // Notes  (section 6)
    { sid: 6, title: 'Meeting notes placeholder',
      desc: 'Add your meeting notes here.' },
  ];

  items.forEach((item, i) => {
    db.run(
      'INSERT INTO items (section_id, title, description, link, sort_order) VALUES (?, ?, ?, ?, ?)',
      [item.sid, item.title, item.desc || '', item.link || '', i]
    );
  });
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
