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
    { sid: 1, title: 'Check all your ICMs and handle hanging tasks' },
    { sid: 1, title: 'Send comms email' },
    { sid: 1, title: 'Check all emails and handle them' },
    { sid: 1, title: 'Explore training opportunities' },
    { sid: 1, title: 'Dobby' },
    { sid: 1, title: 'Disable the limit adjustment eee agent' },

    // Regressions  (section 2)
    { sid: 2, title: 'Regression #1',
      link: 'https://teams.microsoft.com/l/message/19:848d42faeb96436994d004cc9334a7b1@thread.skype/1773944602456?tenantId=72f988bf-86f1-41af-91ab-2d7cd011db47&groupId=48dcdab4-70a0-46b2-a680-aa8e200a9126&parentMessageId=1773944602456&teamName=API%20Management&channelName=SLOOP&createdTime=1773944602456' },
    { sid: 2, title: 'Regression #2',
      link: 'https://teams.microsoft.com/l/message/19:848d42faeb96436994d004cc9334a7b1@thread.skype/1774373886643?tenantId=72f988bf-86f1-41af-91ab-2d7cd011db47&groupId=48dcdab4-70a0-46b2-a680-aa8e200a9126&parentMessageId=1774373886643&teamName=API%20Management&channelName=SLOOP&createdTime=1774373886643' },
    { sid: 2, title: 'Regression #3',
      link: 'https://teams.microsoft.com/l/message/19:848d42faeb96436994d004cc9334a7b1@thread.skype/1774652546402?tenantId=72f988bf-86f1-41af-91ab-2d7cd011db47&groupId=48dcdab4-70a0-46b2-a680-aa8e200a9126&parentMessageId=1774652546402&teamName=API%20Management&channelName=SLOOP&createdTime=1774652546402' },
    { sid: 2, title: 'Mitigate Managed Certificate issue in consumption SKUs',
      link: 'https://portal.microsofticm.com/imp/v5/incidents/details/51000000965683/summary' },

    // By Design Limitations  (section 3)
    { sid: 3, title: 'Capacity metric data point limitation',
      desc: 'This is a design limitation of the underlying platform. The most recent data point may contain invalid value since capacity is a derived metric from other metrics, and in some cases, other metrics are not available at computation time, which leads to incorrect values.\n\nFor classic tiers, discard the most recent 1-minute data point when reading raw Azure API Management capacity metrics because the derived value can be invalid if source data isn\'t available at aggregation time; do not base operational or scaling decisions on 1-minute values \u2014 for autoscaling use average aggregation windows of 30 minutes or longer.',
      link: 'https://portal.microsofticm.com/imp/v5/incidents/details/51000000964126/summary' },
    { sid: 3, title: 'Doc PR for capacity metric wording',
      desc: 'Doc PR: proposed wording for published doc regarding capacity metric limitation.',
      link: 'https://github.com/MicrosoftDocs/azure-docs-pr/pull/313823' },

    // Important Links  (section 4)
    { sid: 4, title: 'Cost Reduction Dashboard',
      link: 'https://msazure.visualstudio.com/One/_dashboards/dashboard/5c256c26-91f9-4661-9e43-0cd157f02052' },

    // Watch  (section 5)
    { sid: 5, title: 'Watch ICM #970929',
      link: 'https://portal.microsofticm.com/imp/v5/incidents/details/21000000970929/summary' },
    { sid: 5, title: 'Watch ICM #968998',
      link: 'https://portal.microsofticm.com/imp/v5/incidents/details/51000000968998/summary' },

    // Notes  (section 6)
    { sid: 6, title: 'Supportability items discussion',
      desc: 'We will discuss supportability items in the next meeting with Peter' },
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
