let descriptionMarkdownParser = null;
let descriptionMarkdownConverter = null;

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

function renderDescriptionContent(source, format = 'plain') {
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

  return DOMPurify.sanitize(descriptionMarkdownParser.parse(source), {
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
}

function renderDescriptionError(source, message) {
  console.error(message);
  return `<div class="description-render-error" role="alert">${esc(message)}</div><div class="description-source">${esc(source)}</div>`;
}

function renderDescription(source, format = 'plain') {
  const markdownClass = format === 'markdown' ? ' markdown-content' : '';
  return `<div class="item-detail-desc${markdownClass}">${renderDescriptionContent(source, format)}</div>`;
}

function validateDescriptionFormats(items) {
  const result = items[0];
  if (!result || !result.columns || !result.values) return;
  const formatIndex = result.columns.indexOf('description_format');
  if (formatIndex === -1) return;
  if (result.values.some(row => row[formatIndex] !== 'plain' && row[formatIndex] !== 'markdown')) {
    throw new Error('Unsupported description format in imported items');
  }
}
