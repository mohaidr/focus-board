const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const share = fs.readFileSync(path.join(__dirname, '..', 'js', 'share.js'), 'utf8');

test('task and reference cards expose full-screen actions without requiring expansion', () => {
  const context = vm.createContext({
    db: { exec: () => [] }, isItemLocked: () => false,
    esc: value => value, escAttr: value => value, RECURRENCE_LABELS: {},
  });
  vm.runInContext(app.slice(app.indexOf('function renderRefItem('),
    app.indexOf('function renderFollowups(')), context);
  const task = context.renderItem(7, 'Title', '', '', 0, 0, 0, false, 1, null);
  const reference = context.renderRefItem(7, 'Title', '', '', false, 1, null, 0, 0);
  for (const html of [task, reference]) {
    assert.match(html, /aria-label="View item full screen" onclick="openItemFullscreen\(event, 7\)"/);
  }
});

function setup({ protectedItem = false, encrypted = false, locked = false, missing = false } = {}) {
  const calls = [];
  const elements = {
    itemFullscreen: {
      open: false,
      showModal() { this.open = true; calls.push('open'); },
      close() { this.open = false; calls.push('close'); },
    },
    itemFullscreenTitle: { textContent: '' },
    itemFullscreenContent: {
      innerHTML: '', scrollTop: 100,
      replaceChildren() { this.innerHTML = ''; },
    },
  };
  const context = vm.createContext({
    fullscreenItemId: null,
    document: { getElementById: id => elements[id] },
    getItemProtection: () => missing ? null : { isProtected: protectedItem, isEncrypted: encrypted },
    isItemLocked: () => locked,
    decryptedProtectedItems: new Map(),
    getItemContent: () => { calls.push('read'); return { title: '<Literal title>', description: 'Text' }; },
    renderSharedItemContent: () => '<div class="item-detail-desc">Text</div>',
    requestItemUnlock: (...args) => calls.push(args),
    toast: message => calls.push(['toast', message]),
    console: { error: () => calls.push('error') },
  });
  vm.runInContext(app.slice(app.indexOf('function openItemFullscreen('),
    app.indexOf('function toggleExpand(')), context);
  return { context, calls, elements };
}

test('full-screen reader opens independently, uses literal titles, and resets scroll', () => {
  const { context, calls, elements } = setup();
  context.openItemFullscreen({ stopPropagation: () => calls.push('stop') }, 7);
  assert.deepEqual(calls, ['stop', 'read', 'open']);
  assert.equal(context.fullscreenItemId, 7);
  assert.equal(elements.itemFullscreenTitle.textContent, '<Literal title>');
  assert.match(elements.itemFullscreenContent.innerHTML, /item-detail-desc/);
  assert.equal(elements.itemFullscreenContent.scrollTop, 0);
});

test('closing clears displayed content and item state', () => {
  const { context, elements } = setup();
  context.openItemFullscreen(null, 7);
  context.closeItemFullscreen();
  assert.equal(context.fullscreenItemId, null);
  assert.equal(elements.itemFullscreen.open, false);
  assert.equal(elements.itemFullscreenTitle.textContent, '');
  assert.equal(elements.itemFullscreenContent.innerHTML, '');
});

for (const options of [
  { protectedItem: true, locked: true },
  { protectedItem: true, encrypted: true },
]) {
  test('protected content is not read before unlocking: ' + JSON.stringify(options), () => {
    const { context, calls, elements } = setup(options);
    context.openItemFullscreen(null, 7);
    assert.deepEqual(calls, [[7, 'fullscreen']]);
    assert.equal(elements.itemFullscreen.open, false);
  });
}

test('an unlocked encrypted item can open', () => {
  const { context, elements } = setup({ protectedItem: true, encrypted: true });
  context.decryptedProtectedItems.set(7, {});
  context.openItemFullscreen(null, 7);
  assert.equal(elements.itemFullscreen.open, true);
});

test('missing items and rendering errors are reported without opening', () => {
  const missing = setup({ missing: true });
  missing.context.openItemFullscreen(null, 7);
  assert.deepEqual(missing.calls, [['toast', 'Item not found']]);
  const failed = setup();
  failed.context.getItemContent = () => { throw new Error('Read failed'); };
  failed.context.openItemFullscreen(null, 7);
  assert.deepEqual(failed.calls, ['error', ['toast', 'Could not open item: Read failed']]);
  assert.equal(failed.elements.itemFullscreen.open, false);
});

test('shared content reader preserves local data while sharing still validates it', () => {
  const context = vm.createContext({
    getItemProtection: () => ({ isProtected: false, isEncrypted: false }),
    isItemLocked: () => false,
    decryptedProtectedItems: new Map(),
    db: { exec: sql => sql.includes('FROM items i') ? [{
      values: [['Title', 'Description', 'markdown', 'file:///local-note', null, 1,
        null, 0, null, null, 'task']],
    }] : [{ values: [['Follow-up', 1]] }] },
    validateSharedItem: () => { throw new Error('Sharing validation applied'); },
  });
  vm.runInContext(share.slice(share.indexOf('function getItemContent('),
    share.indexOf('function shareItem(')), context);
  const content = context.getItemContent(7);
  assert.equal(content.link, 'file:///local-note');
  assert.equal(content.descriptionFormat, 'markdown');
  assert.equal(content.followups[0].completed, true);
  assert.throws(() => context.getItemShareContent(7), /Sharing validation applied/);
});

test('content retrieval uses decrypted fields, never stored ciphertext placeholders', () => {
  const context = vm.createContext({
    getItemProtection: () => ({ isProtected: true, isEncrypted: true }),
    isItemLocked: () => false,
    decryptedProtectedItems: new Map([[7, {
      title: 'Private title', description: 'Private description', link: '', sketchData: null,
    }]]),
    db: { exec: sql => sql.includes('FROM items i') ? [{
      values: [['Encrypted item', '', 'markdown', '', null, 0, null, 0, null, null, 'reference']],
    }] : [] },
  });
  vm.runInContext(share.slice(share.indexOf('function getItemContent('),
    share.indexOf('function shareItem(')), context);
  const content = context.getItemContent(7);
  assert.equal(content.title, 'Private title');
  assert.equal(content.description, 'Private description');
  context.decryptedProtectedItems.clear();
  assert.throws(() => context.getItemContent(7), /Unlock this item/);
});
