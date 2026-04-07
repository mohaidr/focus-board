/* ================================================================
   Dashora – Database Layer
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

  // Migration: add status column (0=todo, 1=in-progress, 2=done)
  try {
    db.exec('SELECT status FROM items LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE items ADD COLUMN status INTEGER DEFAULT 0');
    // Migrate: completed=1 → status=2
    db.run('UPDATE items SET status = 2 WHERE completed = 1');
  }

  // Migration: add completed_at column for auto-delete feature
  try {
    db.exec('SELECT completed_at FROM items LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE items ADD COLUMN completed_at TEXT DEFAULT NULL');
  }

  // Migration: add type column to sections ('task' or 'reference')
  try {
    db.exec('SELECT type FROM sections LIMIT 1');
  } catch (e) {
    db.run("ALTER TABLE sections ADD COLUMN type TEXT DEFAULT 'task'");
  }

  // Migration: add prioritized flag to sections (0=auto-sort by date, 1=user-ordered)
  try {
    db.exec('SELECT prioritized FROM sections LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE sections ADD COLUMN prioritized INTEGER DEFAULT 0');
    // Mark existing boards that have a custom sort_order as prioritized
    db.run('UPDATE sections SET prioritized = 1 WHERE sort_order > 0');
  }

  // Migration: add sketch_data column for sketch items (stores base64 PNG)
  try {
    db.exec('SELECT sketch_data FROM items LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE items ADD COLUMN sketch_data TEXT DEFAULT NULL');
  }

  // Migration: add due_date column for planned completion date (YYYY-MM-DD)
  try {
    db.exec('SELECT due_date FROM items LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE items ADD COLUMN due_date TEXT DEFAULT NULL');
  }
}

// ── Seed Data ──

function seedData() {
}

// ── Migrations ──

function migrateTasksFirst() {
  const res = db.exec("SELECT id FROM sections WHERE name = 'Tasks for Today'");
  if (!res.length || !res[0].values.length) return;

  const tasksId = res[0].values[0][0];
  const allSections = db.exec('SELECT id FROM sections ORDER BY prioritized DESC, CASE WHEN prioritized = 1 THEN sort_order END ASC, created_at DESC, id DESC');
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
  const lastReset = localStorage.getItem('Dashora_last_reset');

  if (lastReset === today) return; // Already reset today

  // Un-complete all recurring tasks
  db.run('UPDATE items SET completed = 0, status = 0 WHERE recurring = 1 AND completed = 1');

  localStorage.setItem('Dashora_last_reset', today);
}

function autoDeleteCompletedTasks() {
  const enabled = localStorage.getItem('dashora_autodelete_enabled');
  if (enabled !== 'true') return;

  const days = parseInt(localStorage.getItem('dashora_autodelete_days') || '7', 10);
  if (isNaN(days) || days < 1) return;

  // Delete done items whose completed_at is older than the threshold
  db.run(
    `DELETE FROM items
     WHERE status = 2
       AND completed_at IS NOT NULL
       AND datetime(completed_at) <= datetime('now', '-' || ? || ' days')`,
    [days]
  );
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

  // Auto-delete old completed tasks if enabled
  autoDeleteCompletedTasks();

  persist();

  // Select first section by default
  const first = db.exec('SELECT id FROM sections ORDER BY prioritized DESC, CASE WHEN prioritized = 1 THEN sort_order END ASC, created_at DESC, id DESC LIMIT 1');
  if (first.length && first[0].values.length) {
    activeSectionId = first[0].values[0][0];
  }

  renderSidebar();
  renderMain();

  // Check for due date notifications
  checkDueDateNotifications();
}
