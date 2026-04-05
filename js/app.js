/* ================================================================
   FocusBoard – Application Logic
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
let doneCollapsed   = false;
let selectedColor   = COLORS[5];


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
    const active = db.exec('SELECT COUNT(*) FROM items WHERE section_id = ? AND completed = 0', [id])[0].values[0][0];
    const done   = db.exec('SELECT COUNT(*) FROM items WHERE section_id = ? AND completed = 1', [id])[0].values[0][0];
    const isActive  = id === activeSectionId ? 'active' : '';
    const countText = done > 0 ? `${active} / ${done} ✓` : `${active}`;

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
  const searchTerm = document.getElementById('searchBox').value.toLowerCase();

  // No section selected
  if (!activeSectionId) {
    header.innerHTML = `<div class="main-header-left">
      <button class="sidebar-toggle" onclick="toggleSidebar()">&#9776;</button>
    </div>`;
    body.innerHTML = `<div class="empty-state">
      <h3>Select a section</h3>
      <p>Pick a section from the sidebar or create a new one</p>
    </div>`;
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

  // Load items
  let itemsRes = db.exec('SELECT id, title, description, link, completed, recurring FROM items WHERE section_id = ? ORDER BY sort_order, id', [sid]);
  let rows = itemsRes.length ? itemsRes[0].values : [];

  if (searchTerm) {
    rows = rows.filter(r =>
      r[1].toLowerCase().includes(searchTerm) ||
      (r[2] && r[2].toLowerCase().includes(searchTerm))
    );
  }

  const activeRows = rows.filter(r => !r[4]);
  const doneRows   = rows.filter(r =>  r[4]);

  if (activeRows.length === 0 && doneRows.length === 0 && !searchTerm) {
    body.innerHTML = `
      <div class="empty-state">
        <h3>No items yet</h3>
        <p>Add your first item to this section</p>
        <button class="btn btn-primary" onclick="openItemModal(${sid})">+ Add Item</button>
      </div>`;
    return;
  }

  // Active items
  let html = '<div id="itemList">';
  for (const [iid, title, desc, link, completed, recurring] of activeRows) {
    html += renderItem(iid, title, desc, link, completed, recurring, expandedItems.has(iid), sid);
  }
  html += '</div>';

  if (!searchTerm) {
    html += `<div class="add-item-row" onclick="openItemModal(${sid})">+ Add Item</div>`;
  }

  // Done items
  if (doneRows.length > 0) {
    const arrowClass = doneCollapsed ? 'collapsed' : '';
    html += `
      <div class="done-divider" onclick="toggleDoneSection()">
        <div class="done-divider-line"></div>
        <div class="done-divider-label">
          <span class="done-divider-arrow ${arrowClass}">&#9660;</span>
          Done (${doneRows.length})
        </div>
        <div class="done-divider-line"></div>
      </div>`;

    if (!doneCollapsed) {
      html += '<div class="done-items">';
      for (const [iid, title, desc, link, completed, recurring] of doneRows) {
        html += renderItem(iid, title, desc, link, completed, recurring, expandedItems.has(iid), sid);
      }
      html += '</div>';
    }
  }

  body.innerHTML = html;
}


/* ── Single Item HTML ── */

function renderItem(iid, title, desc, link, completed, recurring, isExpanded, sid) {
  const completedCls = completed ? 'completed' : '';
  const checkedCls   = completed ? 'checked' : '';
  const expandedCls  = isExpanded ? 'expanded' : '';
  const hasLink = link ? '<span class="item-has-link">&#128279;</span>' : '';
  const hasDesc = desc ? '<span class="item-has-desc">&#128196;</span>' : '';
  const recurBadge = recurring ? '<span class="item-recurring" title="Recurring daily">&#128260;</span>' : '';

  let detail = '';
  if (isExpanded) {
    const recurBtn = recurring
      ? `<button class="btn btn-ghost btn-sm btn-recurring-active" onclick="toggleRecurring(event, ${iid})">&#128260; Recurring</button>`
      : `<button class="btn btn-ghost btn-sm" onclick="toggleRecurring(event, ${iid})">&#128260; Set Recurring</button>`;

    detail = `
      <div class="item-detail">
        ${desc
          ? `<div class="item-detail-desc">${esc(desc)}</div>`
          : '<div style="color:var(--text-muted);font-size:13px;margin-bottom:10px;">No description</div>'}
        ${link
          ? `<div class="item-detail-link">&#128279; <a href="${escAttr(link)}" target="_blank" rel="noopener">${esc(link)}</a></div>`
          : ''}
        <div class="item-detail-actions">
          <button class="btn btn-ghost btn-sm" onclick="openItemModal(${sid}, ${iid})">&#9998; Edit</button>
          ${recurBtn}
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteItem(${iid})">&#10005; Delete</button>
        </div>
      </div>`;
  }

  return `
    <div class="item ${completedCls} ${expandedCls}" data-item-id="${iid}"
         draggable="true"
         ondragstart="onItemDragStart(event, ${iid})"
         ondragover="onItemDragOver(event, ${iid})"
         ondragleave="onItemDragLeave(event)"
         ondrop="onItemDrop(event, ${iid})">
      <div class="item-row" onclick="toggleExpand(${iid})">
        <span class="item-drag" onmousedown="event.stopPropagation()">&#9776;</span>
        <div class="item-checkbox ${checkedCls}" onclick="toggleComplete(event, ${iid})">${completed ? '&#10003;' : ''}</div>
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


/* ================================================================
   Navigation
   ================================================================ */

function selectSection(id) {
  activeSectionId = id;
  expandedItems.clear();
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
           i.recurring, i.section_id, s.name, s.color
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

  for (const [iid, title, desc, link, completed, recurring, secId, secName, secColor] of rows) {
    if (secId !== currentSection) {
      currentSection = secId;
      html += `
        <div style="display:flex;align-items:center;gap:8px;margin:18px 0 8px;cursor:pointer;"
             onclick="selectSection(${secId})">
          <div style="width:10px;height:10px;border-radius:3px;background:${escAttr(secColor)}"></div>
          <span style="font-size:13px;font-weight:600;color:var(--text-muted)">${esc(secName)}</span>
        </div>`;
    }
    html += renderItem(iid, title, desc, link, completed, recurring, expandedItems.has(iid), secId);
  }

  body.innerHTML = html;
}


/* ================================================================
   Toggle Complete (mark done / restore)
   ================================================================ */

function toggleComplete(event, id) {
  event.stopPropagation();
  const row    = db.exec('SELECT completed FROM items WHERE id = ?', [id]);
  const newVal = row[0].values[0][0] ? 0 : 1;
  db.run('UPDATE items SET completed = ? WHERE id = ?', [newVal, id]);
  persist();

  if (newVal) {
    const el = document.querySelector(`[data-item-id="${id}"]`);
    if (el) {
      el.classList.add('completing');
      setTimeout(() => { renderMain(); renderSidebar(); }, 350);
    } else {
      renderMain(); renderSidebar();
    }
    toast('Moved to Done');
  } else {
    renderMain();
    renderSidebar();
    toast('Restored to active');
  }
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
        for (const row of data.sections[0].values)
          db.run('INSERT INTO sections (id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)', row);
      }
      if (data.items.length && data.items[0].values) {
        for (const row of data.items[0].values)
          db.run('INSERT INTO items (id, section_id, title, description, link, completed, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', row);
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
