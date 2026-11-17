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
  return saveToIDB(data.buffer);
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
      description_format TEXT NOT NULL DEFAULT 'plain' CHECK (description_format IN ('plain', 'markdown')),
      description_direction TEXT NOT NULL DEFAULT 'auto' CHECK (description_direction IN ('auto', 'ltr', 'rtl')),
      notes TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
    )
  `);

  const itemColumns = db.exec('PRAGMA table_info(items)')[0].values.map(column => column[1]);
  if (!itemColumns.includes('description_format')) {
    db.run("ALTER TABLE items ADD COLUMN description_format TEXT NOT NULL DEFAULT 'plain' CHECK (description_format IN ('plain', 'markdown'))");
  }
  if (!itemColumns.includes('description_direction')) {
    db.run("ALTER TABLE items ADD COLUMN description_direction TEXT NOT NULL DEFAULT 'auto' CHECK (description_direction IN ('auto', 'ltr', 'rtl'))");
  }
  if (!itemColumns.includes('notes')) {
    db.run("ALTER TABLE items ADD COLUMN notes TEXT NOT NULL DEFAULT '[]'");
  }

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

  // Migration: add recurring_days column (comma-separated day numbers, e.g. "1,3,5" for Mon/Wed/Fri)
  try {
    db.exec('SELECT recurring_days FROM items LIMIT 1');
  } catch (e) {
    db.run("ALTER TABLE items ADD COLUMN recurring_days TEXT DEFAULT NULL");
  }

  // Migration: add recurring_time column (HH:MM format for recurring task reminders)
  try {
    db.exec('SELECT recurring_time FROM items LIMIT 1');
  } catch (e) {
    db.run("ALTER TABLE items ADD COLUMN recurring_time TEXT DEFAULT NULL");
  }

  // Reference-item password protection. Content encryption is handled separately.
  try {
    db.exec('SELECT protected FROM items LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE items ADD COLUMN protected INTEGER DEFAULT 0');
  }
  try {
    db.exec('SELECT password_hash FROM items LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE items ADD COLUMN password_hash TEXT DEFAULT NULL');
  }
  try {
    db.exec('SELECT password_salt FROM items LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE items ADD COLUMN password_salt TEXT DEFAULT NULL');
  }
  try {
    db.exec('SELECT password_iterations FROM items LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE items ADD COLUMN password_iterations INTEGER DEFAULT 210000');
  }
  try {
    db.exec('SELECT encrypted FROM items LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE items ADD COLUMN encrypted INTEGER DEFAULT 0');
  }
  try {
    db.exec('SELECT encrypted_data FROM items LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE items ADD COLUMN encrypted_data TEXT DEFAULT NULL');
  }
  try {
    db.exec('SELECT encryption_iv FROM items LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE items ADD COLUMN encryption_iv TEXT DEFAULT NULL');
  }
  try {
    db.exec('SELECT encryption_version FROM items LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE items ADD COLUMN encryption_version INTEGER DEFAULT NULL');
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT ''
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id INTEGER NOT NULL,
      contact_id INTEGER,
      person_name TEXT NOT NULL,
      person_phone TEXT NOT NULL DEFAULT '',
      person_email TEXT NOT NULL DEFAULT '',
      person_notes TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL CHECK (end_time > start_time),
      description TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS appointments_day ON appointments(date, start_time)');
  for (const [table, fields] of [
    ['contacts', ['notes']],
    ['appointments', ['description', 'person_notes']],
  ]) {
    const columns = db.exec(`PRAGMA table_info(${table})`)[0].values.map(column => column[1]);
    for (const field of fields) {
      for (const [suffix, initial, allowed] of [
        ['format', 'plain', "'plain', 'markdown'"],
        ['direction', 'auto', "'auto', 'ltr', 'rtl'"],
      ]) {
        const column = `${field}_${suffix}`;
        if (!columns.includes(column)) {
          db.run(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT NOT NULL DEFAULT '${initial}' CHECK (${column} IN (${allowed}))`);
        }
      }
    }
  }

  // Follow-ups attached to task items
  db.run(`
    CREATE TABLE IF NOT EXISTS followups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id    INTEGER NOT NULL,
      text       TEXT NOT NULL,
      completed  INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    )
  `);
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
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD
  const lastReset = localStorage.getItem('Dashora_last_reset');

  if (lastReset === todayStr) return; // Already reset today

  const dayOfWeek = today.getDay(); // 0=Sun
  const dayOfMonth = today.getDate();

  // Daily (recurring=1): reset every day
  db.run('UPDATE items SET completed = 0, status = 0, completed_at = NULL WHERE recurring = 1 AND completed = 1');

  // Weekly (recurring=2): reset on Mondays
  if (dayOfWeek === 1) {
    db.run('UPDATE items SET completed = 0, status = 0, completed_at = NULL WHERE recurring = 2 AND completed = 1');
  }

  // Biweekly (recurring=3): reset on 1st and 15th
  if (dayOfMonth === 1 || dayOfMonth === 15) {
    db.run('UPDATE items SET completed = 0, status = 0, completed_at = NULL WHERE recurring = 3 AND completed = 1');
  }

  // Monthly (recurring=4): reset on the 1st
  if (dayOfMonth === 1) {
    db.run('UPDATE items SET completed = 0, status = 0, completed_at = NULL WHERE recurring = 4 AND completed = 1');
  }

  // Specific days (recurring=5): reset if today's day-of-week is in recurring_days
  const specificRes = db.exec("SELECT id, recurring_days FROM items WHERE recurring = 5 AND completed = 1 AND recurring_days IS NOT NULL");
  if (specificRes.length && specificRes[0].values.length) {
    for (const [id, days] of specificRes[0].values) {
      const dayList = (days || '').split(',').map(Number);
      if (dayList.includes(dayOfWeek)) {
        db.run('UPDATE items SET completed = 0, status = 0, completed_at = NULL WHERE id = ?', [id]);
      }
    }
  }

  localStorage.setItem('Dashora_last_reset', todayStr);
}

function autoDeleteCompletedTasks() {
  const enabled = localStorage.getItem('dashora_autodelete_enabled');
  if (enabled !== 'true') return;

  const days = parseInt(localStorage.getItem('dashora_autodelete_days') || '7', 10);
  if (isNaN(days) || days < 1) return;

  // Remove follow-ups belonging to items that are about to be auto-deleted
  db.run(
    `DELETE FROM followups
     WHERE item_id IN (
       SELECT id FROM items
       WHERE status = 2
         AND completed_at IS NOT NULL
         AND datetime(completed_at) <= datetime('now', '-' || ? || ' days')
     )`,
    [days]
  );

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
  pruneItemViews((db.exec('SELECT id FROM items')[0]?.values || []).map(([id]) => id));

  // Keep one backup per day (retention managed in app.js)
  if (typeof ensureDailyBackup === 'function') {
    ensureDailyBackup();
  }

  persist();

  // Restore last active section, or fall back to first
  const savedSection = parseInt(localStorage.getItem('dashora_active_section'));
  if (savedSection) {
    const exists = db.exec('SELECT id FROM sections WHERE id = ?', [savedSection]);
    if (exists.length && exists[0].values.length) {
      activeSectionId = savedSection;
    }
  }
  if (!activeSectionId) {
    const first = db.exec('SELECT id FROM sections ORDER BY prioritized DESC, CASE WHEN prioritized = 1 THEN sort_order END ASC, created_at DESC, id DESC LIMIT 1');
    if (first.length && first[0].values.length) {
      activeSectionId = first[0].values[0][0];
    }
  }

  renderSidebar();
  renderMain();
  refreshSharedItemBoards();

  // Check for due date notifications
  checkDueDateNotifications();

  // Periodically check for recurring resets and reminders (every 60s)
  setInterval(() => {
    if (typeof ensureDailyBackup === 'function') {
      ensureDailyBackup();
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const lastReset = localStorage.getItem('Dashora_last_reset');
    if (lastReset !== todayStr) {
      resetRecurringTasks();
      autoDeleteCompletedTasks();
      pruneItemViews((db.exec('SELECT id FROM items')[0]?.values || []).map(([id]) => id));
      persist();
      renderSidebar();
      renderMain();
    }
    checkDueDateNotifications();
  }, 60000);
}
