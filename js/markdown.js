let descriptionMarkdownParser = null;
let descriptionMarkdownConverter = null;

function isDescriptionDirection(direction) {
  return ['auto', 'ltr', 'rtl'].includes(direction);
}

function getDescriptionFormattingEdit(source, start, end, action) {
  const markers = { bold: '**', italic: '*', strike: '~~' };
  const blockPatterns = {
    heading: /^([ \t]*)##[ \t]+/,
    bullet: /^([ \t]*)[-+*][ \t]+(?!\[[ xX]\][ \t])/,
    numbered: /^([ \t]*)\d+[.)][ \t]+/,
    checklist: /^([ \t]*)[-+*][ \t]+\[[ xX]\][ \t]+/,
    quote: /^([ \t]*)>[ \t]?/,
  };
  if (typeof source !== 'string' || !Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end < start || end > source.length) {
    throw new Error('The description selection is invalid. Select the text again.');
  }
  if (!Object.hasOwn(markers, action) && !Object.hasOwn(blockPatterns, action) &&
      !['code', 'code-block', 'link'].includes(action)) {
    throw new Error('Unsupported Markdown formatting action.');
  }

  const codeRanges = [];
  let fence = null;
  let offset = 0;
  for (const line of source.split('\n')) {
    const match = line.match(/^[ \t]*(?:>[ \t]*)*(?:[-+*][ \t]+|\d+[.)][ \t]+)?(`{3,}|~{3,})(.*)$/);
    if (!fence && match) {
      fence = { start: offset, marker: match[1][0], length: match[1].length };
    } else if (fence && match && match[1][0] === fence.marker &&
               match[1].length >= fence.length && !match[2].trim()) {
      codeRanges.push({ start: fence.start, end: offset + line.length });
      fence = null;
    }
    offset += line.length + 1;
  }
  if (fence) codeRanges.push({ start: fence.start, end: source.length });
  if (codeRanges.some(range => {
    const overlaps = start === end
      ? start >= range.start && start <= range.end
      : start < range.end && end > range.start;
    return overlaps && !(action === 'code-block' && start <= range.start && end >= range.end);
  })) {
    throw new Error('Formatting inside a fenced code block would change its syntax. Select text outside the block.');
  }

  const selected = source.slice(start, end);
  if (Object.hasOwn(markers, action)) {
    const marker = markers[action];
    const before = source.slice(0, start);
    const after = source.slice(end);
    const leftStars = (before.match(/\*+$/) || [''])[0].length;
    const rightStars = (after.match(/^\*+/) || [''])[0].length;
    const surrounded = selected && !selected.includes('\n') &&
      before.endsWith(marker) && after.startsWith(marker) &&
      (action !== 'italic' || (leftStars % 2 === 1 && rightStars % 2 === 1));
    if (surrounded) {
      return {
        start: start - marker.length, end: end + marker.length, text: selected,
        selectionStart: start - marker.length, selectionEnd: end - marker.length,
      };
    }
    let position = start;
    const parts = selected.split('\n').map(line => {
      const wholeLine = position === 0 || source[position - 1] === '\n';
      position += line.length + 1;
      const prefix = line.match(wholeLine
        ? /^[ \t]*(?:>[ \t]*)*(?:(?:#{1,6}|[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/
        : /^[ \t]*/)[0];
      const rest = line.slice(prefix.length);
      const suffix = rest.match(/[ \t\r]*$/)[0];
      const body = rest.slice(0, rest.length - suffix.length);
      if (wholeLine && body.startsWith('|')) {
        throw new Error('Select text within a table cell, rather than the Markdown table markers.');
      }
      return { prefix, body, suffix };
    });
    if (!parts.some(part => part.body)) parts[0].body = 'text';
    const isWrapped = part =>
      part.body.length > marker.length * 2 && part.body.startsWith(marker) && part.body.endsWith(marker) &&
      (action !== 'italic' || (part.body.match(/^\*+/)[0].length % 2 === 1 &&
        part.body.match(/\*+$/)[0].length % 2 === 1));
    const remove = parts.filter(part => part.body).every(isWrapped);
    const text = parts.map(part => part.prefix + (part.body
      ? remove ? part.body.slice(marker.length, -marker.length)
        : isWrapped(part) ? part.body : marker + part.body + marker
      : '') + part.suffix).join('\n');
    const selectionStart = parts.length === 1 ? start + parts[0].prefix.length + (remove ? 0 : marker.length) : start;
    const selectionEnd = parts.length === 1
      ? selectionStart + parts[0].body.length - (remove ? marker.length * 2 : 0)
      : start + text.length;
    return { start, end, text, selectionStart, selectionEnd };
  }

  if (action === 'code' || action === 'link') {
    if (selected.includes('\n')) {
      throw new Error(action === 'code'
        ? 'Select a single line for inline code, or use Code block.'
        : 'Select a single line for a link.');
    }
    if (action === 'code') {
      const body = selected || 'code';
      const longest = (body.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
      const ticks = '`'.repeat(longest + 1);
      const padding = body.startsWith('`') || body.endsWith('`') || (/^ .* $/.test(body) && body.trim()) ? ' ' : '';
      const selectionStart = start + ticks.length + padding.length;
      return {
        start, end, text: ticks + padding + body + padding + ticks,
        selectionStart, selectionEnd: selectionStart + body.length,
      };
    }
    const prefix = selected.match(/^[ \t]*/)[0];
    const suffix = selected.slice(prefix.length).match(/[ \t]*$/)[0];
    const label = (selected.trim() || 'link text').replace(/[\\[\]]/g, '\\$&');
    const url = 'https://example.com';
    const selectionStart = start + prefix.length + label.length + 3;
    return {
      start, end, text: prefix + '[' + label + '](' + url + ')' + suffix,
      selectionStart, selectionEnd: selectionStart + url.length,
    };
  }

  const blockStart = start === 0 ? 0 : source.lastIndexOf('\n', start - 1) + 1;
  const last = end > start && source[end - 1] === '\n' ? end - 1 : end;
  const nextBreak = source.indexOf('\n', last);
  const blockEnd = nextBreak === -1 ? source.length : nextBreak;
  const block = source.slice(blockStart, blockEnd);
  let text;
  let contentOffset = 0;
  let contentLength = 0;
  let remove = false;
  if (action === 'code-block') {
    const body = block || 'code';
    const longest = (body.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
    const ticks = '`'.repeat(Math.max(3, longest + 1));
    text = ticks + '\n' + body + '\n' + ticks;
    contentOffset = ticks.length + 1;
    contentLength = body.length;
  } else {
    const pattern = blockPatterns[action];
    const lines = block.split('\n');
    const nonempty = lines.filter(line => line.trim());
    remove = nonempty.length > 0 && nonempty.every(line => pattern.test(line));
    let number = 0;
    const placeholder = action === 'heading' ? 'Heading' : action === 'quote' ? 'Quote' : 'List item';
    if (!nonempty.length) lines[0] += placeholder;
    text = lines.map(line => {
      if (!line.trim()) return action === 'quote' && !remove ? '> ' + line : line;
      if (remove) return line.replace(pattern, '$1');
      const indent = line.match(/^[ \t]*/)[0];
      let body = line.slice(indent.length);
      if (action === 'checklist' && /^[-+*][ \t]+\[[ xX]\][ \t]+/.test(body)) return line;
      if (action === 'heading') body = body.replace(/^#{1,6}[ \t]+/, '');
      if (['bullet', 'numbered', 'checklist'].includes(action)) {
        body = body.replace(/^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '');
      }
      const prefix = {
        heading: '## ', bullet: '- ', numbered: ++number + '. ', checklist: '- [ ] ', quote: '> ',
      }[action];
      return indent + prefix + body;
    }).join('\n');
    if (!nonempty.length) {
      contentOffset = text.indexOf(placeholder);
      contentLength = placeholder.length;
    }
  }
  // Separate block formatting from adjacent paragraphs to avoid lazy continuations.
  const before = source.slice(0, blockStart);
  const after = source.slice(blockEnd);
  const prefix = remove || !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = remove || !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const selectionStart = blockStart + prefix.length + (contentLength ? contentOffset : 0);
  const selectionEnd = selectionStart + (contentLength || text.length);
  return { start: blockStart, end: blockEnd, text: prefix + text + suffix, selectionStart, selectionEnd };
}

function readDescriptionImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      reject(new Error('Paste a PNG, JPEG, GIF, or WebP image.'));
      return;
    }
    if (!file.size) {
      reject(new Error('The copied image is empty.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.startsWith(`data:${file.type};base64,`)) {
        reject(new Error('Could not read the copied image.'));
        return;
      }
      resolve(`![Pasted image](${reader.result})`);
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read the copied image.'));
    reader.onabort = () => reject(new Error('Image paste was cancelled.'));
    reader.readAsDataURL(file);
  });
}

function convertDescriptionHtmlToMarkdown(html) {
  if (typeof TurndownService === 'undefined' || typeof turndownPluginGfm === 'undefined' ||
      typeof DOMPurify === 'undefined' || !DOMPurify.isSupported) {
    throw new Error('Formatted paste support could not load. Check your connection and reload.');
  }
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: [
      'a', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3',
      'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'li', 'ol', 'p', 'pre', 's',
      'span', 'strike', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
    ],
    ALLOWED_ATTR: ['align', 'alt', 'checked', 'class', 'href', 'src', 'start', 'title', 'type'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  // Markdown tables require a header, even when the copied table has none.
  fragment.querySelectorAll('table').forEach(table => {
    const firstRow = table.rows[0];
    if (!firstRow || Array.from(firstRow.cells).some(cell => cell.tagName === 'TH')) return;
    Array.from(firstRow.cells).forEach(cell => {
      const header = cell.ownerDocument.createElement('th');
      if (cell.hasAttribute('align')) header.setAttribute('align', cell.getAttribute('align'));
      header.append(...cell.childNodes);
      cell.replaceWith(header);
    });
  });
  if (!descriptionMarkdownConverter) {
    descriptionMarkdownConverter = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    descriptionMarkdownConverter.use(turndownPluginGfm.gfm);
  }
  const container = document.createElement('div');
  container.append(fragment);
  return descriptionMarkdownConverter.turndown(container);
}

function renderDescriptionContent(source, format = 'plain', direction = 'auto') {
  if (!isDescriptionDirection(direction)) {
    return renderDescriptionError(source, 'Unsupported description direction. Original text:');
  }
  if (format === 'plain') return esc(source);
  if (format !== 'markdown') {
    return renderDescriptionError(source, 'Unsupported description format. Original text:');
  }
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    return renderDescriptionError(source, 'Markdown support could not load. Check your connection and reload. Original text:');
  }
  if (!DOMPurify.isSupported) {
    return renderDescriptionError(source, 'This browser cannot safely display Markdown. Original text:');
  }

  if (!descriptionMarkdownParser) {
    descriptionMarkdownParser = new marked.Marked({
      gfm: true,
      breaks: true,
      renderer: {
        html({ text }) {
          return esc(text);
        },
        link({ href, title, tokens }) {
          const label = this.parser.parseInline(tokens);
          const tooltip = title ? ` title="${escAttr(title)}"` : '';
          return `<a href="${escAttr(href)}"${tooltip} target="_blank" rel="noopener noreferrer">${label}</a>`;
        },
        image({ href, title, text }) {
          const tooltip = title ? ` title="${escAttr(title)}"` : '';
          return `<img src="${escAttr(href)}" alt="${escAttr(text)}"${tooltip} loading="lazy" referrerpolicy="no-referrer">`;
        },
      },
    });
  }

  const fragment = DOMPurify.sanitize(descriptionMarkdownParser.parse(source), {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: [
      'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'img', 'input', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td',
      'th', 'thead', 'tr', 'ul',
    ],
    ALLOWED_ATTR: [
      'align', 'alt', 'checked', 'class', 'disabled', 'href', 'loading',
      'referrerpolicy', 'rel', 'src', 'start', 'target', 'title', 'type',
    ],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  fragment.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, table, th, td')
    .forEach(element => element.setAttribute('dir', direction));
  fragment.querySelectorAll('pre, code').forEach(element => element.setAttribute('dir', 'ltr'));
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

function renderDescriptionError(source, message) {
  console.error(message);
  return `<div class="description-render-error" role="alert">${esc(message)}</div><div class="description-source">${esc(source)}</div>`;
}

function renderDescription(source, format = 'plain', direction = 'auto') {
  const markdownClass = format === 'markdown' ? ' markdown-content' : '';
  const validDirection = isDescriptionDirection(direction) ? direction : 'auto';
  return `<div class="item-detail-desc${markdownClass}" dir="${validDirection}">${renderDescriptionContent(source, format, direction)}</div>`;
}

let savedExpansionState = null;

function reportExpansionError(message, error) {
  console.error(message, error);
  const notify = () => toast(message);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', notify, { once: true });
  } else {
    notify();
  }
}

function isExpansionKey(key) {
  if (typeof key !== 'string') return false;
  return /^share:[a-f0-9]{64}$/.test(key) ||
    (/^item:[1-9]\d*$/.test(key) && Number.isSafeInteger(Number(key.slice(5))));
}

function getItemViewKey(itemId) {
  if (!Number.isSafeInteger(itemId) || itemId < 1) throw new Error('Invalid item view identifier');
  return 'item:' + itemId;
}

function getExpansionStates() {
  if (savedExpansionState !== null) return savedExpansionState;
  savedExpansionState = {};
  try {
    const raw = localStorage.getItem('dashora_expansion_state');
    if (raw === null) return savedExpansionState;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !parsed.states || typeof parsed.states !== 'object' || Array.isArray(parsed.states)) {
      throw new Error('Unsupported expansion preferences');
    }
    for (const [key, state] of Object.entries(parsed.states)) {
      if (!isExpansionKey(key) || !state || typeof state !== 'object' || Array.isArray(state) ||
          (state.item !== undefined && typeof state.item !== 'boolean') ||
          (state.description !== undefined && typeof state.description !== 'boolean') ||
          (state.notes !== undefined && (!Array.isArray(state.notes) || state.notes.some(open => typeof open !== 'boolean')))) {
        throw new Error('Invalid expansion preferences');
      }
    }
    savedExpansionState = parsed.states;
  } catch (error) {
    reportExpansionError('Could not load open/closed preferences. Using the default view.', error);
  }
  return savedExpansionState;
}

function persistExpansionStates() {
  try {
    localStorage.setItem('dashora_expansion_state', JSON.stringify({ version: 1, states: getExpansionStates() }));
  } catch (error) {
    reportExpansionError('Could not save open/closed preferences. This view will only be remembered until reload.', error);
  }
}

function getExpansionState(key) {
  if (key === null) return {};
  if (!isExpansionKey(key)) throw new Error('Invalid expansion preference identifier');
  return getExpansionStates()[key] || {};
}

function setExpansionValue(key, field, value) {
  if (key === null) return;
  const state = getExpansionState(key);
  if (JSON.stringify(state[field]) === JSON.stringify(value)) return;
  getExpansionStates()[key] = { ...state, [field]: value };
  persistExpansionStates();
}

function readExpandedItemIds() {
  return Object.entries(getExpansionStates())
    .filter(([key, state]) => key.startsWith('item:') && state.item === true)
    .map(([key]) => Number(key.slice(5)));
}

function rememberItemExpanded(itemId, open) {
  if (open) expandedItems.add(itemId);
  else expandedItems.delete(itemId);
  setExpansionValue(getItemViewKey(itemId), 'item', open);
}

function forgetItemViews(itemIds = null) {
  const states = getExpansionStates();
  const keys = itemIds === null ? Object.keys(states).filter(key => key.startsWith('item:')) : itemIds.map(getItemViewKey);
  let changed = false;
  for (const key of keys) {
    expandedItems.delete(Number(key.slice(5)));
    if (Object.hasOwn(states, key)) { delete states[key]; changed = true; }
  }
  if (changed) persistExpansionStates();
}

function pruneItemViews(itemIds) {
  const existing = new Set(itemIds);
  const missing = Object.keys(getExpansionStates()).filter(key => key.startsWith('item:'))
    .map(key => Number(key.slice(5))).filter(id => !existing.has(id));
  forgetItemViews(missing);
}

function getNoteOpenStates(key, count) {
  const saved = getExpansionState(key).notes || [];
  return Array.from({ length: count }, (_, index) => saved[index] !== false);
}

function remapNoteViews(itemId, count, from, to = null) {
  const key = getItemViewKey(itemId);
  const states = getNoteOpenStates(key, count);
  const [open] = states.splice(from, 1);
  if (to !== null) states.splice(to, 0, open);
  setExpansionValue(key, 'notes', states);
}

function renderCollapsibleDescription(source, format = 'plain', direction = 'auto', itemId = null,
  viewKey = itemId === null ? null : getItemViewKey(itemId)) {
  const open = getExpansionState(viewKey).description !== false;
  const state = viewKey === null ? '' : ` data-view-key="${escAttr(viewKey)}" ontoggle="onDescriptionToggle(this)"`;
  return `<details class="item-description"${open ? ' open' : ''}${state}>
    <summary><span class="item-description-title">Description</span></summary>
    ${renderDescription(source, format, direction)}
  </details>`;
}

function onDescriptionToggle(element) {
  if (element.isConnected === false) return;
  const key = element.dataset.viewKey;
  setExpansionValue(key, 'description', element.open);
  document.querySelectorAll(`.item-description[data-view-key="${key}"]`).forEach(description => {
    if (description !== element && description.open !== element.open) description.open = element.open;
  });
}

function updateNotesCollapseButton(section) {
  const button = section.querySelector('.notes-collapse-all');
  if (!button) return;
  const anyOpen = Array.from(section.querySelectorAll(':scope > .item-note')).some(note => note.open);
  button.textContent = anyOpen ? 'Collapse all' : 'Expand all';
  button.setAttribute('aria-label', anyOpen ? 'Collapse all notes' : 'Expand all notes');
}

function syncNoteViews(key) {
  document.querySelectorAll(`.item-notes[data-view-key="${key}"]`).forEach(section => {
    const cards = section.querySelectorAll(':scope > .item-note');
    const states = getNoteOpenStates(key, cards.length);
    cards.forEach((card, index) => { if (card.open !== states[index]) card.open = states[index]; });
    updateNotesCollapseButton(section);
  });
}

function onItemNoteToggle(element) {
  if (element.isConnected === false) return;
  const key = element.dataset.viewKey;
  const index = Number(element.dataset.noteIndex);
  const section = element.closest('.item-notes');
  const states = getNoteOpenStates(key, section.querySelectorAll(':scope > .item-note').length);
  states[index] = element.open;
  setExpansionValue(key, 'notes', states);
  syncNoteViews(key);
}

function toggleAllNotes(button) {
  const section = button.closest('.item-notes');
  const cards = section.querySelectorAll(':scope > .item-note');
  const open = !Array.from(cards).some(note => note.open);
  const key = section.dataset.viewKey;
  if (key) {
    setExpansionValue(key, 'notes', Array(cards.length).fill(open));
    syncNoteViews(key);
  } else {
    cards.forEach(card => { card.open = open; });
    updateNotesCollapseButton(section);
  }
}

function validateItemNotes(notes = []) {
  if (!Array.isArray(notes)) throw new Error('Notes must be a list');
  return notes.map(note => {
    if (!note || typeof note !== 'object' || Array.isArray(note) ||
        typeof note.title !== 'string' || typeof note.description !== 'string' ||
        !note.description.trim()) {
      throw new Error('Each note needs a text body and an optional text title');
    }
    if (note.descriptionFormat !== 'plain' && note.descriptionFormat !== 'markdown') {
      throw new Error('Unsupported note format');
    }
    if (!isDescriptionDirection(note.descriptionDirection)) {
      throw new Error('Unsupported note direction');
    }
    return {
      title: note.title,
      description: note.description,
      descriptionFormat: note.descriptionFormat,
      descriptionDirection: note.descriptionDirection,
    };
  });
}

function parseItemNotes(value = '[]') {
  if (typeof value !== 'string') throw new Error('Invalid stored notes');
  return validateItemNotes(JSON.parse(value));
}

function itemNotesMatch(notes, term) {
  return notes.some(note => note.title.toLowerCase().includes(term) ||
    note.description.toLowerCase().includes(term));
}

function renderItemNotes(notes = [], itemId = null, viewKey = itemId === null ? null : getItemViewKey(itemId),
  shareItemId = itemId) {
  let entries;
  try {
    entries = validateItemNotes(notes);
  } catch (error) {
    console.error('Could not display notes', error);
    return `<div class="description-render-error" role="alert">Could not display notes: ${esc(error.message)}</div>`;
  }
  if (!entries.length && itemId === null) return '';
  const states = getNoteOpenStates(viewKey, entries.length);
  const anyOpen = states.some(Boolean);
  return `<section class="item-notes" aria-label="Notes"${viewKey === null ? '' : ` data-view-key="${escAttr(viewKey)}"`}>
    ${entries.length ? `<div class="item-notes-header"><h3 class="item-notes-heading">Notes</h3>
      ${entries.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm notes-collapse-all"
        aria-label="${anyOpen ? 'Collapse' : 'Expand'} all notes" onclick="toggleAllNotes(this)">${anyOpen ? 'Collapse' : 'Expand'} all</button>` : ''}
    </div>` : ''}
    ${entries.map((note, index) => `
      <details class="item-note"${states[index] ? ' open' : ''}${viewKey === null ? '' : ` data-view-key="${escAttr(viewKey)}" data-note-index="${index}" ontoggle="onItemNoteToggle(this)"`}${itemId === null ? '' : ` data-note-item-id="${escAttr(String(itemId))}"
        ondragover="onNoteDragOver(event, ${itemId}, ${index})" ondragleave="onNoteDragLeave(event)"
        ondrop="onNoteDrop(event, ${itemId}, ${index})"`}>
        <summary>
          ${itemId === null || entries.length < 2 ? '' : `<button type="button" class="note-drag" draggable="true"
            aria-label="Reorder note ${index + 1}" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            title="Drag to reorder. Alt+Up/Down also moves this note."
            onclick="event.preventDefault();event.stopPropagation()"
            ondragstart="onNoteDragStart(event, ${itemId}, ${index})" ondragend="clearNoteDrag()"
            onpointerdown="onNotePointerDown(event, ${itemId}, ${index})" onpointermove="onNotePointerMove(event)"
            onpointerup="onNotePointerUp(event)" onpointercancel="onNotePointerCancel(event)"
            onlostpointercapture="onNotePointerCancel(event)"
            onkeydown="onNoteOrderKeydown(event, ${itemId}, ${index}, ${entries.length})">&#9776;</button>`}
          <span class="item-note-title" dir="auto">${esc(note.title || 'Note ' + (index + 1))}</span>
          ${itemId === null && shareItemId === null ? '' : `<span class="item-note-actions">
            ${itemId === null ? '' : `<button type="button" class="btn btn-ghost btn-sm" aria-label="Edit note ${index + 1}"
                    onclick="openItemNoteEditor(event, ${itemId}, ${index})">Edit</button>`}
            ${shareItemId === null ? '' : `<button type="button" class="btn btn-ghost btn-sm" aria-label="Share note ${index + 1}"
                    title="Share only this note" onclick="shareNote(event, ${shareItemId}, ${index})">Share</button>`}
            ${itemId === null ? '' : `<button type="button" class="btn btn-ghost btn-sm note-delete" aria-label="Delete note ${index + 1}"
                    onclick="deleteItemNote(event, ${itemId}, ${index})">Delete</button>`}
          </span>`}
        </summary>
        ${renderDescription(note.description, note.descriptionFormat, note.descriptionDirection)}
      </details>`).join('')}
    ${itemId === null ? '' : `<button type="button" class="btn btn-ghost btn-sm item-note-add"
      onclick="openItemNoteEditor(event, ${itemId})">+ Add note</button>`}
  </section>`;
}

function validateDescriptionMetadata(items) {
  const result = items[0];
  if (!result || !result.columns || !result.values) return;
  const formatIndex = result.columns.indexOf('description_format');
  if (formatIndex !== -1 && result.values.some(row => row[formatIndex] !== 'plain' && row[formatIndex] !== 'markdown')) {
    throw new Error('Unsupported description format in imported items');
  }
  const directionIndex = result.columns.indexOf('description_direction');
  if (directionIndex !== -1 && result.values.some(row => !isDescriptionDirection(row[directionIndex]))) {
    throw new Error('Unsupported description direction in imported items');
  }
  const notesIndex = result.columns.indexOf('notes');
  if (notesIndex !== -1) result.values.forEach(row => parseItemNotes(row[notesIndex]));
}
