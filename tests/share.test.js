const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'share.js'), 'utf8');
const markdown = fs.readFileSync(path.join(__dirname, '..', 'js', 'markdown.js'), 'utf8');
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
