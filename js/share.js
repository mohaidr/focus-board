const SHARED_ITEM_VERSION = 1;
const SHARE_URL_WARNING_BYTES = 2048;
let sharedItemContent = null;
let sharedItemSaving = false;

function validateSharedItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('Invalid shared item');
  }
  for (const field of ['title', 'description', 'link']) {
    if (typeof item[field] !== 'string') throw new Error('Invalid shared item text');
  }
  if (!item.title.trim()) throw new Error('Shared item title is required');
  if (!['plain', 'markdown'].includes(item.descriptionFormat)) throw new Error('Unsupported description format');
  if (!['task', 'reference'].includes(item.boardType)) throw new Error('Unsupported board type');
  if (![0, 1, 2].includes(item.status)) throw new Error('Invalid task status');
  if (![0, 1, 2, 3, 4, 5].includes(item.recurring)) throw new Error('Invalid recurring schedule');
  if (item.link && !['http:', 'https:'].includes(new URL(item.link).protocol)) {
    throw new Error('Item links must use http:// or https://');
  }
  if (item.dueDate !== null && (typeof item.dueDate !== 'string' || !item.dueDate || !Number.isFinite(new Date(item.dueDate).getTime()))) {
    throw new Error('Invalid due date');
  }
  if (item.recurringDays !== null && (typeof item.recurringDays !== 'string' || !/^[0-6](,[0-6])*$/.test(item.recurringDays))) {
    throw new Error('Invalid recurring days');
  }
  if (item.recurringTime !== null && (typeof item.recurringTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(item.recurringTime))) {
    throw new Error('Invalid recurring time');
  }
  if (item.sketchData !== null && (typeof item.sketchData !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(item.sketchData))) {
    throw new Error('Unsupported sketch data');
  }
  if (!Array.isArray(item.followups) || item.followups.some(followup =>
    !followup || typeof followup !== 'object' || typeof followup.text !== 'string' || typeof followup.completed !== 'boolean'
  )) {
    throw new Error('Invalid follow-ups');
  }
  return {
    title: item.title,
    description: item.description,
    descriptionFormat: item.descriptionFormat,
    link: item.link,
    boardType: item.boardType,
    status: item.status,
    dueDate: item.dueDate,
    recurring: item.recurring,
    recurringDays: item.recurringDays,
    recurringTime: item.recurringTime,
    sketchData: item.sketchData,
    followups: item.followups.map(followup => ({ text: followup.text, completed: followup.completed })),
  };
}

function encodeItemShareUrl(item, baseUrl = window.location.href) {
  const payload = JSON.stringify({ version: SHARED_ITEM_VERSION, item: validateSharedItem(item) });
  const encoded = bytesToBase64(new TextEncoder().encode(payload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = new URL(baseUrl);
  url.hash = 'share=' + encoded;
  return url.href;
}

function decodeItemShareUrl(url = window.location.href) {
  const params = new URLSearchParams(new URL(url).hash.slice(1));
  if (!params.has('share')) return null;
  const encoded = params.get('share');
  if (params.getAll('share').length !== 1 || !encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error('Invalid shared item encoding');
  }
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4);
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(base64)));
  if (!payload || payload.version !== SHARED_ITEM_VERSION) throw new Error('Unsupported shared item version');
  return validateSharedItem(payload.item);
}

function warnIfShareUrlTooLong(url) {
  const bytes = new TextEncoder().encode(url).byteLength;
  if (bytes > SHARE_URL_WARNING_BYTES) {
    window.alert(`This URL is ${bytes.toLocaleString()} bytes long. URLs over 2,048 bytes might be too long to work in some browsers or apps. The full link is still available to copy.`);
  }
  return bytes;
}

function getItemShareContent(id) {
  const protection = getItemProtection(id);
  if (!protection) throw new Error('Item not found');
  if (protection.isProtected && isItemLocked(id, 1)) throw new Error('Unlock this item before sharing');
  const decrypted = protection.isEncrypted ? decryptedProtectedItems.get(id) : null;
  if (protection.isEncrypted && !decrypted) throw new Error('Unlock this item before sharing');
  const result = db.exec(`
    SELECT i.title, i.description, i.description_format, i.link, i.sketch_data,
           i.status, i.due_date, i.recurring, i.recurring_days, i.recurring_time, s.type
    FROM items i JOIN sections s ON s.id = i.section_id WHERE i.id = ?`, [id]);
  if (!result.length) throw new Error('Item not found');
  const [title, description, descriptionFormat, link, sketchData, status, dueDate,
    recurring, recurringDays, recurringTime, boardType] = result[0].values[0];
  const followups = db.exec('SELECT text, completed FROM followups WHERE item_id = ? ORDER BY sort_order, id', [id]);
  return validateSharedItem({
    title: decrypted ? decrypted.title : title,
    description: (decrypted ? decrypted.description : description) || '',
    descriptionFormat,
    link: (decrypted ? decrypted.link : link) || '',
    sketchData: (decrypted ? decrypted.sketchData : sketchData) || null,
    status: status || 0,
    dueDate: dueDate || null,
    recurring: recurring || 0,
    recurringDays: recurringDays || null,
    recurringTime: recurringTime || null,
    boardType,
    followups: followups.length ? followups[0].values.map(([text, completed]) => ({ text, completed: completed === 1 })) : [],
  });
}

function shareItem(event, id) {
  if (event) event.stopPropagation();
  closeShareModal();
  const protection = getItemProtection(id);
  if (!protection) { toast('Item not found'); return; }
  if (protection.isProtected && (isItemLocked(id, 1) || (protection.isEncrypted && !decryptedProtectedItems.has(id)))) {
    requestItemUnlock(id, 'share');
    return;
  }
  if (protection.isProtected && !confirm('This link contains an unprotected copy of the item. Anyone with the URL can read it, even if the original is password-protected or encrypted. Continue?')) return;
  let url;
  try {
    url = encodeItemShareUrl(getItemShareContent(id));
  } catch (error) {
    console.error('Could not share item', error);
    toast('Could not share item: ' + error.message);
    return;
  }
  const input = document.getElementById('itemShareUrl');
  input.value = url;
  document.getElementById('itemShareUrlLength').textContent = `${new TextEncoder().encode(url).byteLength.toLocaleString()} bytes`;
  document.getElementById('shareItemModal').classList.add('active');
  warnIfShareUrlTooLong(url);
  input.focus();
  input.select();
}

function copyItemShareUrl() {
  const url = document.getElementById('itemShareUrl').value;
  if (!url) { toast('No share link available'); return; }
  copyItemText(url);
}

function closeShareModal() {
  document.getElementById('itemShareUrl').value = '';
  document.getElementById('itemShareUrlLength').textContent = '';
  closeModal('shareItemModal');
}

function renderSharedItemContent(item) {
  const metadata = [item.boardType === 'task' ? 'Task item' : 'Reference item'];
  if (item.boardType === 'task') metadata.push(['To Do', 'In Progress', 'Done'][item.status]);
  if (item.dueDate) metadata.push('Due: ' + formatDueDate(item.dueDate));
  if (item.recurring) {
    let schedule = RECURRENCE_LABELS[item.recurring];
    if (item.recurring === 5 && item.recurringDays) {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      schedule += ': ' + item.recurringDays.split(',').map(day => days[Number(day)]).join(', ');
    }
    metadata.push(schedule);
  }
  if (item.recurringTime) metadata.push('Reminder: ' + formatRecurringTime(item.recurringTime));
  const followups = item.followups.length
    ? `<div class="shared-followups"><h3>Follow-ups</h3>${item.followups.map(followup =>
      `<label><input type="checkbox" disabled${followup.completed ? ' checked' : ''}><span>${esc(followup.text)}</span></label>`
    ).join('')}</div>`
    : '';
  return `
    <div class="shared-item-meta">${metadata.map(text => `<span>${esc(text)}</span>`).join('')}</div>
    ${item.description ? renderDescription(item.description, item.descriptionFormat) : ''}
    ${item.link ? `<div class="item-detail-link"><a href="${escAttr(item.link)}" target="_blank" rel="noopener noreferrer">${esc(item.link)}</a></div>` : ''}
    ${item.sketchData ? `<div class="sketch-preview-large"><img src="${escAttr(item.sketchData)}" alt="Shared sketch"></div>` : ''}
    ${followups}`;
}

function openSharedItemFromUrl() {
  closeShareModal();
  document.getElementById('sharedItemContent').replaceChildren();
  document.getElementById('sharedItemError').textContent = '';
  document.getElementById('sharedItemSaveError').textContent = '';
  document.getElementById('sharedItemBoard').value = '';
  document.getElementById('sharedItemBoardName').value = 'Shared items';
  sharedItemContent = null;
  let item;
  try {
    item = decodeItemShareUrl();
  } catch (error) {
    console.error('Could not open shared item', error);
    document.getElementById('sharedItemTitle').textContent = 'Cannot open shared item';
    document.getElementById('sharedItemError').textContent = 'This shared link is invalid or unsupported: ' + error.message;
    document.getElementById('sharedItemModal').classList.add('active');
    refreshSharedItemBoards();
    return;
  }
  if (!item) { closeSharedItemModal(false); return; }
  sharedItemContent = item;
  document.getElementById('sharedItemTitle').textContent = item.title;
  document.getElementById('sharedItemContent').innerHTML = renderSharedItemContent(item);
  document.getElementById('sharedItemModal').classList.add('active');
  refreshSharedItemBoards();
  document.getElementById('sharedItemClose').focus();
}

function refreshSharedItemBoards() {
  const select = document.getElementById('sharedItemBoard');
  const save = document.getElementById('sharedItemSave');
  document.getElementById('sharedItemSaveGroup').hidden = !sharedItemContent;
  save.disabled = !sharedItemContent || !db || sharedItemSaving;
  select.disabled = !db || sharedItemSaving;
  if (!sharedItemContent || !db) return;
  const selected = select.value;
  const result = db.exec(`
    SELECT id, name FROM sections WHERE type = ?
    ORDER BY prioritized DESC, sort_order, created_at DESC, id DESC`, [sharedItemContent.boardType]);
  const rows = result.length ? result[0].values : [];
  select.innerHTML = rows.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('')
    + `<option value="new">Create a new ${sharedItemContent.boardType} board</option>`;
  select.value = Array.from(select.options).some(option => option.value === selected)
    ? selected : (rows.length ? String(rows[0][0]) : 'new');
  onSharedItemBoardChange();
}

function onSharedItemBoardChange() {
  document.getElementById('sharedItemNewBoardGroup').hidden = document.getElementById('sharedItemBoard').value !== 'new';
}

function closeSharedItemModal(clearUrl = true) {
  sharedItemContent = null;
  document.getElementById('sharedItemContent').replaceChildren();
  document.getElementById('sharedItemError').textContent = '';
  document.getElementById('sharedItemSaveError').textContent = '';
  document.getElementById('sharedItemSaveGroup').hidden = true;
  document.getElementById('sharedItemSave').disabled = true;
  closeModal('sharedItemModal');
  if (clearUrl) {
    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.hash.slice(1));
    if (params.has('share')) {
      params.delete('share');
      url.hash = params.toString();
      window.history.replaceState(null, '', url.href);
    }
  }
}

async function saveSharedItemCopy() {
  if (sharedItemSaving) return;
  if (!sharedItemContent || !db) { toast('The item or boards are not available yet'); return; }
  const item = sharedItemContent;
  const target = document.getElementById('sharedItemBoard').value;
  const boardName = document.getElementById('sharedItemBoardName').value.trim();
  if (target === 'new' && !boardName) { toast('Board name is required'); return; }
  let sectionId = null;
  if (target !== 'new') {
    sectionId = Number(target);
    const board = db.exec('SELECT type FROM sections WHERE id = ?', [sectionId]);
    if (!board.length || board[0].values[0][0] !== item.boardType) {
      toast('Choose a matching board for this shared item');
      return;
    }
  }
  sharedItemSaving = true;
  refreshSharedItemBoards();
  document.getElementById('sharedItemSaveError').textContent = '';
  let itemId;
  try {
    db.run('BEGIN TRANSACTION');
    try {
      if (target === 'new') {
        db.run('INSERT INTO sections (name, color, type) VALUES (?, ?, ?)', [boardName, COLORS[5], item.boardType]);
        sectionId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
      }
      const order = db.exec('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM items WHERE section_id = ?', [sectionId])[0].values[0][0];
      db.run(`INSERT INTO items
        (section_id, title, description, description_format, link, sketch_data, status, completed,
         completed_at, due_date, recurring, recurring_days, recurring_time, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 2 THEN datetime('now') ELSE NULL END, ?, ?, ?, ?, ?)`,
      [sectionId, item.title, item.description, item.descriptionFormat, item.link, item.sketchData,
       item.status, item.status === 2 ? 1 : 0, item.status, item.dueDate, item.recurring,
       item.recurringDays, item.recurringTime, order]);
      itemId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
      item.followups.forEach((followup, index) => {
        db.run('INSERT INTO followups (item_id, text, completed, sort_order) VALUES (?, ?, ?, ?)',
          [itemId, followup.text, followup.completed ? 1 : 0, index]);
      });
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
    let persisted = true;
    try {
      await persist();
    } catch (error) {
      persisted = false;
      console.error('Could not persist shared item copy', error);
      window.alert('The copy was added, but browser storage could not be updated. Export a backup before closing the app.');
    }
    if (sharedItemContent === item) closeSharedItemModal();
    document.getElementById('searchBox').value = '';
    selectSection(sectionId);
    expandedItems.add(itemId);
    renderMain();
    if (persisted) {
      toast('Shared item saved to your board');
      createBackup('new-item', { silent: true }).catch(error => {
        console.error('Could not back up shared item copy', error);
        toast('Copy saved, but automatic backup failed');
      });
    }
  } catch (error) {
    console.error('Could not save shared item copy', error);
    document.getElementById('sharedItemSaveError').textContent = 'Could not save this copy: ' + error.message;
    toast('Could not save shared item copy');
  } finally {
    sharedItemSaving = false;
    refreshSharedItemBoards();
  }
}
