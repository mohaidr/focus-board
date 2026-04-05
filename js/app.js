/* ================================================================
   Dashora – Application Logic
   Rendering, CRUD, drag-and-drop, search, export/import.
   ================================================================ */

const COLORS = [
  '#e05577', '#e0a055', '#d4c955', '#44cc88', '#55aadd',
  '#7c6ff7', '#cc66cc', '#ff8866', '#66ccbb', '#8899bb',
];

/* ── Global State ── */
let db              = null;   // set by initDB()
let activeSectionId = null;
let expandedItems   = new Set();
let dragItemId      = null;
let dragSectionId   = null;
let doneCollapsed      = false;
let inProgressCollapsed = false;
let selectedColor      = COLORS[5];
let sectionSearchTerm  = '';


/* ================================================================
   Helpers
   ================================================================ */

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escAttr(s) {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}


/* ================================================================
   Sidebar Rendering
   ================================================================ */

function renderSidebar() {
  const nav = document.getElementById('sidebarNav');
  const sections = db.exec('SELECT id, name, color FROM sections ORDER BY sort_order, id');

  if (!sections.length || !sections[0].values.length) {
    nav.innerHTML = '<div class="nav-label">No sections yet</div>';
    return;
  }

  let html = '<div class="nav-label">Sections</div>';

  for (const [id, name, color] of sections[0].values) {
    const todo   = db.exec('SELECT COUNT(*) FROM items WHERE section_id = ? AND status = 0', [id])[0].values[0][0];
    const inProg = db.exec('SELECT COUNT(*) FROM items WHERE section_id = ? AND status = 1', [id])[0].values[0][0];
    const done   = db.exec('SELECT COUNT(*) FROM items WHERE section_id = ? AND status = 2', [id])[0].values[0][0];
    const isActive  = id === activeSectionId ? 'active' : '';
    let countParts = [];
    if (todo) countParts.push(`${todo}`);
    if (inProg) countParts.push(`${inProg} ⏳`);
    if (done) countParts.push(`${done} ✓`);
    const countText = countParts.join(' / ') || '0';

    html += `
      <div class="nav-item ${isActive}" data-section-id="${id}"
           onclick="selectSection(${id})"
           draggable="true"
           ondragstart="onSectionDragStart(event, ${id})"
           ondragover="onSectionDragOver(event)"
           ondrop="onSectionDrop(event, ${id})">
        <span class="drag-handle">&#9776;</span>
        <div class="nav-dot" style="background:${escAttr(color)}"></div>
        <span class="nav-name">${esc(name)}</span>
        <button class="nav-edit" onclick="event.stopPropagation(); openSectionModal(${id})" title="Edit section">&#9998;</button>
        <span class="nav-count">${countText}</span>
      </div>`;
  }

  nav.innerHTML = html;
}


/* ================================================================
   Main Content Rendering
   ================================================================ */

function renderMain() {
  const header    = document.getElementById('mainHeader');
  const body      = document.getElementById('mainBody');
  const searchTerm = sectionSearchTerm;

  // No section selected
  if (!activeSectionId) {
    header.innerHTML = `<div class="main-header-left">
      <button class="sidebar-toggle" onclick="toggleSidebar()">&#9776;</button>
    </div>`;
    const hasSections = db.exec('SELECT COUNT(*) FROM sections')[0].values[0][0] > 0;
    if (hasSections) {
      body.innerHTML = `<div class="empty-state">
        <h3>Select a section</h3>
        <p>Pick a section from the sidebar</p>
      </div>`;
    } else {
      body.innerHTML = `<div class="empty-state">
        <h3>Welcome to Dashora</h3>
        <p>Create your first section to get started</p>
        <button class="btn btn-primary" onclick="openSectionModal()" style="margin-top:12px">+ New Section</button>
      </div>`;
    }
    return;
  }

  // Load section info
  const sec = db.exec('SELECT id, name, color FROM sections WHERE id = ?', [activeSectionId]);
  if (!sec.length || !sec[0].values.length) { activeSectionId = null; renderMain(); return; }
  const [sid, sname, scolor] = sec[0].values[0];
  const total = db.exec('SELECT COUNT(*) FROM items WHERE section_id = ?', [sid])[0].values[0][0];

  header.innerHTML = `
    <div class="main-header-left">
      <button class="sidebar-toggle" onclick="toggleSidebar()">&#9776;</button>
      <div class="section-color-big" style="background:${escAttr(scolor)}"></div>
      <h2>${esc(sname)}</h2>
      <span class="item-total">${total} item${total !== 1 ? 's' : ''}</span>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-ghost btn-sm" onclick="openSectionModal(${sid})">&#9998; Edit</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteSection(${sid})">&#10005; Delete</button>
    </div>`;

  // Section search bar
  const searchVal = escAttr(sectionSearchTerm);

  // Load items (now including status column)
  let itemsRes = db.exec('SELECT id, title, description, link, completed, recurring, status FROM items WHERE section_id = ? ORDER BY sort_order, id', [sid]);
  let rows = itemsRes.length ? itemsRes[0].values : [];

  if (searchTerm) {
    rows = rows.filter(r =>
      r[1].toLowerCase().includes(searchTerm) ||
      (r[2] && r[2].toLowerCase().includes(searchTerm))
    );
  }

  const todoRows   = rows.filter(r => (r[6] || 0) === 0);
  const ipRows     = rows.filter(r => (r[6] || 0) === 1);
  const doneRows   = rows.filter(r => (r[6] || 0) === 2);

  if (todoRows.length === 0 && ipRows.length === 0 && doneRows.length === 0 && !searchTerm) {
    body.innerHTML = `
      <div class="empty-state">
        <h3>No items yet</h3>
        <p>Add your first item to this section</p>
        <button class="btn btn-primary" onclick="openItemModal(${sid})">+ Add Item</button>
      </div>`;
    return;
  }

  // Search bar
  let html = `<div class="section-search-wrap">
    <input type="text" class="section-search" placeholder="Filter items… (type to search)"
           id="sectionSearchBox" value="${searchVal}" oninput="onSectionSearch(this.value)">
    ${searchTerm ? '<button class="section-search-clear" onclick="clearSectionSearch()">&#10005;</button>' : ''}
  </div>`;

  // To Do items
  html += `<div class="status-group-header status-todo">📋 To Do (${todoRows.length})</div>`;
  html += '<div id="itemList">';
  for (const [iid, title, desc, link, completed, recurring, status] of todoRows) {
    html += renderItem(iid, title, desc, link, completed, recurring, status, expandedItems.has(iid), sid);
  }
  html += '</div>';

  if (!searchTerm) {
    html += `<div class="add-item-row" onclick="openItemModal(${sid})">+ Add Item</div>`;
  }

  // In Progress items
  if (ipRows.length > 0 || !searchTerm) {
    const ipArrow = inProgressCollapsed ? 'collapsed' : '';
    html += `
      <div class="status-divider status-ip-divider" onclick="toggleInProgressSection()">
        <div class="status-divider-line"></div>
        <div class="status-divider-label">
          <span class="status-divider-arrow ${ipArrow}">&#9660;</span>
          ⏳ In Progress (${ipRows.length})
        </div>
        <div class="status-divider-line"></div>
      </div>`;
    if (!inProgressCollapsed) {
      html += '<div class="ip-items">';
      for (const [iid, title, desc, link, completed, recurring, status] of ipRows) {
        html += renderItem(iid, title, desc, link, completed, recurring, status, expandedItems.has(iid), sid);
      }
      html += '</div>';
    }
  }

  // Done items
  if (doneRows.length > 0 || !searchTerm) {
    const arrowClass = doneCollapsed ? 'collapsed' : '';
    html += `
      <div class="status-divider status-done-divider" onclick="toggleDoneSection()">
        <div class="status-divider-line"></div>
        <div class="status-divider-label">
          <span class="status-divider-arrow ${arrowClass}">&#9660;</span>
          ✅ Done (${doneRows.length})
        </div>
        <div class="status-divider-line"></div>
      </div>`;

    if (!doneCollapsed) {
      html += '<div class="done-items">';
      for (const [iid, title, desc, link, completed, recurring, status] of doneRows) {
        html += renderItem(iid, title, desc, link, completed, recurring, status, expandedItems.has(iid), sid);
      }
      html += '</div>';
    }
  }

  body.innerHTML = html;
}


/* ── Single Item HTML ── */

function renderItem(iid, title, desc, link, completed, recurring, status, isExpanded, sid) {
  const st = status || 0; // 0=todo, 1=in-progress, 2=done
  const statusCls  = st === 2 ? 'status-done' : st === 1 ? 'status-ip' : 'status-todo';
  const expandedCls  = isExpanded ? 'expanded' : '';
  const hasLink = link ? '<span class="item-has-link">&#128279;</span>' : '';
  const hasDesc = desc ? '<span class="item-has-desc">&#128196;</span>' : '';
  const recurBadge = recurring ? '<span class="item-recurring" title="Recurring daily">&#128260;</span>' : '';

  // Checkbox appearance based on status
  let checkboxCls = '';
  let checkboxContent = '';
  if (st === 1) { checkboxCls = 'in-progress'; checkboxContent = '&#9654;'; }
  else if (st === 2) { checkboxCls = 'checked'; checkboxContent = '&#10003;'; }

  let detail = '';
  if (isExpanded) {
    const recurBtn = recurring
      ? `<button class="btn btn-ghost btn-sm btn-recurring-active" onclick="toggleRecurring(event, ${iid})">&#128260; Recurring</button>`
      : `<button class="btn btn-ghost btn-sm" onclick="toggleRecurring(event, ${iid})">&#128260; Set Recurring</button>`;

    // Status buttons
    const statusBtns = `
      <div class="item-status-btns">
        <button class="btn btn-ghost btn-sm ${st === 0 ? 'btn-status-active' : ''}" onclick="setStatus(event, ${iid}, 0)">📋 To Do</button>
        <button class="btn btn-ghost btn-sm ${st === 1 ? 'btn-status-active btn-status-ip' : ''}" onclick="setStatus(event, ${iid}, 1)">⏳ In Progress</button>
        <button class="btn btn-ghost btn-sm ${st === 2 ? 'btn-status-active btn-status-done' : ''}" onclick="setStatus(event, ${iid}, 2)">✅ Done</button>
      </div>`;

    detail = `
      <div class="item-detail">
        ${desc
          ? `<div class="item-detail-desc">${esc(desc)}</div>`
          : '<div style="color:var(--text-muted);font-size:13px;margin-bottom:10px;">No description</div>'}
        ${link
          ? `<div class="item-detail-link">&#128279; <a href="${escAttr(link)}" target="_blank" rel="noopener">${esc(link)}</a></div>`
          : ''}
        <div class="item-detail-toolbar">
          <div class="item-status-btns">
            <button class="btn btn-ghost btn-sm ${st === 0 ? 'btn-status-active' : ''}" onclick="setStatus(event, ${iid}, 0)">\ud83d\udccb To Do</button>
            <button class="btn btn-ghost btn-sm ${st === 1 ? 'btn-status-active btn-status-ip' : ''}" onclick="setStatus(event, ${iid}, 1)">\u23f3 In Progress</button>
            <button class="btn btn-ghost btn-sm ${st === 2 ? 'btn-status-active btn-status-done' : ''}" onclick="setStatus(event, ${iid}, 2)">\u2705 Done</button>
          </div>
          <div class="item-detail-actions">
            <button class="btn btn-ghost btn-sm" onclick="openItemModal(${sid}, ${iid})">&#9998; Edit</button>
            ${recurBtn}
            <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteItem(${iid})">&#10005; Delete</button>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="item ${statusCls} ${expandedCls}" data-item-id="${iid}"
         draggable="true"
         ondragstart="onItemDragStart(event, ${iid})"
         ondragover="onItemDragOver(event, ${iid})"
         ondragleave="onItemDragLeave(event)"
         ondrop="onItemDrop(event, ${iid})">
      <div class="item-row" onclick="toggleExpand(${iid})">
        <span class="item-drag" onmousedown="event.stopPropagation()">&#9776;</span>
        <div class="item-checkbox ${checkboxCls}" onclick="toggleComplete(event, ${iid})">${checkboxContent}</div>
        <span class="item-title-text">${esc(title)}</span>
        <div class="item-indicators">${recurBadge}${hasDesc}${hasLink}</div>
        <span class="expand-arrow">&#9654;</span>
      </div>
      ${detail}
    </div>`;
}


/* ================================================================
   Expand / Collapse
   ================================================================ */

function toggleExpand(iid) {
  expandedItems.has(iid) ? expandedItems.delete(iid) : expandedItems.add(iid);
  renderMain();
}

function toggleDoneSection() {
  doneCollapsed = !doneCollapsed;
  renderMain();
}

function toggleInProgressSection() {
  inProgressCollapsed = !inProgressCollapsed;
  renderMain();
}


/* ================================================================
   Navigation
   ================================================================ */

function selectSection(id) {
  activeSectionId = id;
  expandedItems.clear();
  sectionSearchTerm = '';
  renderSidebar();
  renderMain();
  document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}


/* ================================================================
   Drag & Drop – Items
   ================================================================ */

function onItemDragStart(e, iid) {
  dragItemId = iid;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', iid);
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-item-id="${iid}"]`);
    if (el) el.classList.add('dragging');
  });
}

function onItemDragOver(e, targetId) {
  e.preventDefault();
  if (dragItemId === targetId) return;
  document.querySelectorAll('.item').forEach(el => el.style.borderTop = '');
  const el = document.querySelector(`[data-item-id="${targetId}"]`);
  if (el) el.style.borderTop = '3px solid var(--accent)';
}

function onItemDragLeave(e) {
  e.currentTarget.style.borderTop = '';
}

function onItemDrop(e, targetId) {
  e.preventDefault();
  document.querySelectorAll('.item').forEach(el => {
    el.classList.remove('dragging');
    el.style.borderTop = '';
  });

  if (dragItemId === targetId || !dragItemId) return;

  const itemsRes = db.exec('SELECT id FROM items WHERE section_id = ? ORDER BY sort_order, id', [activeSectionId]);
  if (!itemsRes.length) return;

  let ids = itemsRes[0].values.map(r => r[0]);
  ids = ids.filter(id => id !== dragItemId);
  const targetIdx = ids.indexOf(targetId);
  ids.splice(targetIdx, 0, dragItemId);

  ids.forEach((id, i) => db.run('UPDATE items SET sort_order = ? WHERE id = ?', [i, id]));

  persist();
  dragItemId = null;
  renderMain();
  toast('Item moved');
}


/* ================================================================
   Drag & Drop – Sections
   ================================================================ */

function onSectionDragStart(e, sid) {
  dragSectionId = sid;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', sid);
}

function onSectionDragOver(e) { e.preventDefault(); }

function onSectionDrop(e, targetSid) {
  e.preventDefault();
  if (!dragSectionId || dragSectionId === targetSid) return;

  const secRes = db.exec('SELECT id FROM sections ORDER BY sort_order, id');
  if (!secRes.length) return;

  let ids = secRes[0].values.map(r => r[0]);
  ids = ids.filter(id => id !== dragSectionId);
  const targetIdx = ids.indexOf(targetSid);
  ids.splice(targetIdx, 0, dragSectionId);

  ids.forEach((id, i) => db.run('UPDATE sections SET sort_order = ? WHERE id = ?', [i, id]));

  dragSectionId = null;
  persist();
  renderSidebar();
  toast('Section moved');
}


/* ================================================================
   Search
   ================================================================ */

function onSectionSearch(val) {
  sectionSearchTerm = val.toLowerCase();
  renderMain();
  // Restore focus & cursor position
  const el = document.getElementById('sectionSearchBox');
  if (el) { el.focus(); el.selectionStart = el.selectionEnd = val.length; }
}

function clearSectionSearch() {
  sectionSearchTerm = '';
  renderMain();
}

function onSearch() {
  const term = document.getElementById('searchBox').value.toLowerCase();
  if (term.length > 0) {
    renderSearchResults(term);
  } else {
    renderSidebar();
    renderMain();
  }
}

function renderSearchResults(term) {
  const body   = document.getElementById('mainBody');
  const header = document.getElementById('mainHeader');

  const res = db.exec(`
    SELECT i.id, i.title, i.description, i.link, i.completed,
           i.recurring, i.section_id, s.name, s.color, i.status
    FROM items i
    JOIN sections s ON i.section_id = s.id
    WHERE LOWER(i.title) LIKE '%' || ? || '%'
       OR LOWER(i.description) LIKE '%' || ? || '%'
    ORDER BY s.sort_order, i.sort_order
  `, [term, term]);

  const rows = res.length ? res[0].values : [];

  header.innerHTML = `
    <div class="main-header-left">
      <button class="sidebar-toggle" onclick="toggleSidebar()">&#9776;</button>
      <h2>Search Results</h2>
      <span class="item-total">${rows.length} match${rows.length !== 1 ? 'es' : ''}</span>
    </div>`;

  if (rows.length === 0) {
    body.innerHTML = '<div class="empty-state"><h3>No matches</h3><p>Try different keywords</p></div>';
    return;
  }

  let html = '';
  let currentSection = null;

  for (const [iid, title, desc, link, completed, recurring, secId, secName, secColor, status] of rows) {
    if (secId !== currentSection) {
      currentSection = secId;
      html += `
        <div style="display:flex;align-items:center;gap:8px;margin:18px 0 8px;cursor:pointer;"
             onclick="selectSection(${secId})">
          <div style="width:10px;height:10px;border-radius:3px;background:${escAttr(secColor)}"></div>
          <span style="font-size:13px;font-weight:600;color:var(--text-muted)">${esc(secName)}</span>
        </div>`;
    }
    html += renderItem(iid, title, desc, link, completed, recurring, status || 0, expandedItems.has(iid), secId);
  }

  body.innerHTML = html;
}


/* ================================================================
   Toggle Complete (mark done / restore)
   ================================================================ */

function toggleComplete(event, id) {
  event.stopPropagation();
  const row = db.exec('SELECT status FROM items WHERE id = ?', [id]);
  const cur = row[0].values[0][0] || 0;
  // Cycle: 0 (todo) → 1 (in-progress) → 2 (done) → 0
  const next = (cur + 1) % 3;
  const completed = next === 2 ? 1 : 0;
  const completedAt = next === 2 ? new Date().toISOString() : null;
  db.run('UPDATE items SET status = ?, completed = ?, completed_at = ? WHERE id = ?', [next, completed, completedAt, id]);
  persist();

  const labels = ['To Do', 'In Progress', 'Done'];
  if (next === 2) {
    const el = document.querySelector(`[data-item-id="${id}"]`);
    if (el) {
      el.classList.add('completing');
      setTimeout(() => { renderMain(); renderSidebar(); }, 350);
    } else {
      renderMain(); renderSidebar();
    }
  } else {
    renderMain(); renderSidebar();
  }
  toast(`Moved to ${labels[next]}`);
}

function setStatus(event, id, status) {
  event.stopPropagation();
  const completed = status === 2 ? 1 : 0;
  const completedAt = status === 2 ? new Date().toISOString() : null;
  db.run('UPDATE items SET status = ?, completed = ?, completed_at = ? WHERE id = ?', [status, completed, completedAt, id]);
  persist();
  renderMain();
  renderSidebar();
  const labels = ['To Do', 'In Progress', 'Done'];
  toast(`Moved to ${labels[status]}`);
}

function toggleRecurring(event, id) {
  event.stopPropagation();
  const row = db.exec('SELECT recurring FROM items WHERE id = ?', [id]);
  const newVal = row[0].values[0][0] ? 0 : 1;
  db.run('UPDATE items SET recurring = ? WHERE id = ?', [newVal, id]);
  persist();
  renderMain();
  toast(newVal ? 'Set as recurring' : 'No longer recurring');
}


/* ================================================================
   Section CRUD
   ================================================================ */

function openSectionModal(editId) {
  const modal     = document.getElementById('sectionModal');
  const titleEl   = document.getElementById('sectionModalTitle');
  const nameInput = document.getElementById('sectionName');
  const editInput = document.getElementById('editSectionId');

  if (editId) {
    titleEl.textContent = 'Edit Section';
    const row = db.exec('SELECT name, color FROM sections WHERE id = ?', [editId]);
    if (row.length) {
      nameInput.value = row[0].values[0][0];
      selectedColor   = row[0].values[0][1];
    }
    editInput.value = editId;
  } else {
    titleEl.textContent = 'New Section';
    nameInput.value = '';
    selectedColor   = COLORS[Math.floor(Math.random() * COLORS.length)];
    editInput.value = '';
  }

  renderColors();
  modal.classList.add('active');
  nameInput.focus();
}

function renderColors() {
  document.getElementById('colorOptions').innerHTML = COLORS.map(c =>
    `<div class="color-option ${c === selectedColor ? 'selected' : ''}"
          style="background:${c}" onclick="pickColor('${c}')"></div>`
  ).join('');
}

function pickColor(c) { selectedColor = c; renderColors(); }

function saveSection() {
  const name   = document.getElementById('sectionName').value.trim();
  const editId = document.getElementById('editSectionId').value;
  if (!name) { toast('Section name is required'); return; }

  if (editId) {
    db.run('UPDATE sections SET name = ?, color = ? WHERE id = ?', [name, selectedColor, parseInt(editId)]);
  } else {
    const maxOrder = db.exec('SELECT COALESCE(MAX(sort_order), 0) FROM sections');
    db.run('INSERT INTO sections (name, color, sort_order) VALUES (?, ?, ?)',
      [name, selectedColor, maxOrder[0].values[0][0] + 1]);
    activeSectionId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  }

  persist();
  closeModal('sectionModal');
  renderSidebar();
  renderMain();
  toast(editId ? 'Section updated' : 'Section created');
}

function deleteSection(id) {
  if (!confirm('Delete this section and all its items?')) return;
  db.run('DELETE FROM items WHERE section_id = ?', [id]);
  db.run('DELETE FROM sections WHERE id = ?', [id]);

  if (activeSectionId === id) {
    const first = db.exec('SELECT id FROM sections ORDER BY sort_order, id LIMIT 1');
    activeSectionId = (first.length && first[0].values.length) ? first[0].values[0][0] : null;
  }

  persist();
  renderSidebar();
  renderMain();
  toast('Section deleted');
}


/* ================================================================
   Item CRUD
   ================================================================ */

function openItemModal(sectionId, editId) {
  const modal      = document.getElementById('itemModal');
  const titleEl    = document.getElementById('itemModalTitle');
  const titleInput = document.getElementById('itemTitle');
  const descInput  = document.getElementById('itemDesc');
  const linkInput  = document.getElementById('itemLink');
  const editInput  = document.getElementById('editItemId');
  const secInput   = document.getElementById('itemSectionId');
  secInput.value   = sectionId;

  if (editId) {
    titleEl.textContent = 'Edit Item';
    const row = db.exec('SELECT title, description, link, recurring FROM items WHERE id = ?', [editId]);
    if (row.length) {
      titleInput.value = row[0].values[0][0] || '';
      descInput.value  = row[0].values[0][1] || '';
      linkInput.value  = row[0].values[0][2] || '';
      document.getElementById('itemRecurring').checked = !!row[0].values[0][3];
    }
    editInput.value = editId;
  } else {
    titleEl.textContent = 'New Item';
    titleInput.value = '';
    descInput.value  = '';
    linkInput.value  = '';
    editInput.value  = '';
    document.getElementById('itemRecurring').checked = false;
  }

  modal.classList.add('active');
  titleInput.focus();
}

function saveItem() {
  const title     = document.getElementById('itemTitle').value.trim();
  const desc      = document.getElementById('itemDesc').value.trim();
  const link      = document.getElementById('itemLink').value.trim();
  const recurring = document.getElementById('itemRecurring').checked ? 1 : 0;
  const editId    = document.getElementById('editItemId').value;
  const sectionId = parseInt(document.getElementById('itemSectionId').value);

  if (!title) { toast('Title is required'); return; }
  if (link && !link.match(/^https?:\/\/.+/i)) {
    toast('Link must start with http:// or https://');
    return;
  }

  if (editId) {
    db.run('UPDATE items SET title = ?, description = ?, link = ?, recurring = ? WHERE id = ?',
      [title, desc, link, recurring, parseInt(editId)]);
  } else {
    const maxOrder = db.exec('SELECT COALESCE(MAX(sort_order), 0) FROM items WHERE section_id = ?', [sectionId]);
    db.run('INSERT INTO items (section_id, title, description, link, recurring, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [sectionId, title, desc, link, recurring, maxOrder[0].values[0][0] + 1]);
  }

  persist();
  closeModal('itemModal');
  renderSidebar();
  renderMain();
  toast(editId ? 'Item updated' : 'Item added');
}

function deleteItem(id) {
  if (!confirm('Delete this item?')) return;
  expandedItems.delete(id);
  db.run('DELETE FROM items WHERE id = ?', [id]);
  persist();
  renderSidebar();
  renderMain();
  toast('Item deleted');
}


/* ================================================================
   Modals
   ================================================================ */

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}


/* ================================================================
   Export / Import
   ================================================================ */

function exportData() {
  const sections = db.exec('SELECT * FROM sections ORDER BY sort_order, id');
  const items    = db.exec('SELECT * FROM items ORDER BY section_id, sort_order, id');

  const blob = new Blob(
    [JSON.stringify({ sections, items, exported: new Date().toISOString() }, null, 2)],
    { type: 'application/json' }
  );

  const a  = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `stickyhub-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Data exported');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.sections || !data.items) throw new Error('Invalid format');
      if (!confirm('This will replace ALL current data. Continue?')) return;

      db.run('DELETE FROM items');
      db.run('DELETE FROM sections');

      if (data.sections.length && data.sections[0].values) {
        const cols = data.sections[0].columns
          ? data.sections[0].columns.join(', ')
          : 'id, name, color, sort_order, created_at';
        const ph = data.sections[0].columns
          ? data.sections[0].columns.map(() => '?').join(', ')
          : '?, ?, ?, ?, ?';
        for (const row of data.sections[0].values)
          db.run(`INSERT INTO sections (${cols}) VALUES (${ph})`, row);
      }
      if (data.items.length && data.items[0].values) {
        const cols = data.items[0].columns
          ? data.items[0].columns.join(', ')
          : 'id, section_id, title, description, link, completed, sort_order, created_at';
        const ph = data.items[0].columns
          ? data.items[0].columns.map(() => '?').join(', ')
          : '?, ?, ?, ?, ?, ?, ?, ?';
        for (const row of data.items[0].values)
          db.run(`INSERT INTO items (${cols}) VALUES (${ph})`, row);
      }

      const first = db.exec('SELECT id FROM sections ORDER BY sort_order, id LIMIT 1');
      activeSectionId = (first.length && first[0].values.length) ? first[0].values[0][0] : null;

      persist();
      renderSidebar();
      renderMain();
      toast('Data imported');
    } catch (err) {
      toast('Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}


/* ================================================================
   Settings
   ================================================================ */

function openSettingsModal() {
  const enabled = localStorage.getItem('dashora_autodelete_enabled') === 'true';
  const days = localStorage.getItem('dashora_autodelete_days') || '7';

  document.getElementById('autoDeleteEnabled').checked = enabled;
  document.getElementById('autoDeleteDays').value = days;
  document.getElementById('autoDeleteDelayGroup').style.display = enabled ? '' : 'none';

  // Toggle visibility when checkbox changes
  document.getElementById('autoDeleteEnabled').onchange = function () {
    document.getElementById('autoDeleteDelayGroup').style.display = this.checked ? '' : 'none';
  };

  document.getElementById('settingsModal').classList.add('active');
}

function saveSettings() {
  const enabled = document.getElementById('autoDeleteEnabled').checked;
  const days = document.getElementById('autoDeleteDays').value;

  localStorage.setItem('dashora_autodelete_enabled', enabled ? 'true' : 'false');
  localStorage.setItem('dashora_autodelete_days', days);

  closeModal('settingsModal');
  toast(enabled ? `Auto-delete: after ${days} day${days !== '1' ? 's' : ''}` : 'Auto-delete disabled');
}


/* ================================================================
   Global Event Listeners
   ================================================================ */

// Close modals on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('active');
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  }
  if (e.ctrlKey && e.key === 'k') {
    e.preventDefault();
    document.getElementById('searchBox').focus();
  }
});

// Clean up drag state
document.addEventListener('dragend', () => {
  document.querySelectorAll('.item').forEach(el => {
    el.classList.remove('dragging');
    el.style.borderTop = '';
  });
  dragItemId    = null;
  dragSectionId = null;
});


/* ================================================================
   Boot
   ================================================================ */

initDB();
