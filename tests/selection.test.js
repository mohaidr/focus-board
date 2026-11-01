const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

function setup() {
  const context = vm.createContext({
    db: { exec: () => [] },
    isItemLocked: () => false,
    esc: value => value,
    escAttr: value => value,
    renderDescription: text => `<div class="item-detail-desc">${text}</div>`,
    renderFollowups: () => '',
    RECURRENCE_LABELS: {},
    dragItemId: null,
  });
  vm.runInContext(source.slice(source.indexOf('function renderRefItem('),
    source.indexOf('function renderFollowups(')), context);
  vm.runInContext(source.slice(source.indexOf('function onItemDragStart('),
    source.indexOf('function onItemDragOver(')), context);
  return context;
}

for (const type of ['task', 'reference', 'unlocked protected reference']) {
  test(`${type} cards restrict dragging to the grip, leaving descriptions selectable`, () => {
    const context = setup();
    const html = type === 'task'
      ? context.renderItem(1, 'Title', 'Select this passage', '', 0, 0, 0, true, 1, null)
      : context.renderRefItem(1, 'Title', 'Select this passage', '', true, 1, null,
        type === 'unlocked protected reference' ? 1 : 0, 0);
    const card = html.match(/<div class="item [^>]+>/)[0];
    const grip = html.match(/<span class="item-drag"[^>]+>/)[0];
    assert.doesNotMatch(card, /draggable=|ondragstart=/);
    assert.match(card, /ondragover=.+ondrop=/s);
    assert.match(grip, /draggable="true"/);
    assert.match(grip, /ondragstart="onItemDragStart\(event, 1\)"/);
    assert.match(grip, /onclick="event.stopPropagation\(\)"/);
    assert.match(html, /<div class="item-detail-desc">Select this passage<\/div>/);
  });
}

test('grip dragging preserves the item payload and full-card drag image', () => {
  const context = setup();
  const card = { classList: { add: value => { card.dragClass = value; } } };
  context.requestAnimationFrame = callback => callback();
  context.document = { querySelector: () => card };
  let stopped = false;
  let payload;
  let image;
  const event = {
    stopPropagation: () => { stopped = true; },
    currentTarget: { closest: selector => { assert.equal(selector, '.item'); return card; } },
    dataTransfer: {
      setData: (...args) => { payload = args; },
      setDragImage: (...args) => { image = args; },
    },
  };
  context.onItemDragStart(event, 7);
  assert.equal(stopped, true);
  assert.equal(context.dragItemId, 7);
  assert.equal(event.dataTransfer.effectAllowed, 'move');
  assert.deepEqual(payload, ['text/plain', 7]);
  assert.deepEqual(image, [card, 0, 0]);
  assert.equal(card.dragClass, 'dragging');
});
