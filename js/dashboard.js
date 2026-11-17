/* Task dashboard: derived from current task records, without a separate history. */
let dashboardDays = 7;
let dashboardBoardId = '';
let dashboardBoardSearch = '';

function dashboardDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dashboardTimestamp(value) {
  if (!value) return null;
  // SQLite's default timestamps are UTC, without an explicit zone.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(' ', 'T') + 'Z' : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildDashboardStats(tasks, boards, days, boardId, now = new Date()) {
  const selectedBoards = boards.filter(board => boardId === '' || String(board.id) === String(boardId));
  const boardIds = new Set(selectedBoards.map(board => board.id));
  const selected = tasks.filter(task => boardIds.has(task.section_id));
  const daily = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    daily.push({ key: dashboardDateKey(date), count: 0 });
  }
  const dailyByKey = new Map(daily.map(day => [day.key, day]));
  const status = [0, 0, 0];
  const progress = selectedBoards.map(board => ({ ...board, total: 0, done: 0 }));
  const progressById = new Map(progress.map(board => [board.id, board]));
  let overdue = 0;
  let undatedDone = 0;
  for (const task of selected) {
    const state = task.status === 2 ? 2 : task.status === 1 ? 1 : 0;
    status[state]++;
    const board = progressById.get(task.section_id);
    board.total++;
    if (state === 2) {
      board.done++;
      const completed = dashboardTimestamp(task.completed_at);
      if (!completed) undatedDone++;
      if (completed && completed <= now) {
        const day = dailyByKey.get(dashboardDateKey(completed));
        if (day) day.count++;
      }
    } else if (task.due_date) {
      // Date-only deadlines remain actionable through the end of that local day.
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(task.due_date);
      const due = dashboardTimestamp(dateOnly ? task.due_date + 'T23:59:59.999' : task.due_date);
      if (due && due < now) overdue++;
    }
  }
  return {
    total: selected.length,
    status,
    active: status[0] + status[1],
    rate: selected.length ? Math.round(status[2] / selected.length * 100) : null,
    overdue,
    completed: daily.reduce((total, day) => total + day.count, 0),
    undatedDone,
    daily,
    progress,
  };
}

function selectDashboardTab() {
  activeView = 'dashboard';
  document.getElementById('searchBox').value = '';
  sectionSearchTerm = '';
  renderSidebar();
  renderMain();
  closeSidebar();
}

function updateDashboardFilters() {
  dashboardDays = Number(document.getElementById('dashboardDays').value);
  dashboardBoardId = document.getElementById('dashboardBoard').value;
  renderDashboard();
}

function filterDashboardBoards(value) {
  dashboardBoardSearch = value;
  renderDashboard();
  document.getElementById('dashboardBoardSearch').focus();
}

function readDashboardStats() {
  const now = new Date();
  const stats = buildDashboardStats([], [], dashboardDays, '', now);
  db.create_function('dashboard_day', value => {
    const date = dashboardTimestamp(value);
    return date && date <= now ? dashboardDateKey(date) : null;
  });
  db.create_function('dashboard_invalid_date', value => dashboardTimestamp(value) ? 0 : 1);
  db.create_function('dashboard_overdue', value => {
    if (!value) return 0;
    const due = dashboardTimestamp(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T23:59:59.999' : value);
    return due && due < now ? 1 : 0;
  });
  const where = `FROM items i JOIN sections s ON s.id = i.section_id
    WHERE COALESCE(s.type, 'task') = 'task' AND (? = '' OR s.id = ?)`;
  const params = [dashboardBoardId, dashboardBoardId];
  const [total, todo, progress, done, overdue, undated] = db.exec(`SELECT COUNT(*),
    COALESCE(SUM(CASE WHEN i.status NOT IN (1, 2) OR i.status IS NULL THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(i.status = 1), 0), COALESCE(SUM(i.status = 2), 0),
    COALESCE(SUM(CASE WHEN COALESCE(i.status, 0) != 2 THEN dashboard_overdue(i.due_date) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN i.status = 2 THEN dashboard_invalid_date(i.completed_at) ELSE 0 END), 0) ${where}`, params)[0].values[0];
  const daily = db.exec(`SELECT dashboard_day(i.completed_at), COUNT(*) ${where}
    AND i.status = 2 AND dashboard_day(i.completed_at) >= ? GROUP BY dashboard_day(i.completed_at)`,
  [...params, stats.daily[0].key]);
  for (const [key, count] of daily[0]?.values || []) {
    const day = stats.daily.find(day => day.key === key);
    if (day) day.count = count;
  }
  Object.assign(stats, { total, status: [todo, progress, done], overdue, undatedDone: undated,
    active: todo + progress, rate: total ? Math.round(done / total * 100) : null,
    completed: stats.daily.reduce((sum, day) => sum + day.count, 0) });
  const page = readListPage('dashboard-progress', `SELECT s.id, s.name,
    (SELECT COUNT(*) FROM items WHERE section_id = s.id),
    (SELECT COUNT(*) FROM items WHERE section_id = s.id AND status = 2)
    FROM sections s WHERE COALESCE(s.type, 'task') = 'task' AND (? = '' OR s.id = ?)
    ORDER BY s.name, s.id`, params);
  stats.progress = readListObjects(page, ['id', 'name', 'total', 'done']);
  return { stats, page };
}

function renderDashboard() {
  const options = readBoardOptions('dashboard-options', 'task', dashboardBoardSearch, dashboardBoardId);
  const boards = readListObjects({ rows: options.rows }, ['id', 'name']);
  if (dashboardBoardId && !boards.some(board => String(board.id) === dashboardBoardId)) dashboardBoardId = '';
  const { stats, page } = readDashboardStats();
  const maxDaily = Math.max(1, ...stats.daily.map(day => day.count));
  const dailySummary = stats.daily.map(day => `${day.key}: ${day.count}`).join(', ');
  const labels = ['To Do', 'In Progress', 'Done'];
  document.getElementById('mainHeader').innerHTML = `
    <div class="main-header-left">
      <button class="sidebar-toggle" type="button" aria-label="Open navigation menu" aria-controls="sidebar" aria-expanded="false" onclick="toggleSidebar()">&#9776;</button>
      <h2>Dashboard</h2>
    </div>`;
  document.getElementById('mainBody').innerHTML = `
    <div class="dashboard">
      <div class="dashboard-intro">
        <div><h3>Your progress, at a glance</h3><p>Small steps count. See what is done and what needs attention.</p></div>
        <div class="dashboard-filters">
          <div class="dashboard-board-filter">
            <label for="dashboardBoard">Task board</label>
            <input id="dashboardBoardSearch" class="search-box" type="search" aria-label="Search task boards"
              placeholder="Search task boards" value="${escAttr(dashboardBoardSearch)}" oninput="filterDashboardBoards(this.value)">
            <select id="dashboardBoard" class="form-select" onchange="updateDashboardFilters()">
              <option value="">All task boards</option>
              ${boards.map(board => `<option value="${board.id}" ${String(board.id) === dashboardBoardId ? 'selected' : ''}>${esc(board.name)}</option>`).join('')}
            </select>
            ${renderLoadMore(options.page, 'renderDashboard()')}
          </div>
          <label for="dashboardDays">Completion activity
            <select id="dashboardDays" class="form-select" onchange="updateDashboardFilters()">
              <option value="7" ${dashboardDays === 7 ? 'selected' : ''}>Last 7 days</option>
              <option value="30" ${dashboardDays === 30 ? 'selected' : ''}>Last 30 days</option>
            </select>
          </label>
        </div>
      </div>
      ${stats.total === 0 ? `<div class="dashboard-panel dashboard-empty"><h3>No tasks to measure yet</h3>
        <p>Add tasks to a task board, then move them to Done to see your progress here. Reference items are not counted.</p>
        <button class="btn btn-primary" onclick="${dashboardBoardId ? `selectSection(${Number(dashboardBoardId)})` : 'openSectionModal()'}">${dashboardBoardId ? 'Open board' : '+ New Board'}</button>
      </div>` : ''}
      <div class="dashboard-metrics">
        <div class="dashboard-panel"><h3>Completed</h3><strong>${stats.completed}</strong><p>In the last ${dashboardDays} days, including today</p></div>
        <div class="dashboard-panel"><h3>Completion rate</h3><strong>${stats.rate === null ? '&mdash;' : stats.rate + '%'}</strong><p>${stats.status[2]} of ${stats.total} current tasks are Done</p></div>
        <div class="dashboard-panel"><h3>Open tasks</h3><strong>${stats.active}</strong><p>${stats.status[1]} in progress &middot; ${stats.status[0]} to do</p></div>
        <div class="dashboard-panel"><h3>Overdue</h3><strong class="${stats.overdue ? 'dashboard-warning' : ''}">${stats.overdue}</strong><p>Open tasks past their due date</p></div>
      </div>
      <div class="dashboard-charts">
        <section class="dashboard-panel">
          <h3>Daily completions</h3><p>Last ${dashboardDays} days &middot; your local time</p>
          ${stats.completed === 0 ? '<p>No recorded completions in this period yet.</p>' : ''}
          <div class="dashboard-bars" role="img" aria-label="Daily completions: ${escAttr(dailySummary)}">
            ${stats.daily.map(day => `<div class="dashboard-bar-slot" title="${day.key}: ${day.count} completed">
              <div class="dashboard-bar" style="height:${day.count / maxDaily * 100}%"></div>
            </div>`).join('')}
          </div>
          <div class="dashboard-axis"><span>${stats.daily[0].key}</span><span>${stats.daily[stats.daily.length - 1].key}</span></div>
          <details class="dashboard-data"><summary>View daily counts</summary>
            <table><caption>Daily task completions</caption><thead><tr><th scope="col">Date</th><th scope="col">Completed</th></tr></thead>
              <tbody>${stats.daily.map(day => `<tr><th scope="row">${day.key}</th><td>${day.count}</td></tr>`).join('')}</tbody>
            </table>
          </details>
        </section>
        <section class="dashboard-panel">
          <h3>Task status</h3><p>Current tasks &middot; all dates</p>
          <div class="dashboard-status-bar" aria-hidden="true">${stats.status.map((count, index) =>
            `<span class="dashboard-status-${index}" style="width:${stats.total ? count / stats.total * 100 : 0}%"></span>`).join('')}</div>
          <ul class="dashboard-legend">${stats.status.map((count, index) =>
            `<li><span><i class="dashboard-status-${index}" aria-hidden="true"></i>${labels[index]}</span><strong>${count}</strong></li>`).join('')}</ul>
        </section>
      </div>
      <section class="dashboard-panel">
        <h3>Progress by board</h3><p>Share of current tasks marked Done &middot; all dates</p>
        ${stats.progress.length ? `<ul class="dashboard-board-list">${stats.progress.map(board => `<li>
          <div><button class="btn btn-ghost btn-sm" onclick="selectSection(${board.id})">${esc(board.name)}</button>
            <span>${board.done} / ${board.total} done${board.total ? ` (${Math.round(board.done / board.total * 100)}%)` : ''}</span></div>
          <progress value="${board.done}" max="${board.total || 1}" aria-label="${escAttr(board.name)} completion"></progress>
        </li>`).join('')}</ul>` : '<p>No task boards yet.</p>'}
        ${renderLoadMore(page, 'renderDashboard()')}
      </section>
      <p class="dashboard-note">Based on tasks currently stored, not a permanent activity history. Deleted tasks, reopened tasks, and earlier recurring completions are not retained.
        The date filter applies only to completion activity; other metrics show the current workload.
        ${stats.undatedDone ? `${stats.undatedDone} Done task(s) have no valid completion date and are excluded from daily counts.` : ''}
      </p>
    </div>`;
}
