const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'share.js'), 'utf8');
const markdown = fs.readFileSync(path.join(__dirname, '..', 'js', 'markdown.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const baseUrl = 'https://example.com/index.html';

function setup() {
  const alerts = [];
  const context = vm.createContext({
    URL, URLSearchParams, TextEncoder, TextDecoder, console,
    window: { location: { href: baseUrl }, alert: message => alerts.push(message) },
    bytesToBase64: bytes => Buffer.from(bytes).toString('base64'),
    base64ToBytes: value => Uint8Array.from(atob(value), char => char.charCodeAt(0)),
  });
  vm.runInContext(markdown, context);
  vm.runInContext(source, context);
  return { context, alerts };
}

function fixture() {
  return {
    title: 'Sharing \u{1F9E9} \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u4e2d\u6587',
    description: '    indented code\n\n## Heading\n\n**bold**  \nnext line\n',
    descriptionFormat: 'markdown',
    descriptionDirection: 'auto',
    notes: [],
    link: 'https://example.com/docs?q=a%20b#part',
    boardType: 'task',
    status: 1,
    dueDate: '2026-11-12T14:30',
    recurring: 5,
    recurringDays: '1,3,5',
    recurringTime: '14:30',
    sketchData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
    followups: [{ text: 'First follow-up', completed: false }, { text: 'Done \u{1F389}', completed: true }],
  };
}

function encodedPayload(payload) {
  return baseUrl + '#share=' + Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function shareUrlWithBytes(context, bytes) {
  const base = baseUrl + '?padding=';
  const initial = context.encodeItemShareUrl(fixture(), base);
  const padding = bytes - new TextEncoder().encode(initial).byteLength;
  assert.ok(padding >= 0);
  const url = context.encodeItemShareUrl(fixture(), base + 'a'.repeat(padding));
  assert.equal(new TextEncoder().encode(url).byteLength, bytes);
  return url;
}

test('all item content, Unicode, and Markdown round-trip', () => {
  const { context } = setup();
  const item = fixture();
  const url = context.encodeItemShareUrl(item);
  assert.deepEqual(JSON.parse(JSON.stringify(context.decodeItemShareUrl(url))), item);
  assert.match(new URL(url).hash, /^#share=[A-Za-z0-9_-]+$/);
});

test('reference items and literal plain text round-trip', () => {
  const { context } = setup();
  const item = { ...fixture(), boardType: 'reference', descriptionFormat: 'plain', description: '**literal**\n<img src=x>' };
  assert.deepEqual(JSON.parse(JSON.stringify(context.decodeItemShareUrl(context.encodeItemShareUrl(item)))), item);
});

test('embedded description images survive share encoding and decoding', () => {
  const { context } = setup();
  const item = { ...fixture(), description: '![Pasted image](data:image/png;base64,aGVsbG8=)' };
  assert.deepEqual(JSON.parse(JSON.stringify(context.decodeItemShareUrl(context.encodeItemShareUrl(item)))), item);
});

for (const direction of ['auto', 'ltr', 'rtl']) {
  test(direction + ' writing direction survives sharing without modifying Markdown', () => {
    const { context } = setup();
    const item = { ...fixture(), descriptionDirection: direction };
    assert.deepEqual(JSON.parse(JSON.stringify(context.decodeItemShareUrl(context.encodeItemShareUrl(item)))), item);
  });
}

test('older shared links without writing direction default to automatic', () => {
  const { context } = setup();
  const item = fixture();
  delete item.descriptionDirection;
  const decoded = context.decodeItemShareUrl(encodedPayload({ version: 1, item }));
  assert.equal(decoded.descriptionDirection, 'auto');
  assert.equal(decoded.description, item.description);
});

test('existing query parameters are preserved and old fragments are replaced', () => {
  const { context } = setup();
  const url = new URL(context.encodeItemShareUrl(fixture(), baseUrl + '?board=1#old'));
  assert.equal(url.search, '?board=1');
  assert.match(url.hash, /^#share=/);
});

test('database IDs and protection credentials are never encoded', () => {
  const { context } = setup();
  const url = context.encodeItemShareUrl({ ...fixture(), id: 100, sectionId: 12, passwordHash: 'fake-hash', passwordSalt: 'fake-salt', encryptedData: 'fake-cipher' });
  const payload = JSON.parse(Buffer.from(new URL(url).hash.slice(7), 'base64url').toString('utf8'));
  assert.deepEqual(Object.keys(payload.item), Object.keys(fixture()));
  assert.ok(!JSON.stringify(payload).includes('fake-'));
});

test('2047-byte and 2048-byte full share URLs do not warn', () => {
  const { context, alerts } = setup();
  for (const bytes of [2047, 2048]) {
    const url = shareUrlWithBytes(context, bytes);
    assert.equal(context.warnIfShareUrlTooLong(url), bytes);
    assert.deepEqual(JSON.parse(JSON.stringify(context.decodeItemShareUrl(url))), fixture());
  }
  assert.equal(alerts.length, 0);
});

test('2049-byte full share URL warns without truncating or losing content', () => {
  const { context, alerts } = setup();
  const url = shareUrlWithBytes(context, 2049);
  assert.equal(context.warnIfShareUrlTooLong(url), 2049);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /might be too long to work/);
  assert.deepEqual(JSON.parse(JSON.stringify(context.decodeItemShareUrl(url))), fixture());
});

test('warning measures UTF-8 bytes, not string length', () => {
  const { context, alerts } = setup();
  const url = 'https://example.com/' + '\u{1F9E9}'.repeat(510);
  assert.ok(url.length < 2048);
  assert.ok(new TextEncoder().encode(url).byteLength > 2048);
  context.warnIfShareUrlTooLong(url);
  assert.equal(alerts.length, 1);
});

test('large sketches remain intact in the full URL', () => {
  const { context, alerts } = setup();
  const item = { ...fixture(), sketchData: 'data:image/png;base64,' + 'AAAA'.repeat(3000) };
  const url = context.encodeItemShareUrl(item);
  context.warnIfShareUrlTooLong(url);
  assert.equal(alerts.length, 1);
  assert.equal(context.decodeItemShareUrl(url).sketchData, item.sketchData);
});

test('ordinary app URLs have no shared item', () => {
  const { context } = setup();
  assert.equal(context.decodeItemShareUrl(baseUrl), null);
  assert.equal(context.decodeItemShareUrl(baseUrl + '#other'), null);
});

for (const hash of ['share=', 'share=!', 'share=A', 'share=ew', 'share=_w', 'share=e30&share=e30']) {
  test('rejects malformed shared fragment ' + hash, () => {
    const { context } = setup();
    assert.throws(() => context.decodeItemShareUrl(baseUrl + '#' + hash));
  });
}

test('unsupported versions are rejected', () => {
  const { context } = setup();
  assert.throws(() => context.decodeItemShareUrl(encodedPayload({ version: 2, item: fixture() })), /Unsupported shared item version/);
});

for (const [name, change] of [
  ['script links', { link: 'javascript:alert(1)' }],
  ['data links', { link: 'data:text/html,<script>alert(1)</script>' }],
  ['SVG sketches', { sketchData: 'data:image/svg+xml,<svg onload=alert(1)></svg>' }],
  ['unknown description format', { descriptionFormat: 'html' }],
  ['unknown description direction', { descriptionDirection: 'sideways' }],
  ['null description direction', { descriptionDirection: null }],
  ['HTML in description direction', { descriptionDirection: 'rtl" onclick="alert(1)' }],
  ['unknown board type', { boardType: 'invalid' }],
  ['invalid status', { status: 9 }],
  ['invalid schedule', { recurring: 6 }],
  ['invalid due date', { dueDate: 'not-a-date' }],
  ['invalid recurring days', { recurringDays: '7' }],
  ['invalid reminder time', { recurringTime: '25:70' }],
  ['invalid follow-ups', { followups: [{ text: 'Bad', completed: 'yes' }] }],
  ['missing title', { title: '' }],
]) {
  test('rejects ' + name + ' on both encoding and decoding', () => {
    const { context } = setup();
    const item = { ...fixture(), ...change };
    assert.throws(() => context.encodeItemShareUrl(item));
    assert.throws(() => context.decodeItemShareUrl(encodedPayload({ version: 1, item })));
  });
}

const selectedNote = {
  title: 'Selected \u0645\u0644\u0627\u062d\u0638\u0629',
  description: '    exact indentation\n\n## \u0645\u0631\u062d\u0628\u0627\n\n**bold**  \nnext line\n\n![Image](data:image/png;base64,aGVsbG8=)\n',
  descriptionFormat: 'markdown',
  descriptionDirection: 'rtl',
};

function parentWithNotes() {
  return {
    ...fixture(), id: 777, title: 'PRIVATE parent title', description: 'PRIVATE parent description',
    link: 'https://example.com/PRIVATE-parent-link', sketchData: 'data:image/png;base64,UFJJVkFURQ==',
    passwordHash: 'PRIVATE password verifier', passwordSalt: 'PRIVATE salt',
    encryptedData: 'PRIVATE ciphertext',
    followups: [{ text: 'PRIVATE follow-up', completed: false }],
    notes: [
      { ...selectedNote, title: 'PRIVATE first sibling', description: 'PRIVATE first sibling body' },
      { ...selectedNote },
      { ...selectedNote, title: 'PRIVATE second sibling', description: 'PRIVATE second sibling body' },
    ],
  };
}

test('single-note sharing whitelists only the chosen note content and never the work item or siblings', () => {
  const { context } = setup();
  const parent = parentWithNotes();
  const before = JSON.stringify(parent);
  context.getItemContent = () => parent;
  const content = context.getNoteShareContent(777, 1);
  const url = context.encodeItemShareUrl(content);
  const decoded = JSON.parse(JSON.stringify(context.decodeItemShareUrl(url)));
  assert.deepEqual(decoded, {
    title: selectedNote.title, description: selectedNote.description,
    descriptionFormat: 'markdown', descriptionDirection: 'rtl', notes: [],
    link: '', boardType: 'reference', status: 0, dueDate: null, recurring: 0,
    recurringDays: null, recurringTime: null, sketchData: null, followups: [],
  });
  const raw = Buffer.from(new URL(url).hash.slice(7), 'base64url').toString('utf8');
  assert.ok(!raw.includes('PRIVATE'));
  assert.ok(!raw.includes('777'));
  assert.equal(JSON.stringify(parent), before);
});

for (const title of ['', '   ']) {
  test('untitled shared notes use a generic title, not the parent title: ' + JSON.stringify(title), () => {
    const { context } = setup();
    context.getItemContent = () => ({ ...parentWithNotes(), notes: [{ ...selectedNote, title }] });
    const content = context.getNoteShareContent(777, 0);
    assert.equal(content.title, 'Shared note');
    assert.equal(content.description, selectedNote.description);
  });
}

for (const format of ['plain', 'markdown']) {
  for (const direction of ['auto', 'ltr', 'rtl']) {
    test('single note preserves exact content: ' + format + ' / ' + direction, () => {
      const { context } = setup();
      const note = { ...selectedNote, descriptionFormat: format, descriptionDirection: direction };
      context.getItemContent = () => ({ ...parentWithNotes(), notes: [note] });
      const decoded = context.decodeItemShareUrl(context.encodeItemShareUrl(context.getNoteShareContent(777, 0)));
      assert.equal(decoded.description, note.description);
      assert.equal(decoded.descriptionFormat, format);
      assert.equal(decoded.descriptionDirection, direction);
    });
  }
}

for (const index of [-1, 3, 0.5, NaN, null, undefined, '1']) {
  test('invalid note index cannot accidentally share the complete item: ' + String(index), () => {
    const { context } = setup();
    context.getItemContent = () => parentWithNotes();
    assert.throws(() => context.getNoteShareContent(777, index), /note no longer exists/);
  });
}

function shareUi({ protectedItem = false, locked = false, encrypted = false, decrypted = false, accept = true, fullscreen = false } = {}) {
  const { context, alerts } = setup();
  const calls = [], errors = [], notifications = [];
  const elements = {};
  const getElement = id => elements[id] ||= {
    value: '', textContent: '', active: false, open: false,
    classList: { add: () => { getElement(id).active = true; } },
    focus: () => calls.push('focus'), select: () => calls.push('select'),
  };
  getElement('itemFullscreen').open = fullscreen;
  context.document = { getElementById: getElement };
  context.closeModal = id => { getElement(id).active = false; calls.push('close-share'); };
  context.closeItemFullscreen = () => { getElement('itemFullscreen').open = false; calls.push('close-fullscreen'); };
  context.getItemProtection = () => ({ isProtected: protectedItem, isEncrypted: encrypted });
  context.isItemLocked = () => locked;
  context.decryptedProtectedItems = new Map(decrypted ? [[777, {}]] : []);
  context.getItemContent = () => { calls.push('read-content'); return parentWithNotes(); };
  context.requestItemUnlock = (...args) => calls.push({ unlock: args });
  context.confirm = message => { calls.push({ confirmation: message }); return accept; };
  context.toast = message => notifications.push(message);
  context.console = { error: (...args) => errors.push(args) };
  return { context, calls, elements, errors, alerts, notifications };
}

test('note Share displays an accurately scoped dialog without toggling or dragging the note', () => {
  const { context, calls, elements } = shareUi();
  const event = { preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') };
  context.shareNote(event, 777, 1);
  assert.equal(elements.shareItemModal.active, true);
  assert.equal(elements.shareItemTitle.textContent, 'Share note');
  assert.match(elements.itemShareNotice.textContent, /Only this note/);
  assert.match(elements.itemShareNotice.textContent, /parent item and other notes are not included/i);
  assert.equal(context.decodeItemShareUrl(elements.itemShareUrl.value).description, selectedNote.description);
  assert.ok(calls.includes('prevent') && calls.includes('stop'));
  assert.ok(calls.includes('select'));
});

for (const index of [null, undefined, -1, '1', 1.5, 99]) {
  test('invalid note Share requests are logged and never produce whole-item links: ' + String(index), () => {
    const { context, elements, errors, notifications } = shareUi();
    context.shareNote(null, 777, index);
    assert.equal(elements.itemShareUrl.value, '');
    assert.ok(!elements.shareItemModal?.active);
    assert.equal(errors.length, 1);
    assert.match(notifications[0], /Could not share note/);
  });
}

test('sharing a whole item after a note resets the dialog scope and retains existing full-item behavior', () => {
  const { context, elements } = shareUi();
  context.shareNote(null, 777, 1);
  context.shareItem(null, 777);
  assert.equal(elements.shareItemTitle.textContent, 'Share item');
  assert.match(elements.itemShareNotice.textContent, /^All item content/);
  const item = context.decodeItemShareUrl(elements.itemShareUrl.value);
  assert.equal(item.title, 'PRIVATE parent title');
  assert.equal(item.notes.length, 3);
  assert.equal(item.followups[0].text, 'PRIVATE follow-up');
});

test('locked note sharing requests the right unlock action without reading any content', () => {
  const { context, calls, elements } = shareUi({ protectedItem: true, locked: true });
  context.shareNote(null, 777, 1);
  assert.deepEqual(calls.find(call => call.unlock).unlock, [777, 'share-note:1']);
  assert.equal(calls.includes('read-content'), false);
  assert.equal(elements.itemShareUrl.value, '');
});

test('encrypted note sharing cannot use placeholders if decrypted content is unavailable', () => {
  const { context, calls } = shareUi({ protectedItem: true, encrypted: true });
  context.shareNote(null, 777, 1);
  assert.deepEqual(calls.find(call => call.unlock).unlock, [777, 'share-note:1']);
  assert.equal(calls.includes('read-content'), false);
});

test('declining the protected-note disclosure creates no URL and reads no content', () => {
  const { context, calls, elements } = shareUi({ protectedItem: true, encrypted: true, decrypted: true, accept: false });
  context.shareNote(null, 777, 1);
  assert.match(calls.find(call => call.confirmation).confirmation, /unprotected copy of the selected note/);
  assert.equal(calls.includes('read-content'), false);
  assert.equal(elements.itemShareUrl.value, '');
  assert.ok(!elements.shareItemModal?.active);
});

test('protected-note disclosure allows only the selected note into the share URL', () => {
  const { context, calls, elements } = shareUi({ protectedItem: true, encrypted: true, decrypted: true });
  context.shareNote(null, 777, 1);
  assert.ok(calls.some(call => call.confirmation));
  const raw = Buffer.from(new URL(elements.itemShareUrl.value).hash.slice(7), 'base64url').toString('utf8');
  assert.ok(!raw.includes('PRIVATE'));
  assert.equal(context.decodeItemShareUrl(elements.itemShareUrl.value).description, selectedNote.description);
});

test('single-note sharing retains the complete URL and byte warning for long embedded content', () => {
  const { context, elements, alerts } = shareUi();
  const longNote = { ...selectedNote, description: selectedNote.description.repeat(12) };
  context.getItemContent = () => ({ ...parentWithNotes(), notes: [longNote] });
  context.shareNote(null, 777, 0);
  assert.equal(alerts.length, 1);
  assert.equal(context.decodeItemShareUrl(elements.itemShareUrl.value).description, longNote.description);
});

test('sharing from the full-screen reader closes its top-layer dialog so the URL modal is visible', () => {
  const { context, calls, elements } = shareUi({ fullscreen: true });
  context.shareNote(null, 777, 1);
  assert.equal(elements.itemFullscreen.open, false);
  assert.equal(elements.shareItemModal.active, true);
  assert.ok(calls.indexOf('read-content') < calls.indexOf('close-fullscreen'));
});

test('unlocking resumes sharing the selected note, not the parent item or note editor', () => {
  const calls = [];
  const context = vm.createContext({
    shareNote: (...args) => calls.push(args),
    renderMain: () => calls.push('render'),
  });
  vm.runInContext(app.slice(app.indexOf('function runUnlockedItemAction('), app.indexOf('function closeUnlockModal(')), context);
  context.runUnlockedItemAction(777, 'share-note:1', 4);
  assert.deepEqual(calls, [[null, 777, 1], 'render']);
});
