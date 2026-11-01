/* ================================================================
   Dashora – Application Logic
   Rendering, CRUD, drag-and-drop, search, export/import.
   ================================================================ */

const COLORS = [
  '#e05577', '#e0a055', '#d4c955', '#44cc88', '#55aadd',
  '#7c6ff7', '#cc66cc', '#ff8866', '#66ccbb', '#8899bb',
];
const RECURRENCE_LABELS = { 1: 'Daily', 2: 'Weekly', 3: 'Biweekly', 4: 'Monthly', 5: 'Custom' };

/* ── Global State ── */
let db              = null;   // set by initDB()
let activeSectionId = null;
let expandedItems   = new Set();
let editingFollowupId = null;
let dragItemId      = null;
let dragSectionId   = null;
let doneCollapsed      = false;
let inProgressCollapsed = false;
let todoCollapsed       = false;
let sketchActive    = false;  // whether sketch canvas is currently shown in item modal
let selectedColor      = COLORS[5];
let selectedBoardType  = 'task';
let sectionSearchTerm  = '';
let taskBoardsVisible  = 5;
let refBoardsVisible   = 5;
const SIDEBAR_PAGE_SIZE = 5;
const BACKUP_RETENTION = 3;
const BACKUP_META_DB = 'DashoraBackupMetaDB';
const BACKUP_META_STORE = 'meta';
const BACKUP_META_KEY = 'folderHandle';
const BACKUP_FILE_PREFIX = 'dashora-backup-';
let activeView = 'board';
let backupFolderHandle = null;
let backupFilesCache = [];
let reminderAudioCtx = null;
let pendingReminderTone = false;
let pendingReminderToneUrgent = false;
const unlockedProtectedItems = new Set();
const decryptedProtectedItems = new Map();
const PASSWORD_ITERATIONS = 210000;
const ENCRYPTION_VERSION = 1;
let encryptionPasswordPromptResolve = null;
let itemSaveInProgress = false;


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

function getAppSetting(key) {
  const result = db.exec('SELECT value FROM app_settings WHERE key = ?', [key]);
  return result.length && result[0].values.length ? result[0].values[0][0] : null;
}

function setAppSetting(key, value) {
  db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value]);
}

function deleteAppSetting(key) {
  db.run('DELETE FROM app_settings WHERE key = ?', [key]);
}

function hasGlobalPassword() {
  return !!(getAppSetting('password_hash') && getAppSetting('password_salt'));
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function derivePasswordHash(password, saltBase64, iterations = PASSWORD_ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: base64ToBytes(saltBase64),
    iterations,
    hash: 'SHA-256',
  }, keyMaterial, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function derivePasswordMaterial(password, saltBase64, iterations = PASSWORD_ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: base64ToBytes(saltBase64),
    iterations,
    hash: 'SHA-256',
  }, keyMaterial, 512));
  const verifier = bytesToBase64(bits.slice(0, 32));
  const encryptionKey = await crypto.subtle.importKey(
    'raw',
    bits.slice(32, 64),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  bits.fill(0);
  return { verifier, encryptionKey };
}

function hashesMatch(actualHash, expectedHash) {
  if (!actualHash || !expectedHash || actualHash.length !== expectedHash.length) return false;
  let difference = 0;
  for (let index = 0; index < actualHash.length; index++) {
    difference |= actualHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return difference === 0;
}

async function createPasswordCredential(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltBase64 = bytesToBase64(salt);
  return {
    hash: await derivePasswordHash(password, saltBase64),
    salt: saltBase64,
    iterations: PASSWORD_ITERATIONS,
  };
}

async function passwordMatches(password, expectedHash, salt, iterations = PASSWORD_ITERATIONS) {
  if (!password || !expectedHash || !salt) return false;
  const actualHash = await derivePasswordHash(password, salt, iterations);
  return hashesMatch(actualHash, expectedHash);
}

async function encryptPayloadWithKey(payload, encryptionKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, plaintext);
  plaintext.fill(0);
  return {
    encryptedData: bytesToBase64(new Uint8Array(ciphertext)),
    encryptionIv: bytesToBase64(iv),
    encryptionVersion: ENCRYPTION_VERSION,
  };
}

async function decryptPayloadWithKey(encryptedData, encryptionIv, encryptionKey, version) {
  if (version !== ENCRYPTION_VERSION) throw new Error('Unsupported encryption version');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(encryptionIv) },
    encryptionKey,
    base64ToBytes(encryptedData)
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function getItemProtection(itemId) {
  const result = db.exec(
    `SELECT section_id, protected, password_hash, password_salt, password_iterations,
            encrypted, encrypted_data, encryption_iv, encryption_version
     FROM items WHERE id = ?`,
    [itemId]
  );
  if (!result.length || !result[0].values.length) return null;
  const [sectionId, isProtected, passwordHash, passwordSalt, passwordIterations,
    isEncrypted, encryptedData, encryptionIv, encryptionVersion] = result[0].values[0];
  return {
    sectionId,
    isProtected: isProtected === 1,
    passwordHash,
    passwordSalt,
    passwordIterations: passwordIterations || PASSWORD_ITERATIONS,
    isEncrypted: isEncrypted === 1,
    encryptedData,
    encryptionIv,
    encryptionVersion,
  };
}

function isItemLocked(itemId, isProtected) {
  return isProtected === 1 && !unlockedProtectedItems.has(itemId);
}

function requestItemUnlock(itemId, action = 'expand') {
  const protection = getItemProtection(itemId);
  if (!protection || !protection.isProtected) {
    runUnlockedItemAction(itemId, action, protection ? protection.sectionId : null);
    return;
  }

  document.getElementById('unlockItemId').value = itemId;
  document.getElementById('unlockAction').value = action;
  document.getElementById('unlockPassword').value = '';
  document.getElementById('unlockError').textContent = '';
  document.getElementById('unlockModal').classList.add('active');
  requestAnimationFrame(() => document.getElementById('unlockPassword').focus());
}

async function submitItemUnlock() {
  const itemId = parseInt(document.getElementById('unlockItemId').value, 10);
  const action = document.getElementById('unlockAction').value || 'expand';
  const passwordInput = document.getElementById('unlockPassword');
  const protection = getItemProtection(itemId);
  if (!protection) {
    closeUnlockModal();
    return;
  }

  const password = passwordInput.value;
  const hash = protection.passwordHash || getAppSetting('password_hash');
  const salt = protection.passwordSalt || getAppSetting('password_salt');
  const iterations = protection.passwordHash
    ? protection.passwordIterations
    : parseInt(getAppSetting('password_iterations') || PASSWORD_ITERATIONS, 10);

  let valid = false;
  let decryptedPayload = null;
  try {
    if (protection.isEncrypted) {
      const material = await derivePasswordMaterial(password, salt, iterations);
      valid = hashesMatch(material.verifier, hash);
      if (valid) {
        decryptedPayload = await decryptPayloadWithKey(
          protection.encryptedData,
          protection.encryptionIv,
          material.encryptionKey,
          protection.encryptionVersion
        );
      }
    } else {
      valid = await passwordMatches(password, hash, salt, iterations);
    }
  } catch (error) {
    valid = false;
  }
  passwordInput.value = '';
  if (!valid) {
    document.getElementById('unlockError').textContent = 'Incorrect password or damaged encrypted data';
    passwordInput.focus();
    return;
  }

  if (decryptedPayload) decryptedProtectedItems.set(itemId, decryptedPayload);
  unlockedProtectedItems.add(itemId);
  closeUnlockModal();
  runUnlockedItemAction(itemId, action, protection.sectionId);
}

function runUnlockedItemAction(itemId, action, sectionId) {
  if (action === 'edit') {
    openItemModal(sectionId, itemId);
  } else if (action === 'copy') {
    copyItem(null, itemId);
  } else if (action === 'share') {
    shareItem(null, itemId);
    renderMain();
  } else {
    expandedItems.add(itemId);
    renderMain();
  }
}

function closeUnlockModal() {
  document.getElementById('unlockPassword').value = '';
  document.getElementById('unlockError').textContent = '';
  closeModal('unlockModal');
}

function lockItem(event, itemId) {
  if (event) event.stopPropagation();
  unlockedProtectedItems.delete(itemId);
  decryptedProtectedItems.delete(itemId);
  expandedItems.delete(itemId);
  renderMain();
}

function lockAllProtectedItems() {
  unlockedProtectedItems.clear();
  decryptedProtectedItems.clear();
  expandedItems.clear();
  renderMain();
  toast('Protected items locked');
}

function onRecurringChange() {
  const val = document.getElementById('itemRecurring').value;
  document.getElementById('recurringDaysWrap').style.display = val === '5' ? '' : 'none';
  document.getElementById('recurringTimeWrap').style.display = val !== '0' ? '' : 'none';
}

function clearRecurringTime() {
  document.getElementById('itemRecurringTime').value = '';
  document.getElementById('recurringTimeClearBtn').style.display = 'none';
}

function formatRecurringTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function getSelectedRecurringDays() {
  const checks = document.querySelectorAll('#recurringDaysWrap input[type=checkbox]:checked');
  return Array.from(checks).map(c => c.value).join(',');
}

function setRecurringDaysCheckboxes(daysStr) {
  const days = (daysStr || '').split(',').filter(Boolean);
  document.querySelectorAll('#recurringDaysWrap input[type=checkbox]').forEach(c => {
    c.checked = days.includes(c.value);
  });
}

function formatDueDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const hours = d.getHours();
  const mins = d.getMinutes();
  if (hours === 0 && mins === 0) {
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const m = mins.toString().padStart(2, '0');
  return `${months[d.getMonth()]} ${d.getDate()}, ${h}:${m} ${ampm}`;
}

function clearDueDate() {
  document.getElementById('itemDueDate').value = '';
  document.getElementById('dueDateClearBtn').style.display = 'none';
}

function unlockReminderAudio() {
  if (!window.AudioContext) return;
  try {
    if (!reminderAudioCtx) reminderAudioCtx = new AudioContext();
    if (reminderAudioCtx.state !== 'running') {
      reminderAudioCtx.resume().catch(() => {});
    }
    if (pendingReminderTone) {
      playReminderTone(pendingReminderToneUrgent);
      pendingReminderTone = false;
      pendingReminderToneUrgent = false;
    }
  } catch (e) {
    reminderAudioCtx = null;
  }
}

function playReminderTone(urgent) {
  if (!window.AudioContext) return false;
  try {
    if (!reminderAudioCtx) reminderAudioCtx = new AudioContext();
    if (!reminderAudioCtx || reminderAudioCtx.state !== 'running') return false;

    const ctx = reminderAudioCtx;
    const now = ctx.currentTime;
    const pulses = urgent ? 5 : 3;
    const spacing = 0.18;
    const baseFreq = urgent ? 1240 : 1020;
    const gainValue = urgent ? 0.24 : 0.16;

    for (let i = 0; i < pulses; i++) {
      const start = now + i * spacing;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = urgent ? 'square' : 'triangle';
      osc.frequency.value = baseFreq + (i % 2 === 0 ? 0 : 140);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.15);
    }
    return true;
  } catch (e) {
    // Ignore audio failures to keep reminder loop stable.
    return false;
  }
}

function getNotifiedMap() {
  try {
    const raw = localStorage.getItem('dashora_notified_map');
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function cleanupNotifiedMap(mapObj) {
  const cutoff = Date.now() - (48 * 60 * 60 * 1000);
  const cleaned = {};
  for (const k of Object.keys(mapObj)) {
    if ((mapObj[k] || 0) >= cutoff) cleaned[k] = mapObj[k];
  }
  return cleaned;
}

function markNotified(key) {
  const mapObj = cleanupNotifiedMap(getNotifiedMap());
  mapObj[key] = Date.now();
  localStorage.setItem('dashora_notified_map', JSON.stringify(mapObj));
}

function wasRecentlyNotified(key, minGapMs = 20 * 60 * 1000) {
  const mapObj = cleanupNotifiedMap(getNotifiedMap());
  localStorage.setItem('dashora_notified_map', JSON.stringify(mapObj));
  const last = mapObj[key] || 0;
  return (Date.now() - last) < minGapMs;
}

async function sendSystemReminder(reminderKey, title, body, urgent) {
  const canNotify = 'Notification' in window;
  if (!canNotify || Notification.permission !== 'granted') return;

  const tag = `dashora-${reminderKey}`;
  const options = {
    body,
    tag,
    renotify: true,
    requireInteraction: !!urgent,
    silent: false,
    badge: 'icons/icon-192.svg',
    icon: 'icons/icon-192.svg',
    data: { reminderKey }
  };

  try {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
    } else {
      const n = new Notification(title, options);
      n.onclick = () => window.focus();
    }
  } catch (e) {
    // Ignore notification errors to keep reminder loop stable.
  }
}

async function triggerReminderAttention(reminderKey, title, body, urgent) {
  if (wasRecentlyNotified(reminderKey)) return;

  const hidden = document.visibilityState === 'hidden';
  const unfocused = typeof document.hasFocus === 'function' ? !document.hasFocus() : hidden;
  const needsAttention = hidden || unfocused;

  let notificationSent = false;
  if (needsAttention) {
    await sendSystemReminder(reminderKey, title, body, urgent);
    notificationSent = true;
  }

  const played = playReminderTone(urgent);
  if (!played) {
    pendingReminderTone = true;
    pendingReminderToneUrgent = pendingReminderToneUrgent || urgent;
    if (urgent && !notificationSent) {
      // Fallback when tab is focused but audio is still locked after refresh.
      await sendSystemReminder(reminderKey, title, body, true);
    }
  }
  if (navigator.vibrate && needsAttention) {
    navigator.vibrate(urgent ? [260, 100, 260] : [160, 80, 160]);
  }

  markNotified(reminderKey);
}

function addToCalendar(event, id) {
  event.stopPropagation();
  const row = db.exec('SELECT title, description, due_date FROM items WHERE id = ?', [id]);
  if (!row.length || !row[0].values[0][2]) { toast('No due date set'); return; }

  const [title, desc, dueDate] = row[0].values[0];
  const due = new Date(dueDate);
  const dtStart = due.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  // Event lasts 1 hour
  const endDate = new Date(due.getTime() + 3600000);
  const dtEnd = endDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dashora//EN',
    'BEGIN:VEVENT',
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `DTSTAMP:${now}`,
    `UID:dashora-${id}-${Date.now()}@dashora`,
    `SUMMARY:${icsEscape(title)}`,
    desc ? `DESCRIPTION:${icsEscape(desc)}` : '',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(title)} is due`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dashora-${title.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '-')}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Calendar event downloaded');
}

function icsEscape(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function isFileSystemBackupSupported() {
  return typeof window.showDirectoryPicker === 'function';
}

function openBackupMetaDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_META_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(BACKUP_META_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open backup metadata DB'));
  });
}

async function getStoredBackupFolderHandle() {
  try {
    const dbm = await openBackupMetaDB();
    return await new Promise((resolve) => {
      const tx = dbm.transaction(BACKUP_META_STORE, 'readonly');
      const req = tx.objectStore(BACKUP_META_STORE).get(BACKUP_META_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function setStoredBackupFolderHandle(handle) {
  try {
    const dbm = await openBackupMetaDB();
    await new Promise((resolve, reject) => {
      const tx = dbm.transaction(BACKUP_META_STORE, 'readwrite');
      tx.objectStore(BACKUP_META_STORE).put(handle, BACKUP_META_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to store backup folder handle'));
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function clearStoredBackupFolderHandle() {
  try {
    const dbm = await openBackupMetaDB();
    await new Promise((resolve, reject) => {
      const tx = dbm.transaction(BACKUP_META_STORE, 'readwrite');
      tx.objectStore(BACKUP_META_STORE).delete(BACKUP_META_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to clear backup folder handle'));
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function ensureBackupFolderPermission(mode = 'readwrite') {
  if (!backupFolderHandle) return false;
  const opts = { mode };
  let permission = await backupFolderHandle.queryPermission(opts);
  if (permission !== 'granted') {
    permission = await backupFolderHandle.requestPermission(opts);
  }
  return permission === 'granted';
}

function normalizeBackupRecord(raw, fileName) {
  if (!raw || !raw.snapshot || !raw.snapshot.sections || !raw.snapshot.items) return null;
  return {
    id: fileName,
    fileName,
    reason: raw.reason || 'manual',
    createdAt: raw.createdAt || new Date().toISOString(),
    dayKey: raw.dayKey || dayKey(new Date(raw.createdAt || Date.now())),
    protected: raw.protected === true,
    snapshot: raw.snapshot,
  };
}

async function readBackupFile(fileHandle) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  const parsed = JSON.parse(text);
  return normalizeBackupRecord(parsed, fileHandle.name);
}

async function refreshBackupFiles() {
  if (!backupFolderHandle) {
    backupFilesCache = [];
    return backupFilesCache;
  }

  const hasPermission = await ensureBackupFolderPermission('readwrite');
  if (!hasPermission) {
    backupFilesCache = [];
    return backupFilesCache;
  }

  const backups = [];
  for await (const [name, handle] of backupFolderHandle.entries()) {
    if (handle.kind !== 'file') continue;
    if (!name.startsWith(BACKUP_FILE_PREFIX) || !name.endsWith('.json')) continue;
    try {
      const rec = await readBackupFile(handle);
      if (rec) backups.push(rec);
    } catch (e) {
      // Ignore unreadable backup files.
    }
  }

  backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  backupFilesCache = backups;
  return backupFilesCache;
}

async function pruneBackupFiles() {
  if (!backupFolderHandle) return;
  const backups = await refreshBackupFiles();
  const regularBackups = backups.filter(b => !b.protected);
  const extra = regularBackups.slice(BACKUP_RETENTION);
  for (const b of extra) {
    try {
      await backupFolderHandle.removeEntry(b.fileName);
    } catch (e) {
      // Ignore file-level delete failures and continue pruning other files.
    }
  }
  await refreshBackupFiles();
}

function buildBackupFileName(reason, createdAt, isProtected = false) {
  const safeReason = (reason || 'manual').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const d = new Date(createdAt);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  const stamp = `${y}-${m}-${day}_${hh}-${mm}-${ss}-${ms}`;
  const suffix = isProtected ? '-protected' : '';
  return `${BACKUP_FILE_PREFIX}${stamp}-${safeReason}${suffix}.json`;
}

async function initBackupSystem() {
  if (!isFileSystemBackupSupported()) {
    backupFolderHandle = null;
    backupFilesCache = [];
    return;
  }

  backupFolderHandle = await getStoredBackupFolderHandle();
  if (!backupFolderHandle) {
    backupFilesCache = [];
    return;
  }

  const hasPermission = await ensureBackupFolderPermission('readwrite');
  if (!hasPermission) {
    backupFilesCache = [];
    return;
  }

  await pruneBackupFiles();
  await ensureDailyBackup();
  renderSidebar();
  if (activeView === 'backup') renderMain();
}

async function selectBackupFolder() {
  if (!isFileSystemBackupSupported()) {
    toast('File system backups are not supported in this browser');
    return;
  }

  try {
    const picked = await window.showDirectoryPicker({ mode: 'readwrite' });
    backupFolderHandle = picked;
    await setStoredBackupFolderHandle(picked);
    await pruneBackupFiles();
    await ensureDailyBackup();
    renderSidebar();
    if (activeView === 'backup') renderMain();
    toast('Backup folder connected');
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    toast('Could not access selected folder');
  }
}

async function disconnectBackupFolder() {
  if (!backupFolderHandle) return;
  if (!confirm('Disconnect backup folder? Existing backup files will stay on disk.')) return;
  backupFolderHandle = null;
  backupFilesCache = [];
  await clearStoredBackupFolderHandle();
  renderSidebar();
  if (activeView === 'backup') renderMain();
  toast('Backup folder disconnected');
}

function snapshotCurrentData() {
  return {
    sections: db.exec('SELECT * FROM sections ORDER BY prioritized DESC, CASE WHEN prioritized = 1 THEN sort_order END ASC, created_at DESC, id DESC'),
    items: db.exec('SELECT * FROM items ORDER BY section_id, sort_order, id'),
    followups: db.exec('SELECT * FROM followups ORDER BY item_id, sort_order, id'),
    appSettings: db.exec('SELECT * FROM app_settings ORDER BY key'),
  };
}

function dayKey(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function createBackup(reason, options = {}) {
  if (!db) return false;
  if (!isFileSystemBackupSupported()) {
    if (!options.silent) toast('File system backups are not supported in this browser');
    return false;
  }
  if (!backupFolderHandle) {
    if (!options.silent) toast('Select a backup folder first');
    return false;
  }

  const hasPermission = await ensureBackupFolderPermission('readwrite');
  if (!hasPermission) {
    if (!options.silent) toast('Backup folder permission denied');
    return false;
  }

  const silent = options.silent === true;
  const force = options.force === true;
  const createdAt = options.createdAt || new Date().toISOString();
  const key = dayKey(new Date(createdAt));
  const backups = await refreshBackupFiles();

  if (!force && reason === 'daily' && backups.some(b => b && b.dayKey === key)) {
    return false;
  }

  const record = {
    reason: reason || 'manual',
    createdAt,
    dayKey: key,
    protected: false,
    snapshot: snapshotCurrentData(),
  };

  try {
    const fileName = buildBackupFileName(record.reason, record.createdAt, record.protected === true);
    const fileHandle = await backupFolderHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(record, null, 2));
    await writable.close();
    await pruneBackupFiles();
  } catch (e) {
    if (!silent) toast('Backup failed: could not write file');
    return false;
  }

  if (!silent) {
    toast('Backup file created');
  }

  renderSidebar();
  if (activeView === 'backup') renderMain();
  return true;
}

async function ensureDailyBackup() {
  await createBackup('daily', { silent: true });
}

async function ensureBackupRetention() {
  await pruneBackupFiles();
  if (activeView === 'backup') {
    renderSidebar();
    renderMain();
  }
  return backupFilesCache.length;
}

function applySnapshot(snapshot) {
  if (!snapshot || !snapshot.sections || !snapshot.items) {
    throw new Error('Invalid backup data');
  }
  validateDescriptionFormats(snapshot.items);

  db.run('DELETE FROM items');
  db.run('DELETE FROM sections');
  db.run('DELETE FROM followups');
  db.run('DELETE FROM app_settings');

  if (snapshot.sections.length && snapshot.sections[0].values) {
    const cols = snapshot.sections[0].columns
      ? snapshot.sections[0].columns.join(', ')
      : 'id, name, color, sort_order, created_at';
    const ph = snapshot.sections[0].columns
      ? snapshot.sections[0].columns.map(() => '?').join(', ')
      : '?, ?, ?, ?, ?';
    for (const row of snapshot.sections[0].values) {
      db.run(`INSERT INTO sections (${cols}) VALUES (${ph})`, row);
    }
  }

  if (snapshot.items.length && snapshot.items[0].values) {
    const cols = snapshot.items[0].columns
      ? snapshot.items[0].columns.join(', ')
      : 'id, section_id, title, description, link, completed, sort_order, created_at';
    const ph = snapshot.items[0].columns
      ? snapshot.items[0].columns.map(() => '?').join(', ')
      : '?, ?, ?, ?, ?, ?, ?, ?';
    for (const row of snapshot.items[0].values) {
      db.run(`INSERT INTO items (${cols}) VALUES (${ph})`, row);
    }
  }

  if (snapshot.followups && snapshot.followups.length && snapshot.followups[0].values) {
    const cols = snapshot.followups[0].columns
      ? snapshot.followups[0].columns.join(', ')
      : 'id, item_id, text, completed, sort_order, created_at';
    const ph = snapshot.followups[0].columns
      ? snapshot.followups[0].columns.map(() => '?').join(', ')
      : '?, ?, ?, ?, ?, ?';
    for (const row of snapshot.followups[0].values) {
      db.run(`INSERT INTO followups (${cols}) VALUES (${ph})`, row);
    }
  }

  if (snapshot.appSettings && snapshot.appSettings.length && snapshot.appSettings[0].values) {
    for (const row of snapshot.appSettings[0].values) {
      db.run('INSERT INTO app_settings (key, value) VALUES (?, ?)', row);
    }
  }

  unlockedProtectedItems.clear();
  decryptedProtectedItems.clear();
}

function formatBackupDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}

function renderBackupTab() {
  const header = document.getElementById('mainHeader');
  const body = document.getElementById('mainBody');
  const backups = backupFilesCache;
  const canUseFS = isFileSystemBackupSupported();
  const folderConnected = !!backupFolderHandle;
  const folderName = folderConnected ? backupFolderHandle.name : 'No folder selected';
  const protectedCount = backups.filter(b => b.protected).length;
  const regularCount = backups.length - protectedCount;

  header.innerHTML = `
    <div class="main-header-left">
      <button class="sidebar-toggle" type="button" aria-label="Open navigation menu" aria-controls="sidebar" aria-expanded="false" onclick="toggleSidebar()">&#9776;</button>
      <h2>Backups</h2>
      <span class="item-total">${backups.length} file${backups.length !== 1 ? 's' : ''} · ${protectedCount} protected</span>
    </div>
    <div class="board-actions">
      <button class="btn btn-ghost btn-sm" onclick="selectBackupFolder()">&#128193; Choose folder</button>
      ${folderConnected ? '<button class="btn btn-ghost btn-sm" onclick="disconnectBackupFolder()">Disconnect</button>' : ''}
      <button class="btn btn-ghost btn-sm" onclick="createBackup('manual')" ${folderConnected ? '' : 'disabled'}>&#128190; Backup now</button>
    </div>`;

  if (!canUseFS) {
    body.innerHTML = `<div class="empty-state">
      <h3>File system backup is unavailable</h3>
      <p>Your current browser does not support folder-based backups.</p>
    </div>`;
    return;
  }

  if (!folderConnected) {
    body.innerHTML = `<div class="empty-state">
      <h3>Choose a backup folder</h3>
      <p>Backups are saved as JSON files on disk. Only the latest ${BACKUP_RETENTION} regular backups are kept automatically; protected backups are excluded.</p>
      <button class="btn btn-primary" onclick="selectBackupFolder()">Select folder</button>
    </div>`;
    return;
  }

  let html = `<div class="backup-folder-note">Folder: ${esc(folderName)} · ${regularCount} regular · ${protectedCount} protected</div>`;

  if (!backups.length) {
    body.innerHTML = `${html}<div class="empty-state">
      <h3>No backups yet</h3>
      <p>Daily backups are created automatically and only the latest ${BACKUP_RETENTION} regular backups are kept.</p>
      <button class="btn btn-primary" onclick="createBackup('manual')">Create first backup</button>
    </div>`;
    return;
  }

  const cards = backups.map((b, idx) => {
    const secCount = b.snapshot && b.snapshot.sections && b.snapshot.sections[0] && b.snapshot.sections[0].values
      ? b.snapshot.sections[0].values.length
      : 0;
    const itemCount = b.snapshot && b.snapshot.items && b.snapshot.items[0] && b.snapshot.items[0].values
      ? b.snapshot.items[0].values.length
      : 0;
    const reasonLabel = b.reason === 'daily'
      ? 'Daily auto'
      : b.reason === 'pre-import'
      ? 'Before import'
      : b.reason === 'new-item'
      ? 'New item'
      : b.reason === 'new-board'
      ? 'New board'
      : 'Manual';

    return `
      <div class="backup-card">
        <div class="backup-card-top">
          <div>
            <div class="backup-title">Backup ${backups.length - idx}</div>
            <div class="backup-meta">${esc(reasonLabel)} · ${esc(formatBackupDate(b.createdAt))}</div>
          </div>
          <span class="backup-pill ${b.protected ? 'backup-pill-protected' : ''}">${b.protected ? 'Protected · ' : ''}${secCount} boards · ${itemCount} items</span>
        </div>
        <div class="backup-actions">
          <button class="btn btn-primary btn-sm" onclick="restoreBackup('${escAttr(b.id)}')">Restore</button>
          <button class="btn btn-ghost btn-sm backup-protect-btn" onclick="setBackupProtected('${escAttr(b.id)}', ${b.protected ? 'false' : 'true'})">${b.protected ? 'Unprotect' : 'Protect'}</button>
          <button class="btn btn-ghost btn-sm backup-delete-btn" onclick="deleteBackup('${escAttr(b.id)}')">Delete</button>
        </div>
      </div>`;
  }).join('');

  html += `<div class="backup-list">${cards}</div>`;
  body.innerHTML = html;
}

function selectBackupTab() {
  activeView = 'backup';
  expandedItems.clear();
  sectionSearchTerm = '';
  renderSidebar();
  renderMain();
  closeSidebar();
  refreshBackupFiles().then(() => {
    if (activeView === 'backup') {
      renderSidebar();
      renderMain();
    }
  });
}

async function restoreBackup(backupId) {
  const backups = await refreshBackupFiles();
  const found = backups.find(b => b && b.id === backupId);
  if (!found) {
    toast('Backup not found');
    return;
  }

  if (!confirm('Restore this backup? Current data will be replaced.')) return;

  try {
    applySnapshot(found.snapshot);
    const first = db.exec('SELECT id FROM sections ORDER BY prioritized DESC, CASE WHEN prioritized = 1 THEN sort_order END ASC, created_at DESC, id DESC LIMIT 1');
    activeSectionId = (first.length && first[0].values.length) ? first[0].values[0][0] : null;
    activeView = 'board';
    persist();
    renderSidebar();
    renderMain();
    toast('Backup restored');
  } catch (err) {
    toast('Restore failed: ' + err.message);
  }
}

async function deleteBackup(backupId) {
  if (!backupFolderHandle) {
    toast('No backup folder connected');
    return;
  }

  const backups = await refreshBackupFiles();
  const found = backups.find(b => b && b.id === backupId);
  if (!found) {
    toast('Backup not found');
    return;
  }

  if (!confirm('Delete this backup?')) return;

  try {
    await backupFolderHandle.removeEntry(found.fileName);
  } catch (e) {
    toast('Could not delete backup file');
    return;
  }

  await refreshBackupFiles();
  renderSidebar();
  if (activeView === 'backup') renderMain();
  toast('Backup deleted');
}

async function setBackupProtected(backupId, shouldProtect) {
  if (!backupFolderHandle) {
    toast('No backup folder connected');
    return;
  }

  const backups = await refreshBackupFiles();
  const found = backups.find(b => b && b.id === backupId);
  if (!found) {
    toast('Backup not found');
    return;
  }

  try {
    const payload = {
      reason: found.reason,
      createdAt: found.createdAt,
      dayKey: found.dayKey,
      protected: shouldProtect === true,
      snapshot: found.snapshot,
    };

    const nextFileName = buildBackupFileName(payload.reason, payload.createdAt, payload.protected);
    const nextHandle = await backupFolderHandle.getFileHandle(nextFileName, { create: true });
    const writable = await nextHandle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();

    if (nextFileName !== found.fileName) {
      await backupFolderHandle.removeEntry(found.fileName);
    }
  } catch (e) {
    toast('Could not update backup protection');
    return;
  }

  if (shouldProtect) {
    await refreshBackupFiles();
  } else {
    await pruneBackupFiles();
  }

  renderSidebar();
  if (activeView === 'backup') renderMain();
  toast(shouldProtect ? 'Backup protected' : 'Backup unprotected');
}


/* ================================================================
   Sidebar Rendering
   ================================================================ */

function renderSidebar() {
  const nav = document.getElementById('sidebarNav');
  const sections = db.exec('SELECT id, name, color, type FROM sections ORDER BY prioritized DESC, CASE WHEN prioritized = 1 THEN sort_order END ASC, created_at DESC, id DESC');
  const backupsCount = backupFilesCache.length;

  let html = `
    <div class="nav-label">Utilities</div>
    <button type="button" class="nav-item dashboard-nav ${activeView === 'dashboard' ? 'active' : ''}" ${activeView === 'dashboard' ? 'aria-current="page"' : ''} onclick="selectDashboardTab()">
      <span class="nav-dot" style="background:var(--success)"></span>
      <span class="nav-name">Dashboard</span>
    </button>
    <div class="nav-item ${activeView === 'backup' ? 'active' : ''}" onclick="selectBackupTab()">
      <div class="nav-dot" style="background:var(--accent)"></div>
      <span class="nav-name">Backups</span>
      <span class="nav-count">${backupsCount}</span>
    </div>
    <div class="nav-divider"></div>`;

  if (!sections.length || !sections[0].values.length) {
    html += '<div class="nav-label">No boards yet</div>';
    nav.innerHTML = html;
    return;
  }

  const allRows  = sections[0].values;
  const taskRows = allRows.filter(r => (r[3] || 'task') === 'task');
  const refRows  = allRows.filter(r => r[3] === 'reference');

  // ── Task Boards ──
  html += '<div class="nav-label">📋 Task Boards</div>';
  if (taskRows.length === 0) {
    html += '<div class="nav-empty-hint">No task boards</div>';
  }
  const visibleTasks = taskRows.slice(0, taskBoardsVisible);
  for (const [id, name, color] of visibleTasks) {
    const isActive = activeView === 'board' && id === activeSectionId ? 'active' : '';
    const todo   = db.exec('SELECT COUNT(*) FROM items WHERE section_id = ? AND status = 0', [id])[0].values[0][0];
    const inProg = db.exec('SELECT COUNT(*) FROM items WHERE section_id = ? AND status = 1', [id])[0].values[0][0];
    const done   = db.exec('SELECT COUNT(*) FROM items WHERE section_id = ? AND status = 2', [id])[0].values[0][0];
    let countParts = [];
    if (todo) countParts.push(`${todo}`);
    if (inProg) countParts.push(`${inProg} ⏳`);
    if (done) countParts.push(`${done} ✓`);
    const countText = countParts.join(' / ') || '0';
    html += renderNavItem(id, name, color, isActive, countText);
  }
  if (taskRows.length > taskBoardsVisible) {
    const remaining = taskRows.length - taskBoardsVisible;
    const next = Math.min(remaining, SIDEBAR_PAGE_SIZE);
    html += `<div class="nav-toggle" onclick="showMoreBoards('task')">▼ Show ${next} more (${remaining} left)</div>`;
  } else if (taskBoardsVisible > SIDEBAR_PAGE_SIZE && taskRows.length > SIDEBAR_PAGE_SIZE) {
    html += `<div class="nav-toggle" onclick="showLessBoards('task')">▲ Show less</div>`;
  }

  // ── Divider ──
  html += '<div class="nav-divider"></div>';

  // ── Reference Boards ──
  html += '<div class="nav-label">📖 Reference Boards</div>';
  if (refRows.length === 0) {
    html += '<div class="nav-empty-hint">No reference boards</div>';
  }
  const visibleRefs = refRows.slice(0, refBoardsVisible);
  for (const [id, name, color] of visibleRefs) {
    const isActive = activeView === 'board' && id === activeSectionId ? 'active' : '';
    const total = db.exec('SELECT COUNT(*) FROM items WHERE section_id = ?', [id])[0].values[0][0];
    html += renderNavItem(id, name, color, isActive, `${total}`);
  }
  if (refRows.length > refBoardsVisible) {
    const remaining = refRows.length - refBoardsVisible;
    const next = Math.min(remaining, SIDEBAR_PAGE_SIZE);
    html += `<div class="nav-toggle" onclick="showMoreBoards('ref')">▼ Show ${next} more (${remaining} left)</div>`;
  } else if (refBoardsVisible > SIDEBAR_PAGE_SIZE && refRows.length > SIDEBAR_PAGE_SIZE) {
    html += `<div class="nav-toggle" onclick="showLessBoards('ref')">▲ Show less</div>`;
  }

  nav.innerHTML = html;
}

function showMoreBoards(group) {
  if (group === 'task') taskBoardsVisible += SIDEBAR_PAGE_SIZE;
  else if (group === 'ref') refBoardsVisible += SIDEBAR_PAGE_SIZE;
  renderSidebar();
}

function showLessBoards(group) {
  if (group === 'task') taskBoardsVisible = SIDEBAR_PAGE_SIZE;
  else if (group === 'ref') refBoardsVisible = SIDEBAR_PAGE_SIZE;
  renderSidebar();
}

function renderNavItem(id, name, color, isActive, countText) {
  return `
    <div class="nav-item ${isActive}" data-section-id="${id}"
         onclick="selectSection(${id})"
         draggable="true"
         ondragstart="onSectionDragStart(event, ${id})"
         ondragover="onSectionDragOver(event)"
         ondrop="onSectionDrop(event, ${id})">
      <span class="drag-handle">&#9776;</span>
      <div class="nav-dot" style="background:${escAttr(color)}"></div>
      <span class="nav-name">${esc(name)}</span>
      <button class="nav-edit" onclick="event.stopPropagation(); openSectionModal(${id})" title="Edit board">&#9998;</button>
      <span class="nav-count">${countText}</span>
    </div>`;
}


/* ================================================================
   Main Content Rendering
   ================================================================ */

function renderMain() {
  const header    = document.getElementById('mainHeader');
  const body      = document.getElementById('mainBody');
  const searchTerm = sectionSearchTerm;

  if (activeView === 'dashboard') {
    renderDashboard();
    return;
  }

  if (activeView === 'backup') {
    renderBackupTab();
    return;
  }

  // No section selected
  if (!activeSectionId) {
    header.innerHTML = `<div class="main-header-left">
      <button class="sidebar-toggle" type="button" aria-label="Open navigation menu" aria-controls="sidebar" aria-expanded="false" onclick="toggleSidebar()">&#9776;</button>
    </div>`;
    const hasSections = db.exec('SELECT COUNT(*) FROM sections')[0].values[0][0] > 0;
    if (hasSections) {
      body.innerHTML = `<div class="empty-state">
        <h3>Select a board</h3>
        <p>Pick a board from the sidebar</p>
      </div>`;
    } else {
      body.innerHTML = `<div class="empty-state">
        <h3>Welcome to Dashora</h3>
        <p>Create your first board to get started</p>
        <button class="btn btn-primary" onclick="openSectionModal()" style="margin-top:12px">+ New Board</button>
      </div>`;
    }
    return;
  }

  // Load section info
  const sec = db.exec('SELECT id, name, color, type FROM sections WHERE id = ?', [activeSectionId]);
  if (!sec.length || !sec[0].values.length) { activeSectionId = null; renderMain(); return; }
  const [sid, sname, scolor, stype] = sec[0].values[0];
  const boardType = stype || 'task';
  const total = db.exec('SELECT COUNT(*) FROM items WHERE section_id = ?', [sid])[0].values[0][0];

  header.innerHTML = `
    <div class="main-header-left">
      <button class="sidebar-toggle" type="button" aria-label="Open navigation menu" aria-controls="sidebar" aria-expanded="false" onclick="toggleSidebar()">&#9776;</button>
      <div class="section-color-big" style="background:${escAttr(scolor)}"></div>
      <h2>${esc(sname)}</h2>
      <span class="item-total">${total} item${total !== 1 ? 's' : ''}</span>
    </div>
    <div style="display:flex;gap:8px;">
      ${boardType === 'reference' && unlockedProtectedItems.size ? '<button class="btn btn-ghost btn-sm" onclick="lockAllProtectedItems()">&#128274; Lock all</button>' : ''}
      <button class="btn btn-ghost btn-sm" onclick="openSectionModal(${sid})">&#9998; Edit Board</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteSection(${sid})">&#10005; Delete Board</button>
    </div>`;

  // Section search bar
  const searchVal = escAttr(sectionSearchTerm);

  // Load items from DB (with search filter if active)
  const itemsRes = db.exec(
    `SELECT id, title, description, link, completed, recurring, status, due_date,
            description_format, protected, password_hash, password_salt, encrypted, sketch_data
     FROM items WHERE section_id = ? ORDER BY sort_order, id`,
    [sid]
  );
  let rows = itemsRes.length ? itemsRes[0].values : [];
  rows = rows.map(row => {
    if (row[12] !== 1) return row;
    const payload = decryptedProtectedItems.get(row[0]);
    if (!payload) return row;
    const hydrated = [...row];
    hydrated[1] = payload.title || '';
    hydrated[2] = payload.description || '';
    hydrated[3] = payload.link || '';
    hydrated[13] = payload.sketchData || null;
    return hydrated;
  });
  if (searchTerm) {
    rows = rows.filter(row => {
      if (boardType === 'reference' && isItemLocked(row[0], row[9])) return false;
      return (row[1] || '').toLowerCase().includes(searchTerm)
        || (row[2] || '').toLowerCase().includes(searchTerm);
    });
  }

  if (rows.length === 0 && !searchTerm) {
    body.innerHTML = `
      <div class="empty-state">
        <h3>No items yet</h3>
        <p>Add your first item to this board</p>
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

  if (boardType === 'reference') {
    // ── Reference Board: flat list ──
    html += '<div class="ref-board">';
    for (const [iid, title, desc, link, completed, recurring, status, dueDate,
      descriptionFormat, isProtected, passwordHash, passwordSalt, isEncrypted, sketchData] of rows) {
      html += renderRefItem(
        iid, title, desc, link, expandedItems.has(iid), sid, sketchData, isProtected, isEncrypted, descriptionFormat
      );
    }
    html += '</div>';
    if (!searchTerm) {
      html += `<div class="add-item-row" onclick="openItemModal(${sid})">+ Add Item</div>`;
    }
  } else {
    // ── Task Board: Kanban columns ──
    const todoRows   = rows.filter(r => (r[6] || 0) === 0);
    const ipRows     = rows.filter(r => (r[6] || 0) === 1);
    const doneRows   = rows.filter(r => (r[6] || 0) === 2);

    html += '<div class="kanban-board">';

    // ── To Do column ──
    const todoArrow = todoCollapsed ? 'collapsed' : '';
    html += `<div class="kanban-column kanban-col-todo ${todoCollapsed ? 'kanban-col-collapsed' : ''}"
                  ondragover="onColumnDragOver(event, 0)"
                  ondragleave="onColumnDragLeave(event)"
                  ondrop="onColumnDrop(event, 0)">
      <div class="kanban-column-header" onclick="toggleKanbanCol('todo')">
        <span class="kanban-col-arrow ${todoArrow}">&#9660;</span>
        <span class="kanban-col-icon">📋</span>
        <span class="kanban-col-title">To Do</span>
        <span class="kanban-col-count">${todoRows.length}</span>
      </div>`;
    if (!todoCollapsed) {
      html += '<div class="kanban-column-body" id="itemList">';
      for (const [iid, title, desc, link, completed, recurring, status, dueDate, descriptionFormat] of todoRows) {
        html += renderItem(iid, title, desc, link, completed, recurring, status, expandedItems.has(iid), sid, dueDate, descriptionFormat);
      }
      if (!todoRows.length) {
        html += '<div class="kanban-empty">Nothing waiting here</div>';
      }
      html += '</div>';
      if (!searchTerm) {
        html += `<div class="kanban-add-item" onclick="openItemModal(${sid})">Add Item</div>`;
      }
    }
    html += '</div>';

    // ── In Progress column ──
    const ipArrow = inProgressCollapsed ? 'collapsed' : '';
    html += `<div class="kanban-column kanban-col-ip ${inProgressCollapsed ? 'kanban-col-collapsed' : ''}"
                  ondragover="onColumnDragOver(event, 1)"
                  ondragleave="onColumnDragLeave(event)"
                  ondrop="onColumnDrop(event, 1)">
      <div class="kanban-column-header" onclick="toggleKanbanCol('ip')">
        <span class="kanban-col-arrow ${ipArrow}">&#9660;</span>
        <span class="kanban-col-icon">⏳</span>
        <span class="kanban-col-title">In Progress</span>
        <span class="kanban-col-count">${ipRows.length}</span>
      </div>`;
    if (!inProgressCollapsed) {
      html += '<div class="kanban-column-body">';
      for (const [iid, title, desc, link, completed, recurring, status, dueDate, descriptionFormat] of ipRows) {
        html += renderItem(iid, title, desc, link, completed, recurring, status, expandedItems.has(iid), sid, dueDate, descriptionFormat);
      }
      if (!ipRows.length) {
        html += '<div class="kanban-empty">Ready when you are</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    // ── Done column ──
    const doneArrow = doneCollapsed ? 'collapsed' : '';
    html += `<div class="kanban-column kanban-col-done ${doneCollapsed ? 'kanban-col-collapsed' : ''}"
                  ondragover="onColumnDragOver(event, 2)"
                  ondragleave="onColumnDragLeave(event)"
                  ondrop="onColumnDrop(event, 2)">
      <div class="kanban-column-header" onclick="toggleKanbanCol('done')">
        <span class="kanban-col-arrow ${doneArrow}">&#9660;</span>
        <span class="kanban-col-icon">✅</span>
        <span class="kanban-col-title">Done</span>
        <span class="kanban-col-count">${doneRows.length}</span>
      </div>`;
    if (!doneCollapsed) {
      html += '<div class="kanban-column-body">';
      for (const [iid, title, desc, link, completed, recurring, status, dueDate, descriptionFormat] of doneRows) {
        html += renderItem(iid, title, desc, link, completed, recurring, status, expandedItems.has(iid), sid, dueDate, descriptionFormat);
      }
      if (!doneRows.length) {
        html += '<div class="kanban-empty">Completed tasks land here</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    html += '</div>'; // close .kanban-board
  }

  body.innerHTML = html;
}


/* ── Reference Item HTML ── */

function renderRefItem(iid, title, desc, link, isExpanded, sid, sketchData, isProtected, isEncrypted, descriptionFormat = 'plain') {
  if (isItemLocked(iid, isProtected)) {
    return `
      <div class="item ref-item protected-item locked-item" data-item-id="${iid}">
        <div class="item-row" onclick="requestItemUnlock(${iid}, 'expand')">
          <span class="ref-item-icon">&#128274;</span>
          <span class="item-title-text protected-item-title">${isEncrypted ? 'Encrypted item' : 'Protected item'}</span>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();requestItemUnlock(${iid}, 'expand')">Unlock</button>
          <button class="btn btn-ghost btn-sm" onclick="shareItem(event, ${iid})">Share</button>
        </div>
      </div>`;
  }

  const expandedCls = isExpanded ? 'expanded' : '';
  const hasLink = link ? '<span class="item-has-link">&#128279;</span>' : '';
  const hasDesc = desc ? '<span class="item-has-desc">&#128196;</span>' : '';
  const hasSketch = sketchData ? '<span class="item-has-desc">🎨</span>' : '';
  const icon = sketchData ? '🎨' : '📄';

  let detail = '';
  if (isExpanded) {
    const sketchPreview = sketchData
      ? `<div class="sketch-preview-large"><img src="${escAttr(sketchData)}" alt="Sketch" loading="lazy"></div>`
      : '';
    detail = `
      <div class="item-detail">
        ${desc
          ? renderDescription(desc, descriptionFormat)
          : (!sketchData ? '<div style="color:var(--text-muted);font-size:20px;margin-bottom:10px;">No description</div>' : '')}
        ${link
          ? `<div class="item-detail-link">&#128279; <a href="${escAttr(link)}" target="_blank" rel="noopener">${esc(link)}</a></div>`
          : ''}
        ${sketchPreview}
        <div class="item-detail-actions" style="margin-top:10px;">
          <button class="btn btn-ghost btn-sm" onclick="openItemModal(${sid}, ${iid})">&#9998; Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="copyItem(event, ${iid})">&#128203; Copy</button>
          <button class="btn btn-ghost btn-sm" onclick="shareItem(event, ${iid})">&#8599; Share</button>
          ${isProtected ? `<button class="btn btn-ghost btn-sm" onclick="lockItem(event, ${iid})">&#128274; Lock</button>` : ''}
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteItem(${iid})">&#10005; Delete</button>
        </div>
      </div>`;
  }

  return `
    <div class="item ref-item ${sketchData ? 'sketch-item' : ''} ${expandedCls}" data-item-id="${iid}"
         ondragover="onItemDragOver(event, ${iid})"
         ondragleave="onItemDragLeave(event)"
         ondrop="onItemDrop(event, ${iid})">
      <div class="item-row" onclick="toggleExpand(${iid})">
        <span class="item-drag" draggable="true" ondragstart="onItemDragStart(event, ${iid})"
              onclick="event.stopPropagation()" title="Drag to move item" aria-label="Drag to move item">&#9776;</span>
        <span class="ref-item-icon">${icon}</span>
        <div class="item-main">
          <span class="item-title-text">${esc(title)}</span>
          <div class="item-meta-row">
            <div class="item-indicators">${isEncrypted ? '<span title="AES-GCM encrypted">&#128272;</span>' : (isProtected ? '<span title="Password protected">&#128275;</span>' : '')}${hasSketch}${hasDesc}${hasLink}</div>
            <div class="item-quick-actions">
              <button class="item-quick-btn" title="Copy" onclick="copyItem(event, ${iid})">&#128203;</button>
              <button class="item-quick-btn" title="Share" aria-label="Share item" onclick="shareItem(event, ${iid})">&#8599;</button>
              <button class="item-quick-btn" title="Edit" onclick="event.stopPropagation(); openItemModal(${sid}, ${iid})">&#9998;</button>
            </div>
            <span class="expand-arrow">&#9654;</span>
          </div>
        </div>
      </div>
      ${detail}
    </div>`;
}


/* ── Single Item HTML ── */

function renderItem(iid, title, desc, link, completed, recurring, status, isExpanded, sid, dueDate, descriptionFormat = 'plain') {
  const st = status || 0; // 0=todo, 1=in-progress, 2=done
  const statusCls  = st === 2 ? 'status-done' : st === 1 ? 'status-ip' : 'status-todo';
  const expandedCls  = isExpanded ? 'expanded' : '';
  const hasLink = link ? '<span class="item-has-link">&#128279;</span>' : '';
  const hasDesc = desc ? '<span class="item-has-desc">&#128196;</span>' : '';
  const recurBadge = recurring ? `<span class="item-recurring" title="Recurring ${RECURRENCE_LABELS[recurring] || ''}">${RECURRENCE_LABELS[recurring] || '\u{1F501}'}</span>` : '';

  // Recurring time badge
  const recurTimeRes = db.exec('SELECT recurring_time FROM items WHERE id = ?', [iid]);
  const recurTime = (recurTimeRes.length && recurTimeRes[0].values[0][0]) ? recurTimeRes[0].values[0][0] : null;
  let recurTimeBadge = '';
  if (recurring && recurTime) {
    recurTimeBadge = `<span class="recur-time-badge" title="Reminder at ${formatRecurringTime(recurTime)}">&#128340; ${formatRecurringTime(recurTime)}</span>`;
  }

  // Due date badge
  let dueBadge = '';
  if (dueDate && st !== 2) {
    const now = new Date();
    const due = new Date(dueDate);
    const diffMs = due - now;
    const diffHours = diffMs / 3600000;
    if (diffMs < 0) {
      const overdueDays = Math.ceil(Math.abs(diffMs) / 86400000);
      dueBadge = `<span class="due-badge due-overdue" title="Overdue">&#128308; ${formatDueDate(dueDate)}</span>`;
    } else if (diffHours <= 24) {
      dueBadge = `<span class="due-badge due-today" title="Due within 24h">&#128992; ${formatDueDate(dueDate)}</span>`;
    } else if (diffHours <= 72) {
      dueBadge = `<span class="due-badge due-soon" title="Due soon">${formatDueDate(dueDate)}</span>`;
    } else {
      dueBadge = `<span class="due-badge">${formatDueDate(dueDate)}</span>`;
    }
  } else if (dueDate && st === 2) {
    dueBadge = `<span class="due-badge due-done">${formatDueDate(dueDate)}</span>`;
  }

  // Checkbox appearance based on status
  let checkboxCls = '';
  let checkboxContent = '';
  if (st === 1) { checkboxCls = 'in-progress'; checkboxContent = '&#9654;'; }
  else if (st === 2) { checkboxCls = 'checked'; checkboxContent = '&#10003;'; }

  // Follow-up indicator badge (count of open follow-ups)
  const fuRes = db.exec('SELECT COUNT(*), COALESCE(SUM(completed), 0) FROM followups WHERE item_id = ?', [iid]);
  const fuTotal = (fuRes.length && fuRes[0].values[0][0]) ? fuRes[0].values[0][0] : 0;
  const fuDone = (fuRes.length && fuRes[0].values[0][1]) ? fuRes[0].values[0][1] : 0;
  let followupBadge = '';
  if (fuTotal > 0) {
    const allDone = fuDone >= fuTotal;
    followupBadge = `<span class="item-followups ${allDone ? 'followups-done' : ''}" title="${fuDone}/${fuTotal} follow-ups done">&#128257; ${fuDone}/${fuTotal}</span>`;
  }

  let detail = '';
  if (isExpanded) {
    const recurSelect = `<select class="recurring-select" onchange="setRecurring(event, ${iid}, this.value)">
        <option value="0" ${!recurring ? 'selected' : ''}>Not recurring</option>
        <option value="1" ${recurring===1 ? 'selected' : ''}>&#128260; Daily</option>
        <option value="2" ${recurring===2 ? 'selected' : ''}>&#128260; Weekly</option>
        <option value="3" ${recurring===3 ? 'selected' : ''}>&#128260; Biweekly</option>
        <option value="4" ${recurring===4 ? 'selected' : ''}>&#128260; Monthly</option>
        <option value="5" ${recurring===5 ? 'selected' : ''}>&#128260; Specific days</option>
      </select>`;

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
          ? renderDescription(desc, descriptionFormat)
          : '<div style="color:var(--text-muted);font-size:17px;margin-bottom:10px;">No description</div>'}
        ${link
          ? `<div class="item-detail-link">&#128279; <a href="${escAttr(link)}" target="_blank" rel="noopener">${esc(link)}</a></div>`
          : ''}
        ${renderFollowups(iid)}
        <div class="item-detail-toolbar">
          <div class="item-status-btns">
            <button class="btn btn-ghost btn-sm ${st === 0 ? 'btn-status-active' : ''}" onclick="setStatus(event, ${iid}, 0)">\ud83d\udccb To Do</button>
            <button class="btn btn-ghost btn-sm ${st === 1 ? 'btn-status-active btn-status-ip' : ''}" onclick="setStatus(event, ${iid}, 1)">\u23f3 In Progress</button>
            <button class="btn btn-ghost btn-sm ${st === 2 ? 'btn-status-active btn-status-done' : ''}" onclick="setStatus(event, ${iid}, 2)">\u2705 Done</button>
          </div>
          <div class="item-detail-actions">
            <button class="btn btn-ghost btn-sm" onclick="openItemModal(${sid}, ${iid})">&#9998; Edit</button>
            <button class="btn btn-ghost btn-sm" onclick="copyItem(event, ${iid})">&#128203; Copy</button>
            <button class="btn btn-ghost btn-sm" onclick="shareItem(event, ${iid})">&#8599; Share</button>
            ${recurSelect}
            ${dueDate ? `<button class="btn btn-ghost btn-sm" onclick="addToCalendar(event, ${iid})">&#128197; Add to Calendar</button>` : ''}
            <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteItem(${iid})">&#10005; Delete</button>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="item ${statusCls} ${expandedCls}" data-item-id="${iid}"
         ondragover="onItemDragOver(event, ${iid})"
         ondragleave="onItemDragLeave(event)"
         ondrop="onItemDrop(event, ${iid})">
      <div class="item-row" onclick="toggleExpand(${iid})">
        <span class="item-drag" draggable="true" ondragstart="onItemDragStart(event, ${iid})"
              onclick="event.stopPropagation()" title="Drag to move item" aria-label="Drag to move item">&#9776;</span>
        <div class="item-checkbox ${checkboxCls}" onclick="toggleComplete(event, ${iid})">${checkboxContent}</div>
        <div class="item-main">
          <span class="item-title-text">${esc(title)}</span>
          <div class="item-meta-row">
            <div class="item-indicators">${dueBadge}${recurTimeBadge}${recurBadge}${followupBadge}${hasDesc}${hasLink}</div>
            <div class="item-quick-actions">
              <button class="item-quick-btn" title="Copy" onclick="copyItem(event, ${iid})">&#128203;</button>
              <button class="item-quick-btn" title="Share" aria-label="Share item" onclick="shareItem(event, ${iid})">&#8599;</button>
              <button class="item-quick-btn" title="Edit" onclick="event.stopPropagation(); openItemModal(${sid}, ${iid})">&#9998;</button>
            </div>
            <span class="expand-arrow">&#9654;</span>
          </div>
        </div>
      </div>
      ${detail}
    </div>`;
}


/* ================================================================
   Follow-ups
   ================================================================ */

function renderFollowups(iid) {
  const res = db.exec('SELECT id, text, completed FROM followups WHERE item_id = ? ORDER BY completed ASC, sort_order ASC, id ASC', [iid]);
  const rows = (res.length && res[0].values) ? res[0].values : [];

  let list = '';
  if (rows.length) {
    list = rows.map(([fid, text, completed]) => {
      if (fid === editingFollowupId) {
        return `
      <div class="followup followup-editing">
        <input type="text" class="followup-input followup-edit-input" value="${escAttr(text)}"
               onkeydown="if(event.key==='Enter'){event.preventDefault();saveFollowupEdit(event, ${fid}, ${iid});}else if(event.key==='Escape'){cancelFollowupEdit(event);}">
        <button class="btn btn-ghost btn-sm" onclick="saveFollowupEdit(event, ${fid}, ${iid})">Save</button>
        <button class="btn btn-ghost btn-sm" onclick="cancelFollowupEdit(event)">Cancel</button>
      </div>`;
      }
      return `
      <div class="followup ${completed ? 'followup-done' : ''}">
        <div class="followup-check" onclick="toggleFollowup(event, ${fid}, ${iid})">${completed ? '&#10003;' : ''}</div>
        <span class="followup-text" ondblclick="startFollowupEdit(event, ${fid})">${esc(text)}</span>
        <button class="followup-edit" title="Edit follow-up" onclick="startFollowupEdit(event, ${fid})">&#9998;</button>
        <button class="followup-del" title="Delete follow-up" onclick="deleteFollowup(event, ${fid})">&#10005;</button>
      </div>`;
    }).join('');
  } else {
    list = '<div class="followup-empty">No follow-ups yet</div>';
  }

  return `
    <div class="item-followups-section" onclick="event.stopPropagation()">
      <div class="followups-header">&#128257; Follow-ups</div>
      <div class="followups-list">${list}</div>
      <div class="followup-add">
        <input type="text" class="followup-input" placeholder="Add a follow-up..."
               onkeydown="if(event.key==='Enter'){event.preventDefault();addFollowup(event, ${iid});}">
        <button class="btn btn-ghost btn-sm" onclick="addFollowup(event, ${iid})">Add</button>
      </div>
    </div>`;
}

function addFollowup(event, iid) {
  event.stopPropagation();
  const wrap = event.target.closest('.followup-add');
  const input = wrap ? wrap.querySelector('.followup-input') : null;
  if (!input) return;
  const text = input.value.trim();
  if (!text) { input.focus(); return; }

  const maxOrder = db.exec('SELECT COALESCE(MAX(sort_order), 0) FROM followups WHERE item_id = ?', [iid]);
  db.run('INSERT INTO followups (item_id, text, sort_order) VALUES (?, ?, ?)',
    [iid, text, maxOrder[0].values[0][0] + 1]);
  persist();
  renderMain();
  createBackup('new-followup', { silent: true }).catch(() => {});
  toast('Follow-up added');
}

function toggleFollowup(event, fid, iid) {
  event.stopPropagation();
  const row = db.exec('SELECT completed FROM followups WHERE id = ?', [fid]);
  const cur = (row.length && row[0].values[0][0]) ? row[0].values[0][0] : 0;
  db.run('UPDATE followups SET completed = ? WHERE id = ?', [cur ? 0 : 1, fid]);
  persist();
  renderMain();
}

function deleteFollowup(event, fid) {
  event.stopPropagation();
  db.run('DELETE FROM followups WHERE id = ?', [fid]);
  persist();
  renderMain();
  toast('Follow-up deleted');
}

function startFollowupEdit(event, fid) {
  event.stopPropagation();
  editingFollowupId = fid;
  renderMain();
  requestAnimationFrame(() => {
    const input = document.querySelector('.followup-edit-input');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}

function saveFollowupEdit(event, fid, iid) {
  event.stopPropagation();
  const wrap = event.target.closest('.followup');
  const input = wrap ? wrap.querySelector('.followup-edit-input') : null;
  if (!input) return;
  const text = input.value.trim();
  if (!text) { input.focus(); return; }

  db.run('UPDATE followups SET text = ? WHERE id = ?', [text, fid]);
  editingFollowupId = null;
  persist();
  renderMain();
  toast('Follow-up updated');
}

function cancelFollowupEdit(event) {
  if (event) event.stopPropagation();
  editingFollowupId = null;
  renderMain();
}


function toggleExpand(iid) {
  const protection = getItemProtection(iid);
  if (protection && protection.isProtected && isItemLocked(iid, 1)) {
    requestItemUnlock(iid, 'expand');
    return;
  }
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

function toggleKanbanCol(col) {
  if (col === 'todo') todoCollapsed = !todoCollapsed;
  else if (col === 'ip') inProgressCollapsed = !inProgressCollapsed;
  else if (col === 'done') doneCollapsed = !doneCollapsed;
  renderMain();
}


/* ================================================================
   Navigation
   ================================================================ */

function selectSection(id) {
  activeView = 'board';
  activeSectionId = id;
  localStorage.setItem('dashora_active_section', id);
  expandedItems.clear();
  sectionSearchTerm = '';
  renderSidebar();
  renderMain();
  closeSidebar();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const isOpen = sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('active', isOpen);
  document.querySelectorAll('.sidebar-toggle').forEach(button => {
    button.setAttribute('aria-expanded', String(isOpen));
    button.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
  });
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  const overlay = document.getElementById('sidebarOverlay');
  if (overlay) overlay.classList.remove('active');
  document.querySelectorAll('.sidebar-toggle').forEach(button => {
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Open navigation menu');
  });
}


/* ================================================================
   Drag & Drop – Items
   ================================================================ */

function onItemDragStart(e, iid) {
  e.stopPropagation();
  dragItemId = iid;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', iid);
  const item = e.currentTarget.closest('.item');
  e.dataTransfer.setDragImage(item, 0, 0);
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
  e.stopPropagation();
  document.querySelectorAll('.item').forEach(el => {
    el.classList.remove('dragging');
    el.style.borderTop = '';
  });

  if (dragItemId === targetId || !dragItemId) return;

  // If dropped onto an item in a different status column, also change status
  const targetStatus = db.exec('SELECT status FROM items WHERE id = ?', [targetId]);
  const dragStatus = db.exec('SELECT status FROM items WHERE id = ?', [dragItemId]);
  if (targetStatus.length && dragStatus.length) {
    const tSt = targetStatus[0].values[0][0] || 0;
    const dSt = dragStatus[0].values[0][0] || 0;
    if (tSt !== dSt) {
      const completed = tSt === 2 ? 1 : 0;
      const completedAt = tSt === 2 ? new Date().toISOString() : null;
      db.run('UPDATE items SET status = ?, completed = ?, completed_at = ? WHERE id = ?', [tSt, completed, completedAt, dragItemId]);
    }
  }

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
  renderSidebar();
  toast('Item moved');
}


/* ================================================================
   Drag & Drop – Column (change status by dropping onto column)
   ================================================================ */

function onColumnDragOver(e, status) {
  e.preventDefault();
  e.currentTarget.classList.add('kanban-col-dragover');
}

function onColumnDragLeave(e) {
  e.currentTarget.classList.remove('kanban-col-dragover');
}

function onColumnDrop(e, status) {
  e.preventDefault();
  e.currentTarget.classList.remove('kanban-col-dragover');
  document.querySelectorAll('.item').forEach(el => {
    el.classList.remove('dragging');
    el.style.borderTop = '';
  });

  if (!dragItemId) return;

  const completed = status === 2 ? 1 : 0;
  const completedAt = status === 2 ? new Date().toISOString() : null;
  db.run('UPDATE items SET completed_at = CASE WHEN status = ? THEN completed_at ELSE ? END, status = ?, completed = ? WHERE id = ?', [status, completedAt, status, completed, dragItemId]);

  persist();
  dragItemId = null;
  renderMain();
  renderSidebar();
  const labels = ['To Do', 'In Progress', 'Done'];
  toast(`Moved to ${labels[status]}`);
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

  const secRes = db.exec('SELECT id FROM sections ORDER BY prioritized DESC, CASE WHEN prioritized = 1 THEN sort_order END ASC, created_at DESC, id DESC');
  if (!secRes.length) return;

  let ids = secRes[0].values.map(r => r[0]);
  ids = ids.filter(id => id !== dragSectionId);
  const targetIdx = ids.indexOf(targetSid);
  ids.splice(targetIdx, 0, dragSectionId);

  // Mark all reordered boards as prioritized and assign sort_order
  ids.forEach((id, i) => db.run('UPDATE sections SET sort_order = ?, prioritized = 1 WHERE id = ?', [i, id]));

  dragSectionId = null;
  persist();
  renderSidebar();
  toast('Board moved');
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
    activeView = 'board';
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
           i.recurring, i.section_id, s.name, s.color, i.status, i.due_date,
        s.type, i.protected, i.encrypted, i.sketch_data, i.description_format
    FROM items i
    JOIN sections s ON i.section_id = s.id
    ORDER BY s.sort_order, i.sort_order
  `);

  const allRows = (res.length ? res[0].values : []).map(row => {
    if (row[13] !== 1) return row;
    const payload = decryptedProtectedItems.get(row[0]);
    if (!payload) return row;
    const hydrated = [...row];
    hydrated[1] = payload.title || '';
    hydrated[2] = payload.description || '';
    hydrated[3] = payload.link || '';
    hydrated[14] = payload.sketchData || null;
    return hydrated;
  });
  const rows = allRows.filter(row => {
    if (row[11] === 'reference' && isItemLocked(row[0], row[12])) return false;
    return (row[1] || '').toLowerCase().includes(term)
      || (row[2] || '').toLowerCase().includes(term);
  });

  header.innerHTML = `
    <div class="main-header-left">
      <button class="sidebar-toggle" type="button" aria-label="Open navigation menu" aria-controls="sidebar" aria-expanded="false" onclick="toggleSidebar()">&#9776;</button>
      <h2>Search Results</h2>
      <span class="item-total">${rows.length} match${rows.length !== 1 ? 'es' : ''}</span>
    </div>`;

  if (rows.length === 0) {
    body.innerHTML = '<div class="empty-state"><h3>No matches</h3><p>Try different keywords</p></div>';
    return;
  }

  let html = '';
  let currentSection = null;

  for (const [iid, title, desc, link, completed, recurring, secId, secName, secColor,
    status, dueDate, sectionType, isProtected, isEncrypted, sketchData, descriptionFormat] of rows) {
    if (secId !== currentSection) {
      currentSection = secId;
      html += `
        <div style="display:flex;align-items:center;gap:8px;margin:18px 0 8px;cursor:pointer;"
             onclick="selectSection(${secId})">
          <div style="width:10px;height:10px;border-radius:3px;background:${escAttr(secColor)}"></div>
          <span style="font-size:13px;font-weight:600;color:var(--text-muted)">${esc(secName)}</span>
        </div>`;
    }
    if (sectionType === 'reference') {
      html += renderRefItem(
        iid, title, desc, link, expandedItems.has(iid), secId, sketchData, isProtected, isEncrypted, descriptionFormat
      );
    } else {
      html += renderItem(iid, title, desc, link, completed, recurring, status || 0, expandedItems.has(iid), secId, dueDate, descriptionFormat);
    }
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
  db.run('UPDATE items SET completed_at = CASE WHEN status = ? THEN completed_at ELSE ? END, status = ?, completed = ? WHERE id = ?', [status, completedAt, status, completed, id]);
  persist();
  renderMain();
  renderSidebar();
  const labels = ['To Do', 'In Progress', 'Done'];
  toast(`Moved to ${labels[status]}`);
}

function toggleRecurring(event, id) {
  event.stopPropagation();
  const row = db.exec('SELECT recurring FROM items WHERE id = ?', [id]);
  const cur = row[0].values[0][0] || 0;
  const next = (cur + 1) % 5;
  db.run('UPDATE items SET recurring = ? WHERE id = ?', [next, id]);
  persist();
  renderMain();
  const labels = { 0: 'Recurring off', 1: 'Daily', 2: 'Weekly', 3: 'Biweekly', 4: 'Monthly' };
  toast(labels[next]);
}

function setRecurring(event, id, value) {
  event.stopPropagation();
  const val = parseInt(value) || 0;
  if (val === 5) {
    // Save recurring=5 first, then open modal to pick days
    db.run('UPDATE items SET recurring = 5 WHERE id = ?', [id]);
    persist();
    const secRes = db.exec('SELECT section_id FROM items WHERE id = ?', [id]);
    if (secRes.length) {
      openItemModal(secRes[0].values[0][0], id);
      // Highlight the recurring days section
      const wrap = document.getElementById('recurringDaysWrap');
      wrap.classList.add('recurring-days-highlight');
      wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => wrap.classList.remove('recurring-days-highlight'), 2500);
    }
    return;
  }
  db.run('UPDATE items SET recurring = ?, recurring_days = NULL WHERE id = ?', [val, id]);
  persist();
  renderMain();
  const labels = { 0: 'Recurring off', 1: 'Daily', 2: 'Weekly', 3: 'Biweekly', 4: 'Monthly' };
  toast(labels[val]);
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
    titleEl.textContent = 'Edit Board';
    const row = db.exec('SELECT name, color, type FROM sections WHERE id = ?', [editId]);
    if (row.length) {
      nameInput.value   = row[0].values[0][0];
      selectedColor     = row[0].values[0][1];
      selectedBoardType = row[0].values[0][2] || 'task';
    }
    editInput.value = editId;
  } else {
    titleEl.textContent = 'New Board';
    nameInput.value   = '';
    selectedColor     = COLORS[Math.floor(Math.random() * COLORS.length)];
    selectedBoardType = 'task';
    editInput.value   = '';
  }

  renderColors();
  renderBoardTypeOptions();
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

function pickBoardType(type) { selectedBoardType = type; renderBoardTypeOptions(); }

function renderBoardTypeOptions() {
  document.querySelectorAll('.board-type-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.type === selectedBoardType);
  });
}

function saveSection() {
  const name   = document.getElementById('sectionName').value.trim();
  const editId = document.getElementById('editSectionId').value;
  let createdBoard = false;
  if (!name) { toast('Board name is required'); return; }

  if (editId) {
    db.run('UPDATE sections SET name = ?, color = ?, type = ? WHERE id = ?', [name, selectedColor, selectedBoardType, parseInt(editId)]);
  } else {
    createdBoard = true;
    const maxOrder = db.exec('SELECT COALESCE(MAX(sort_order), 0) FROM sections');
    db.run('INSERT INTO sections (name, color, sort_order, type) VALUES (?, ?, ?, ?)',
      [name, selectedColor, maxOrder[0].values[0][0] + 1, selectedBoardType]);
    activeSectionId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  }

  persist();
  closeModal('sectionModal');
  renderSidebar();
  renderMain();

  if (createdBoard) {
    createBackup('new-board', { silent: true }).catch(() => {});
  }

  toast(editId ? 'Board updated' : 'Board created');
}

function deleteSection(id) {
  if (!confirm('Delete this board and all its items?')) return;
  db.run('DELETE FROM followups WHERE item_id IN (SELECT id FROM items WHERE section_id = ?)', [id]);
  db.run('DELETE FROM items WHERE section_id = ?', [id]);
  db.run('DELETE FROM sections WHERE id = ?', [id]);

  if (activeSectionId === id) {
    const first = db.exec('SELECT id FROM sections ORDER BY prioritized DESC, CASE WHEN prioritized = 1 THEN sort_order END ASC, created_at DESC, id DESC LIMIT 1');
    activeSectionId = (first.length && first[0].values.length) ? first[0].values[0][0] : null;
  }

  persist();
  renderSidebar();
  renderMain();
  toast('Board deleted');
}


/* ================================================================
   Item CRUD
   ================================================================ */

function onItemProtectionChange() {
  const enabled = document.getElementById('itemProtected').checked;
  document.getElementById('itemPasswordOptions').style.display = enabled ? '' : 'none';
  if (!enabled) document.getElementById('itemEncrypted').checked = false;
  onItemEncryptionChange();
}

function onItemPasswordSourceChange() {
  const source = document.querySelector('input[name="itemPasswordSource"]:checked').value;
  document.getElementById('itemCustomPasswordGroup').style.display = source === 'custom' ? '' : 'none';
  onItemEncryptionChange();
}

function onItemEncryptionChange() {
  const encrypted = document.getElementById('itemProtected').checked
    && document.getElementById('itemEncrypted').checked;
  if (!encrypted) {
    document.getElementById('itemProtectionHint').textContent = 'Without encryption, protection only hides content inside the app.';
    return;
  }

  const source = document.querySelector('input[name="itemPasswordSource"]:checked').value;
  const hasNewItemPassword = source === 'custom' && !!document.getElementById('itemPassword').value;
  document.getElementById('itemProtectionHint').textContent = hasNewItemPassword
    ? 'Content will be encrypted with the new item password when saved.'
    : `Save will ask for the ${source === 'global' ? 'global' : 'item'} password. The derived key is not stored or cached.`;
}

function requestEncryptionPassword(source, errorText = '') {
  const isGlobal = source === 'global';
  document.getElementById('encryptionPasswordModalTitle').textContent = isGlobal
    ? 'Confirm global password'
    : 'Confirm item password';
  document.getElementById('encryptionPasswordLabel').textContent = isGlobal
    ? 'Global Password'
    : 'Item Password';
  document.getElementById('encryptionPasswordHint').textContent = 'Used only for this encryption operation. It will not be stored or cached.';
  document.getElementById('encryptionPasswordError').textContent = errorText;
  document.getElementById('encryptionPasswordPrompt').value = '';
  document.getElementById('encryptionPasswordModal').classList.add('active');
  requestAnimationFrame(() => document.getElementById('encryptionPasswordPrompt').focus());

  return new Promise(resolve => {
    encryptionPasswordPromptResolve = resolve;
  });
}

function finishEncryptionPasswordPrompt(password) {
  const resolve = encryptionPasswordPromptResolve;
  encryptionPasswordPromptResolve = null;
  document.getElementById('encryptionPasswordPrompt').value = '';
  document.getElementById('encryptionPasswordError').textContent = '';
  closeModal('encryptionPasswordModal');
  if (resolve) resolve(password);
}

function submitEncryptionPasswordPrompt() {
  const input = document.getElementById('encryptionPasswordPrompt');
  if (!input.value) {
    document.getElementById('encryptionPasswordError').textContent = 'Password is required';
    input.focus();
    return;
  }
  finishEncryptionPasswordPrompt(input.value);
}

function cancelEncryptionPasswordPrompt() {
  finishEncryptionPasswordPrompt(null);
}

async function resolveItemProtection(editId, isReference) {
  if (!isReference || !document.getElementById('itemProtected').checked) {
    return { isProtected: 0, passwordHash: null, passwordSalt: null, passwordIterations: PASSWORD_ITERATIONS };
  }

  const source = document.querySelector('input[name="itemPasswordSource"]:checked').value;
  if (source === 'global') {
    if (!hasGlobalPassword()) {
      toast('Set a global password or choose an item password');
      return null;
    }
    return { isProtected: 1, passwordHash: null, passwordSalt: null, passwordIterations: PASSWORD_ITERATIONS };
  }

  const password = document.getElementById('itemPassword').value;
  const confirmation = document.getElementById('itemPasswordConfirm').value;
  if (password || confirmation) {
    if (password.length < 8) {
      toast('Item password must be at least 8 characters');
      return null;
    }
    if (password !== confirmation) {
      toast('Item passwords do not match');
      return null;
    }
    const credential = await createPasswordCredential(password);
    return {
      isProtected: 1,
      passwordHash: credential.hash,
      passwordSalt: credential.salt,
      passwordIterations: credential.iterations,
    };
  }

  if (editId) {
    const existing = getItemProtection(parseInt(editId, 10));
    if (existing && existing.passwordHash && existing.passwordSalt) {
      return {
        isProtected: 1,
        passwordHash: existing.passwordHash,
        passwordSalt: existing.passwordSalt,
        passwordIterations: existing.passwordIterations,
      };
    }
  }

  toast('Enter and confirm an item password');
  return null;
}

async function resolveItemEncryption(protection, payload) {
  if (!protection.isProtected || !document.getElementById('itemEncrypted').checked) {
    return {
      isEncrypted: 0,
      encryptedData: null,
      encryptionIv: null,
      encryptionVersion: null,
    };
  }

  const source = document.querySelector('input[name="itemPasswordSource"]:checked').value;
  const newItemPassword = document.getElementById('itemPassword').value;
  const expectedHash = protection.passwordHash || getAppSetting('password_hash');
  const salt = protection.passwordSalt || getAppSetting('password_salt');
  const iterations = protection.passwordHash
    ? protection.passwordIterations
    : parseInt(getAppSetting('password_iterations') || PASSWORD_ITERATIONS, 10);

  let password = source === 'custom' && newItemPassword ? newItemPassword : null;
  let material = null;
  let errorText = '';
  while (!material) {
    if (!password) {
      password = await requestEncryptionPassword(source, errorText);
      if (password === null) return null;
    }

    const candidate = await derivePasswordMaterial(password, salt, iterations);
    password = null;
    if (hashesMatch(candidate.verifier, expectedHash)) {
      material = candidate;
    } else {
      errorText = `Incorrect ${source === 'global' ? 'global' : 'item'} password`;
    }
  }

  return {
    isEncrypted: 1,
    ...await encryptPayloadWithKey(payload, material.encryptionKey),
  };
}

function onDescriptionFormatChange() {
  const isMarkdown = document.getElementById('itemDescFormat').value === 'markdown';
  document.getElementById('descriptionViews').hidden = !isMarkdown;
  document.getElementById('itemDescHint').hidden = !isMarkdown;
  const input = document.getElementById('itemDesc');
  input.classList.toggle('markdown-editor', isMarkdown);
  input.placeholder = isMarkdown
    ? 'Write Markdown: **bold**, - lists, `code`...'
    : 'Details, notes, context...';
  setDescriptionEditorMode('write');
}

function onDescriptionPaste(event) {
  if (document.getElementById('itemDescFormat').value !== 'markdown' || !event.clipboardData) return;
  const html = event.clipboardData.getData('text/html');
  if (!html.trim()) return;
  let markdown;
  try {
    markdown = convertDescriptionHtmlToMarkdown(html);
  } catch (error) {
    console.error('Formatted description paste failed', error);
    toast('Could not convert formatted text. Pasting plain text instead.');
    return;
  }
  if (!markdown) return;
  event.preventDefault();
  const input = event.currentTarget;
  // Native insertion preserves the editor's undo history where supported.
  if (!document.execCommand('insertText', false, markdown)) {
    input.setRangeText(markdown, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function setDescriptionEditorMode(mode) {
  const preview = mode === 'preview' && document.getElementById('itemDescFormat').value === 'markdown';
  document.getElementById('itemDesc').hidden = preview;
  document.getElementById('itemDescPreview').hidden = !preview;
  document.getElementById('descriptionWrite').setAttribute('aria-pressed', String(!preview));
  document.getElementById('descriptionPreview').setAttribute('aria-pressed', String(preview));
  if (preview) {
    updateDescriptionPreview();
  } else {
    document.getElementById('itemDescPreview').replaceChildren();
  }
}

function updateDescriptionPreview() {
  const preview = document.getElementById('itemDescPreview');
  if (preview.hidden) return;
  const source = document.getElementById('itemDesc').value;
  preview.innerHTML = source.trim()
    ? renderDescriptionContent(source, 'markdown')
    : '<span class="description-preview-empty">Nothing to preview yet.</span>';
}

function readItemDescription() {
  const format = document.getElementById('itemDescFormat').value;
  if (format !== 'plain' && format !== 'markdown') {
    toast('Choose a valid description format');
    return null;
  }
  const source = document.getElementById('itemDesc').value;
  return { format, source: format === 'markdown' ? source : source.trim() };
}

function openItemModal(sectionId, editId) {
  if (editId) {
    const protection = getItemProtection(editId);
    if (protection && protection.isProtected && isItemLocked(editId, 1)) {
      requestItemUnlock(editId, 'edit');
      return;
    }
  }

  const modal      = document.getElementById('itemModal');
  const titleEl    = document.getElementById('itemModalTitle');
  const titleInput = document.getElementById('itemTitle');
  const descInput  = document.getElementById('itemDesc');
  const formatInput = document.getElementById('itemDescFormat');
  const linkInput  = document.getElementById('itemLink');
  const editInput  = document.getElementById('editItemId');
  const secInput   = document.getElementById('itemSectionId');
  secInput.value   = sectionId;

  // Hide recurring toggle and due date for reference boards, show sketch group
  const secType = db.exec('SELECT type FROM sections WHERE id = ?', [sectionId]);
  const isRef = secType.length && secType[0].values[0][0] === 'reference';
  document.getElementById('recurringGroup').style.display = isRef ? 'none' : '';
  document.getElementById('dueDateGroup').style.display = isRef ? 'none' : '';
  document.getElementById('sketchGroup').style.display = isRef ? '' : 'none';
  document.getElementById('secretProtectionGroup').style.display = isRef ? '' : 'none';
  document.getElementById('itemPassword').value = '';
  document.getElementById('itemPasswordConfirm').value = '';

  // Reset sketch state
  sketchActive = false;
  document.getElementById('sketchCanvasSection').style.display = 'none';
  document.getElementById('sketchToggleWrap').style.display = '';
  document.getElementById('sketchToggleBtn').textContent = '\u270E Add sketch';

  // Widen modal for reference boards (to fit canvas)
  document.getElementById('itemModalInner').classList.toggle('item-modal-wide', isRef);

  if (editId) {
    titleEl.textContent = 'Edit Item';
    const row = db.exec(`
      SELECT title, description, link, recurring, sketch_data, due_date,
             recurring_days, recurring_time, protected, password_hash, password_salt,
             password_iterations, description_format
      FROM items WHERE id = ?`, [editId]);
    if (row.length) {
      const protection = getItemProtection(editId);
      const decrypted = protection && protection.isEncrypted
        ? decryptedProtectedItems.get(parseInt(editId, 10))
        : null;
      titleInput.value = decrypted ? decrypted.title || '' : row[0].values[0][0] || '';
      descInput.value  = decrypted ? decrypted.description || '' : row[0].values[0][1] || '';
      formatInput.value = row[0].values[0][12];
      linkInput.value  = decrypted ? decrypted.link || '' : row[0].values[0][2] || '';
      document.getElementById('itemRecurring').value = row[0].values[0][3] || 0;

      // Recurring days
      const recurVal = row[0].values[0][3] || 0;
      document.getElementById('recurringDaysWrap').style.display = recurVal == 5 ? '' : 'none';
      setRecurringDaysCheckboxes(row[0].values[0][6] || '');

      // Recurring time
      const recurTimeVal = row[0].values[0][7] || '';
      document.getElementById('recurringTimeWrap').style.display = recurVal != 0 ? '' : 'none';
      document.getElementById('itemRecurringTime').value = recurTimeVal;
      document.getElementById('recurringTimeClearBtn').style.display = recurTimeVal ? '' : 'none';

      const itemIsProtected = row[0].values[0][8] === 1;
      const hasItemPassword = !!(row[0].values[0][9] && row[0].values[0][10]);
      document.getElementById('itemProtected').checked = itemIsProtected;
      document.querySelector(`input[name="itemPasswordSource"][value="${hasItemPassword ? 'custom' : 'global'}"]`).checked = true;
      document.getElementById('itemEncrypted').checked = !!(protection && protection.isEncrypted);
      onItemProtectionChange();
      onItemPasswordSourceChange();

      // Due date
      const dueVal = row[0].values[0][5] || '';
      document.getElementById('itemDueDate').value = dueVal;
      document.getElementById('dueDateClearBtn').style.display = dueVal ? '' : 'none';

      // If item has sketch data, show the canvas with the sketch loaded
      const sketchValue = decrypted ? decrypted.sketchData : row[0].values[0][4];
      if (isRef && sketchValue) {
        sketchActive = true;
        document.getElementById('sketchCanvasSection').style.display = '';
        document.getElementById('sketchToggleWrap').style.display = 'none';
        // Canvas init after modal is visible
        requestAnimationFrame(() => {
          initSketchCanvas();
          const imgData = sketchValue;
          const img = new Image();
          img.onload = () => {
            const canvas = document.getElementById('sketchCanvas');
            const dpr = window.devicePixelRatio || 1;
            sketchCtx.drawImage(img, 0, 0, canvas.width / dpr, canvas.height / dpr);
          };
          img.src = imgData;
        });
      }
    }
    editInput.value = editId;
  } else {
    titleEl.textContent = 'New Item';
    titleInput.value = '';
    descInput.value  = '';
    formatInput.value = 'plain';
    linkInput.value  = '';
    editInput.value  = '';
    document.getElementById('itemRecurring').value = 0;
    document.getElementById('recurringDaysWrap').style.display = 'none';
    setRecurringDaysCheckboxes('');
    document.getElementById('recurringTimeWrap').style.display = 'none';
    document.getElementById('itemRecurringTime').value = '';
    document.getElementById('recurringTimeClearBtn').style.display = 'none';
    document.getElementById('itemDueDate').value = '';
    document.getElementById('dueDateClearBtn').style.display = 'none';
    document.getElementById('itemProtected').checked = false;
    document.getElementById('itemEncrypted').checked = false;
    document.querySelector(`input[name="itemPasswordSource"][value="${hasGlobalPassword() ? 'global' : 'custom'}"]`).checked = true;
    onItemProtectionChange();
    onItemPasswordSourceChange();
  }

  onDescriptionFormatChange();
  modal.classList.add('active');
  titleInput.focus();
}

function toggleSketchCanvas() {
  sketchActive = true;
  document.getElementById('sketchCanvasSection').style.display = '';
  document.getElementById('sketchToggleWrap').style.display = 'none';
  requestAnimationFrame(() => initSketchCanvas());
}

function removeSketch() {
  sketchActive = false;
  // Clear and hide canvas
  const canvas = document.getElementById('sketchCanvas');
  const newCanvas = canvas.cloneNode(true);
  canvas.parentNode.replaceChild(newCanvas, canvas);
  sketchHistory = [];
  sketchDrawing = false;
  sketchLastPoint = null;
  sketchCtx = null;
  document.getElementById('sketchCanvasSection').style.display = 'none';
  document.getElementById('sketchToggleWrap').style.display = '';
}

function closeItemModal() {
  // Clean up canvas if active
  if (sketchActive) {
    const canvas = document.getElementById('sketchCanvas');
    const newCanvas = canvas.cloneNode(true);
    canvas.parentNode.replaceChild(newCanvas, canvas);
    sketchHistory = [];
    sketchDrawing = false;
    sketchLastPoint = null;
    sketchCtx = null;
    sketchActive = false;
  }
  document.getElementById('itemPassword').value = '';
  document.getElementById('itemPasswordConfirm').value = '';
  setDescriptionEditorMode('write');
  clearTimeout(autoSaveTimer);
  closeModal('itemModal');
  renderSidebar();
  renderMain();
}

async function saveItem() {
  if (itemSaveInProgress) {
    toast('Save already in progress');
    return;
  }

  itemSaveInProgress = true;
  try {
    await saveItemOnce();
  } finally {
    itemSaveInProgress = false;
  }
}

async function saveItemOnce() {
  const title     = document.getElementById('itemTitle').value.trim();
  const description = readItemDescription();
  if (!description) return;
  const desc = description.source;
  const descriptionFormat = description.format;
  const link      = document.getElementById('itemLink').value.trim();
  const recurring = parseInt(document.getElementById('itemRecurring').value) || 0;
  const editId    = document.getElementById('editItemId').value;
  const sectionId = parseInt(document.getElementById('itemSectionId').value);
  const createdItem = !editId;
  const sectionType = db.exec('SELECT type FROM sections WHERE id = ?', [sectionId]);
  const isReference = sectionType.length && sectionType[0].values[0][0] === 'reference';

  if (!title) { toast('Title is required'); return; }
  if (link && !link.match(/^https?:\/\/.+/i)) {
    toast('Link must start with http:// or https://');
    return;
  }

  const dueDate = document.getElementById('itemDueDate').value || null;
  const recurringDays = recurring === 5 ? getSelectedRecurringDays() : null;
  const recurringTime = recurring ? (document.getElementById('itemRecurringTime').value || null) : null;
  const protection = await resolveItemProtection(editId, isReference);
  if (!protection) return;

  // Get sketch data if canvas is active
  let sketchDataURL = null;
  if (sketchActive && sketchCtx) {
    const canvas = document.getElementById('sketchCanvas');
    const pixels = sketchCtx.getImageData(0, 0, canvas.width, canvas.height).data;
    let isBlank = true;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 0) { isBlank = false; break; }
    }
    if (!isBlank) {
      sketchDataURL = canvas.toDataURL('image/png');
    }
  }

  const encryption = await resolveItemEncryption(protection, {
    title,
    description: desc,
    link,
    sketchData: sketchDataURL,
  });
  if (!encryption) return;

  const storedTitle = encryption.isEncrypted ? 'Encrypted item' : title;
  const storedDescription = encryption.isEncrypted ? '' : desc;
  const storedLink = encryption.isEncrypted ? '' : link;
  const storedSketch = encryption.isEncrypted ? null : sketchDataURL;

  if (editId) {
    db.run(`UPDATE items
            SET title = ?, description = ?, description_format = ?, link = ?, recurring = ?, sketch_data = ?,
                due_date = ?, recurring_days = ?, recurring_time = ?, protected = ?,
                password_hash = ?, password_salt = ?, password_iterations = ?,
                encrypted = ?, encrypted_data = ?, encryption_iv = ?, encryption_version = ?
            WHERE id = ?`,
      [storedTitle, storedDescription, descriptionFormat, storedLink, recurring, storedSketch, dueDate, recurringDays, recurringTime,
       protection.isProtected, protection.passwordHash, protection.passwordSalt, protection.passwordIterations,
       encryption.isEncrypted, encryption.encryptedData, encryption.encryptionIv,
       encryption.encryptionVersion, parseInt(editId)]);
  } else {
    const maxOrder = db.exec('SELECT COALESCE(MAX(sort_order), 0) FROM items WHERE section_id = ?', [sectionId]);
    db.run(`INSERT INTO items
            (section_id, title, description, description_format, link, recurring, sort_order, sketch_data,
             due_date, recurring_days, recurring_time, protected, password_hash, password_salt,
             password_iterations, encrypted, encrypted_data, encryption_iv, encryption_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sectionId, storedTitle, storedDescription, descriptionFormat, storedLink, recurring,
       maxOrder[0].values[0][0] + 1, storedSketch,
       dueDate, recurringDays, recurringTime, protection.isProtected,
       protection.passwordHash, protection.passwordSalt, protection.passwordIterations,
       encryption.isEncrypted, encryption.encryptedData, encryption.encryptionIv,
       encryption.encryptionVersion]);
  }

  if (editId) {
    const itemId = parseInt(editId, 10);
    decryptedProtectedItems.delete(itemId);
    if (!protection.isProtected || encryption.isEncrypted) unlockedProtectedItems.delete(itemId);
  }

  persist();
  closeItemModal();
  renderSidebar();
  renderMain();
  checkDueDateNotifications();

  if (createdItem) {
    createBackup('new-item', { silent: true }).catch(() => {});
  }

  toast(editId ? 'Item updated' : 'Item added');
}

function deleteItem(id) {
  if (!confirm('Delete this item?')) return;
  expandedItems.delete(id);
  unlockedProtectedItems.delete(id);
  decryptedProtectedItems.delete(id);
  db.run('DELETE FROM followups WHERE item_id = ?', [id]);
  db.run('DELETE FROM items WHERE id = ?', [id]);
  persist();
  renderSidebar();
  renderMain();
  toast('Item deleted');
}

function copyItem(event, id) {
  if (event) event.stopPropagation();
  const protection = getItemProtection(id);
  if (protection && protection.isProtected && isItemLocked(id, 1)) {
    requestItemUnlock(id, 'copy');
    return;
  }
  if (protection && protection.isEncrypted) {
    const payload = decryptedProtectedItems.get(id);
    if (!payload) { requestItemUnlock(id, 'copy'); return; }
    copyItemText([payload.title, payload.description, payload.link].filter(Boolean).join('\n').trim());
    return;
  }

  const res = db.exec('SELECT title, description, link FROM items WHERE id = ?', [id]);
  if (!res.length) { toast('Nothing to copy'); return; }

  const [title, desc, link] = res[0].values[0];
  const text = [title, desc, link].filter(Boolean).join('\n').trim();
  copyItemText(text);
}

function copyItemText(text) {
  if (!text) { toast('Nothing to copy'); return; }

  const done = () => toast('Copied to clipboard');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      if (document.execCommand('copy')) done();
      else toast('Copy failed');
    }
    catch (e) { toast('Copy failed'); }
    document.body.removeChild(ta);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else {
    fallback();
  }
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
  const sections = db.exec('SELECT * FROM sections ORDER BY prioritized DESC, CASE WHEN prioritized = 1 THEN sort_order END ASC, created_at DESC, id DESC');
  const items    = db.exec('SELECT * FROM items ORDER BY section_id, sort_order, id');
  const followups = db.exec('SELECT * FROM followups ORDER BY item_id, sort_order, id');
  const appSettings = db.exec('SELECT * FROM app_settings ORDER BY key');

  const blob = new Blob(
    [JSON.stringify({ sections, items, followups, appSettings, exported: new Date().toISOString() }, null, 2)],
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
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.sections || !data.items) throw new Error('Invalid format');
      validateDescriptionFormats(data.items);
      if (!confirm('This will replace ALL current data. Continue?')) return;

      await createBackup('pre-import', { silent: true, force: true });

      db.run('DELETE FROM items');
      db.run('DELETE FROM sections');
      db.run('DELETE FROM followups');
      db.run('DELETE FROM app_settings');

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

      if (data.followups && data.followups.length && data.followups[0].values) {
        const cols = data.followups[0].columns
          ? data.followups[0].columns.join(', ')
          : 'id, item_id, text, completed, sort_order, created_at';
        const ph = data.followups[0].columns
          ? data.followups[0].columns.map(() => '?').join(', ')
          : '?, ?, ?, ?, ?, ?';
        for (const row of data.followups[0].values)
          db.run(`INSERT INTO followups (${cols}) VALUES (${ph})`, row);
      }

      if (data.appSettings && data.appSettings.length && data.appSettings[0].values) {
        for (const row of data.appSettings[0].values)
          db.run('INSERT INTO app_settings (key, value) VALUES (?, ?)', row);
      }

      const first = db.exec('SELECT id FROM sections ORDER BY prioritized DESC, CASE WHEN prioritized = 1 THEN sort_order END ASC, created_at DESC, id DESC LIMIT 1');
      activeSectionId = (first.length && first[0].values.length) ? first[0].values[0][0] : null;
      activeView = 'board';
      unlockedProtectedItems.clear();
      decryptedProtectedItems.clear();

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
  const notifEnabled = localStorage.getItem('dashora_notifications') === 'true';
  const autoSave = localStorage.getItem('dashora_autosave') === 'true';

  document.getElementById('autoDeleteEnabled').checked = enabled;
  document.getElementById('autoDeleteDays').value = days;
  document.getElementById('autoDeleteDelayGroup').style.display = enabled ? '' : 'none';
  document.getElementById('notificationsEnabled').checked = notifEnabled;
  document.getElementById('autoSaveEnabled').checked = autoSave;
  document.getElementById('currentGlobalPassword').value = '';
  document.getElementById('newGlobalPassword').value = '';
  document.getElementById('confirmGlobalPassword').value = '';

  const passwordConfigured = hasGlobalPassword();
  document.getElementById('globalPasswordStatus').textContent = passwordConfigured
    ? 'Global password is configured'
    : 'No global password configured';
  document.getElementById('currentGlobalPasswordGroup').style.display = passwordConfigured ? '' : 'none';
  document.getElementById('removeGlobalPasswordBtn').style.display = passwordConfigured ? '' : 'none';
  document.getElementById('newGlobalPasswordLabel').textContent = passwordConfigured ? 'New Password' : 'Password';

  // Toggle visibility when checkbox changes
  document.getElementById('autoDeleteEnabled').onchange = function () {
    document.getElementById('autoDeleteDelayGroup').style.display = this.checked ? '' : 'none';
  };

  document.getElementById('settingsModal').classList.add('active');
}

async function setGlobalPassword() {
  const currentPassword = document.getElementById('currentGlobalPassword').value;
  const newPassword = document.getElementById('newGlobalPassword').value;
  const confirmation = document.getElementById('confirmGlobalPassword').value;
  let currentMaterial = null;

  if (hasGlobalPassword()) {
    const currentIterations = parseInt(
      getAppSetting('password_iterations') || PASSWORD_ITERATIONS,
      10
    );
    currentMaterial = await derivePasswordMaterial(
      currentPassword,
      getAppSetting('password_salt'),
      currentIterations
    );
    if (!hashesMatch(currentMaterial.verifier, getAppSetting('password_hash'))) {
      toast('Current password is incorrect');
      return;
    }
  }

  if (newPassword.length < 8) {
    toast('Password must be at least 8 characters');
    return;
  }
  if (newPassword !== confirmation) {
    toast('New passwords do not match');
    return;
  }

  const newSalt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const newMaterial = await derivePasswordMaterial(newPassword, newSalt, PASSWORD_ITERATIONS);
  const encryptedRowsResult = db.exec(`
    SELECT id, encrypted_data, encryption_iv, encryption_version
    FROM items
    WHERE protected = 1 AND encrypted = 1
      AND (password_hash IS NULL OR password_salt IS NULL)
  `);
  const encryptedRows = encryptedRowsResult.length ? encryptedRowsResult[0].values : [];
  const reencryptedRows = [];

  if (encryptedRows.length && !currentMaterial) {
    toast('Current global password is required to update encrypted items');
    return;
  }

  try {
    for (const [itemId, encryptedData, encryptionIv, encryptionVersion] of encryptedRows) {
      const payload = await decryptPayloadWithKey(
        encryptedData,
        encryptionIv,
        currentMaterial.encryptionKey,
        encryptionVersion
      );
      const encrypted = await encryptPayloadWithKey(payload, newMaterial.encryptionKey);
      reencryptedRows.push({ itemId, ...encrypted });
    }
  } catch (error) {
    toast('Could not re-encrypt items; password was not changed');
    return;
  }

  db.run('BEGIN');
  try {
    for (const row of reencryptedRows) {
      db.run(`UPDATE items
              SET encrypted_data = ?, encryption_iv = ?, encryption_version = ?
              WHERE id = ?`,
        [row.encryptedData, row.encryptionIv, row.encryptionVersion, row.itemId]);
    }
    setAppSetting('password_hash', newMaterial.verifier);
    setAppSetting('password_salt', newSalt);
    setAppSetting('password_iterations', String(PASSWORD_ITERATIONS));
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    toast('Password update failed');
    return;
  }
  persist();
  unlockedProtectedItems.clear();
  decryptedProtectedItems.clear();
  openSettingsModal();
  toast('Global password updated');
}

async function removeGlobalPassword() {
  if (!hasGlobalPassword()) return;
  const currentPassword = document.getElementById('currentGlobalPassword').value;
  const valid = await passwordMatches(
    currentPassword,
    getAppSetting('password_hash'),
    getAppSetting('password_salt'),
    parseInt(getAppSetting('password_iterations') || PASSWORD_ITERATIONS, 10)
  );
  if (!valid) {
    toast('Enter the current password before removing it');
    return;
  }

  const dependentItems = db.exec(`
    SELECT COUNT(*) FROM items
    WHERE protected = 1 AND (password_hash IS NULL OR password_salt IS NULL)
  `)[0].values[0][0];
  if (dependentItems > 0) {
    toast(`${dependentItems} protected item${dependentItems === 1 ? '' : 's'} still use the global password`);
    return;
  }

  deleteAppSetting('password_hash');
  deleteAppSetting('password_salt');
  deleteAppSetting('password_iterations');
  persist();
  unlockedProtectedItems.clear();
  decryptedProtectedItems.clear();
  openSettingsModal();
  toast('Global password removed');
}

function saveSettings() {
  const enabled = document.getElementById('autoDeleteEnabled').checked;
  const days = document.getElementById('autoDeleteDays').value;
  const notifEnabled = document.getElementById('notificationsEnabled').checked;
  const autoSave = document.getElementById('autoSaveEnabled').checked;

  localStorage.setItem('dashora_autodelete_enabled', enabled ? 'true' : 'false');
  localStorage.setItem('dashora_autodelete_days', days);
  localStorage.setItem('dashora_notifications', notifEnabled ? 'true' : 'false');
  localStorage.setItem('dashora_autosave', autoSave ? 'true' : 'false');

  if (notifEnabled && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }

  closeModal('settingsModal');
  toast('Settings saved');

  // Show or hide reminder banner immediately
  if (notifEnabled) {
    checkDueDateNotifications();
  } else {
    document.getElementById('reminderBanners').innerHTML = '';
  }
}


/* ================================================================
   Global Event Listeners
   ================================================================ */

// Close modals on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    if (e.target.id === 'itemModal') { closeItemModal(); return; }
    if (e.target.id === 'shareItemModal') { closeShareModal(); return; }
    if (e.target.id === 'sharedItemModal') { closeSharedItemModal(); return; }
    if (e.target.id === 'encryptionPasswordModal') { cancelEncryptionPasswordPrompt(); return; }
    e.target.classList.remove('active');
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.getElementById('sharedItemModal').classList.contains('active')) { closeSharedItemModal(); return; }
    if (document.getElementById('shareItemModal').classList.contains('active')) { closeShareModal(); return; }
    const encryptionModal = document.getElementById('encryptionPasswordModal');
    if (encryptionModal.classList.contains('active')) { cancelEncryptionPasswordPrompt(); return; }
    const itemModal = document.getElementById('itemModal');
    if (itemModal.classList.contains('active')) { closeItemModal(); return; }
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    closeSidebar();
  }
  if (e.ctrlKey && e.key === 'k') {
    e.preventDefault();
    document.getElementById('searchBox').focus();
  }
  // Ctrl+Z for sketch undo when sketch canvas is active in item modal
  if (e.ctrlKey && e.key === 'z' && sketchActive && document.getElementById('itemModal').classList.contains('active')) {
    e.preventDefault();
    sketchUndo();
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

// Due date clear button visibility
document.addEventListener('change', (e) => {
  if (e.target.id === 'itemDueDate') {
    document.getElementById('dueDateClearBtn').style.display = e.target.value ? '' : 'none';
  }
});

// Auto-save: debounced save when editing item modal fields
let autoSaveTimer = null;

function silentSaveItem() {
  // Save current item without closing modal or re-rendering
  const title = document.getElementById('itemTitle').value.trim();
  if (!title) return false;

  const description = readItemDescription();
  if (!description) return false;
  const desc = description.source;
  const descriptionFormat = description.format;
  const link      = document.getElementById('itemLink').value.trim();
  const recurring = parseInt(document.getElementById('itemRecurring').value) || 0;
  const dueDate   = document.getElementById('itemDueDate').value || null;
  const recurringDays = recurring === 5 ? getSelectedRecurringDays() : null;
  const recurringTime = recurring ? (document.getElementById('itemRecurringTime').value || null) : null;
  const sectionId = parseInt(document.getElementById('itemSectionId').value);
  if (document.getElementById('itemProtected').checked) return false;

  // Get sketch data if canvas is active
  let sketchDataURL = null;
  if (sketchActive && sketchCtx) {
    const canvas = document.getElementById('sketchCanvas');
    const pixels = sketchCtx.getImageData(0, 0, canvas.width, canvas.height).data;
    let isBlank = true;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 0) { isBlank = false; break; }
    }
    if (!isBlank) sketchDataURL = canvas.toDataURL('image/png');
  }

  let editId = document.getElementById('editItemId').value;

  if (editId) {
    db.run('UPDATE items SET title = ?, description = ?, description_format = ?, link = ?, recurring = ?, sketch_data = ?, due_date = ?, recurring_days = ?, recurring_time = ? WHERE id = ?',
      [title, desc, descriptionFormat, link, recurring, sketchDataURL, dueDate, recurringDays, recurringTime, parseInt(editId)]);
  } else {
    // Create the item for the first time
    const maxOrder = db.exec('SELECT COALESCE(MAX(sort_order), 0) FROM items WHERE section_id = ?', [sectionId]);
    db.run('INSERT INTO items (section_id, title, description, description_format, link, recurring, sort_order, sketch_data, due_date, recurring_days, recurring_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [sectionId, title, desc, descriptionFormat, link, recurring, maxOrder[0].values[0][0] + 1, sketchDataURL, dueDate, recurringDays, recurringTime]);
    const newId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    document.getElementById('editItemId').value = newId;
  }

  persist();
  renderSidebar();
  return true;
}

function scheduleAutoSave() {
  if (localStorage.getItem('dashora_autosave') !== 'true') return;
  if (!document.getElementById('itemModal').classList.contains('active')) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (silentSaveItem()) toast('Auto-saved');
  }, 1500);
}

// Save on page exit if modal is open and auto-save is on
window.addEventListener('beforeunload', () => {
  if (localStorage.getItem('dashora_autosave') !== 'true') return;
  if (!document.getElementById('itemModal').classList.contains('active')) return;
  silentSaveItem();
});

// Attach auto-save listeners to item modal fields
['itemTitle', 'itemDesc', 'itemLink'].forEach(id => {
  document.getElementById(id).addEventListener('input', scheduleAutoSave);
});
document.getElementById('itemDesc').addEventListener('input', updateDescriptionPreview);
document.getElementById('itemDesc').addEventListener('paste', onDescriptionPaste);
['itemRecurring', 'itemDueDate', 'itemDescFormat'].forEach(id => {
  document.getElementById(id).addEventListener('change', scheduleAutoSave);
});

// Recurring time clear button visibility & auto-save
document.getElementById('itemRecurringTime').addEventListener('change', function() {
  document.getElementById('recurringTimeClearBtn').style.display = this.value ? '' : 'none';
  scheduleAutoSave();
});


/* ================================================================
   Sketch – Drawing Engine (Pointer Events + Pressure)
   ================================================================ */

let sketchCtx       = null;
let sketchDrawing   = false;
let sketchTool      = 'pen';   // 'pen' | 'eraser'
let sketchSize      = 3;
let sketchHistory   = [];      // array of ImageData snapshots for undo
let sketchLastPoint = null;

function initSketchCanvas() {
  const canvas = document.getElementById('sketchCanvas');
  sketchCtx = canvas.getContext('2d');

  // Size canvas to fit container
  const wrap = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth;
  const h = Math.max(340, Math.min(500, window.innerHeight * 0.45));
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  sketchCtx.scale(dpr, dpr);

  // Default state
  sketchCtx.lineCap = 'round';
  sketchCtx.lineJoin = 'round';
  sketchHistory = [];

  // Pointer events
  canvas.addEventListener('pointerdown', sketchPointerDown);
  canvas.addEventListener('pointermove', sketchPointerMove);
  canvas.addEventListener('pointerup', sketchPointerUp);
  canvas.addEventListener('pointerleave', sketchPointerUp);

  // Prevent scrolling while drawing on touch
  canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
}

function getSketchPos(e) {
  const canvas = document.getElementById('sketchCanvas');
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    pressure: e.pressure || 0.5
  };
}

function sketchPointerDown(e) {
  e.preventDefault();
  sketchDrawing = true;
  sketchLastPoint = getSketchPos(e);

  // Save snapshot for undo
  const canvas = document.getElementById('sketchCanvas');
  sketchHistory.push(sketchCtx.getImageData(0, 0, canvas.width, canvas.height));
  // Limit history to 50 steps
  if (sketchHistory.length > 50) sketchHistory.shift();

  // Set up stroke style for this entire stroke
  if (sketchTool === 'eraser') {
    sketchCtx.globalCompositeOperation = 'destination-out';
    sketchCtx.lineWidth = sketchSize * 6;
    sketchCtx.fillStyle = '#000';
  } else {
    sketchCtx.globalCompositeOperation = 'source-over';
    sketchCtx.strokeStyle = '#e0e4ee';
    sketchCtx.fillStyle = '#e0e4ee';
    sketchCtx.lineWidth = sketchSize * (0.5 + (sketchLastPoint.pressure) * 1.5);
  }

  // Draw a dot at the start point
  sketchCtx.beginPath();
  sketchCtx.arc(sketchLastPoint.x, sketchLastPoint.y, sketchCtx.lineWidth / 2, 0, Math.PI * 2);
  sketchCtx.fill();

  // Capture pointer for reliable tracking even outside canvas
  canvas.setPointerCapture(e.pointerId);
}

function sketchPointerMove(e) {
  if (!sketchDrawing) return;
  e.preventDefault();

  // Use coalesced events for smooth high-frequency pen input
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];

  for (const ce of events) {
    const pos = getSketchPos(ce);

    if (sketchTool === 'eraser') {
      sketchCtx.globalCompositeOperation = 'destination-out';
      sketchCtx.lineWidth = sketchSize * 6;
    } else {
      sketchCtx.globalCompositeOperation = 'source-over';
      sketchCtx.strokeStyle = '#e0e4ee';
      sketchCtx.lineWidth = sketchSize * (0.5 + pos.pressure * 1.5);
    }

    // Draw a line from last point to current point
    sketchCtx.beginPath();
    sketchCtx.moveTo(sketchLastPoint.x, sketchLastPoint.y);
    sketchCtx.lineTo(pos.x, pos.y);
    sketchCtx.stroke();

    sketchLastPoint = pos;
  }
}

function sketchPointerUp(e) {
  if (!sketchDrawing) return;
  sketchDrawing = false;
  sketchLastPoint = null;
  sketchCtx.globalCompositeOperation = 'source-over';
  scheduleAutoSave();
}

function setSketchTool(tool) {
  sketchTool = tool;
  document.getElementById('sketchToolPen').classList.toggle('active', tool === 'pen');
  document.getElementById('sketchToolEraser').classList.toggle('active', tool === 'eraser');
}

function updateSketchSize() {
  sketchSize = parseInt(document.getElementById('sketchSize').value);
}

function sketchUndo() {
  if (!sketchHistory.length) return;
  const canvas = document.getElementById('sketchCanvas');
  const img = sketchHistory.pop();
  sketchCtx.putImageData(img, 0, 0);
}

function sketchClear() {
  const canvas = document.getElementById('sketchCanvas');
  sketchHistory.push(sketchCtx.getImageData(0, 0, canvas.width, canvas.height));
  sketchCtx.clearRect(0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
}


/* ================================================================
   Due Date Notifications
   ================================================================ */

function checkDueDateNotifications() {
  if (localStorage.getItem('dashora_notifications') !== 'true') return;

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const localNow = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const tom = new Date(now.getTime() + 86400000);
  const localTomorrow = `${tom.getFullYear()}-${pad(tom.getMonth()+1)}-${pad(tom.getDate())}T${pad(tom.getHours())}:${pad(tom.getMinutes())}`;

  const res = db.exec(
    'SELECT id, title, due_date FROM items WHERE due_date IS NOT NULL AND due_date <= ? AND status < 2 ORDER BY due_date',
    [localTomorrow]
  );

  const container = document.getElementById('reminderBanners');
  container.innerHTML = '';

  // Load dismissed reminders: { "id:due_date": true }
  let dismissed = {};
  try { dismissed = JSON.parse(localStorage.getItem('dashora_dismissed_reminders') || '{}'); } catch(e) {}

  // Due date reminders
  if (res.length && res[0].values.length) {
    const rows = res[0].values;
    for (const [id, title, dueDate] of rows) {
      const key = id + ':' + dueDate;
      if (dismissed[key]) continue;

      const isOverdue = dueDate < localNow;
      const dueObj = new Date(dueDate);
      const dueDiffMs = dueObj.getTime() - now.getTime();
      const isDueNow = Math.abs(dueDiffMs) <= 60 * 1000;
      const label = isOverdue ? 'Overdue' : 'Due soon';
      const cls = isOverdue ? 'reminder-item-overdue' : 'reminder-item-soon';

      container.innerHTML += `
        <div class="reminder-banner ${cls}">
          <div class="reminder-banner-content">
            <span class="reminder-banner-icon">${isOverdue ? '&#128308;' : '&#128992;'}</span>
            <span class="reminder-banner-text"><strong>${label}:</strong> ${esc(title)} &middot; ${formatDueDate(dueDate)}</span>
            <button class="reminder-banner-close" onclick="dismissReminder(${id}, '${escAttr(dueDate)}')">&times;</button>
          </div>
        </div>`;

      triggerReminderAttention(
        key,
        `${label}: ${title}`,
        `${formatDueDate(dueDate)}`,
        isOverdue
      );

      if (isDueNow) {
        // Separate key guarantees a dedicated audible alert at exact due time.
        triggerReminderAttention(
          `${key}:due-now`,
          `Due now: ${title}`,
          `${formatDueDate(dueDate)}`,
          true
        );
      }
    }
  }

  // Recurring time reminders
  const currentTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const recurRes = db.exec(
    'SELECT id, title, recurring, recurring_time, recurring_days FROM items WHERE recurring > 0 AND recurring_time IS NOT NULL AND status < 2'
  );
  if (recurRes.length && recurRes[0].values.length) {
    const todayStr = now.toISOString().slice(0, 10);
    const dayOfWeek = now.getDay();
    for (const [id, title, recurring, recurTime, recurDays] of recurRes[0].values) {
      // Check if the recurring schedule applies today
      let appliesToday = false;
      if (recurring === 1) appliesToday = true; // daily
      else if (recurring === 2) appliesToday = dayOfWeek === 1; // weekly (Monday)
      else if (recurring === 3) appliesToday = (now.getDate() === 1 || now.getDate() === 15); // biweekly
      else if (recurring === 4) appliesToday = now.getDate() === 1; // monthly
      else if (recurring === 5 && recurDays) {
        appliesToday = recurDays.split(',').map(Number).includes(dayOfWeek);
      }
      if (!appliesToday) continue;

      // Show reminder if current time is within 30 min before or after the set time
      const [rh, rm] = recurTime.split(':').map(Number);
      const recurMinutes = rh * 60 + rm;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const diff = nowMinutes - recurMinutes;
      if (diff < -30 || diff > 30) continue;

      const key = 'recur:' + id + ':' + todayStr + ':' + recurTime;
      if (dismissed[key]) continue;

      const isOverdue = diff > 0;
      const label = isOverdue ? 'Recurring (past time)' : 'Recurring reminder';
      const cls = isOverdue ? 'reminder-item-overdue' : 'reminder-item-soon';

      container.innerHTML += `
        <div class="reminder-banner ${cls}">
          <div class="reminder-banner-content">
            <span class="reminder-banner-icon">&#128340;</span>
            <span class="reminder-banner-text"><strong>${label}:</strong> ${esc(title)} &middot; ${formatRecurringTime(recurTime)}</span>
            <button class="reminder-banner-close" onclick="dismissReminder('recur:${id}', '${escAttr(todayStr + ':' + recurTime)}')">&times;</button>
          </div>
        </div>`;

      triggerReminderAttention(
        key,
        `${label}: ${title}`,
        `${formatRecurringTime(recurTime)}`,
        isOverdue
      );
    }
  }
}

function dismissReminder(id, dueDate) {
  let dismissed = {};
  try { dismissed = JSON.parse(localStorage.getItem('dashora_dismissed_reminders') || '{}'); } catch(e) {}
  dismissed[id + ':' + dueDate] = true;
  localStorage.setItem('dashora_dismissed_reminders', JSON.stringify(dismissed));
  checkDueDateNotifications();
}


/* ================================================================
   Boot
   ================================================================ */

window.addEventListener('hashchange', openSharedItemFromUrl);
openSharedItemFromUrl();
initDB();
initBackupSystem();

window.addEventListener('pointerdown', unlockReminderAudio, { once: true });
window.addEventListener('keydown', unlockReminderAudio, { once: true });
