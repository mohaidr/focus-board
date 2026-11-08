const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const theme = fs.readFileSync(path.join(__dirname, '..', 'js', 'theme.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
const worker = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function setup({ stored = null, readFails = false, writeFails = false, loading = false } = {}) {
  const calls = [];
  const values = new Map(stored === null ? [] : [['dashora_theme', stored]]);
  const listeners = {};
  const root = {
    attributes: { lang: 'en', dir: 'ltr' },
    setAttribute(name, value) { calls.push(['root', name, value]); this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] ?? null; },
  };
  const metadata = Object.fromEntries(['theme-color', 'color-scheme', 'apple-mobile-web-app-status-bar-style']
    .map(name => [name, { attributes: {},
      setAttribute(attribute, value) { this.attributes[attribute] = value; } }]));
  const localStorage = {
    getItem(key) {
      if (readFails && key === 'dashora_theme') throw new Error('Storage unavailable');
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (writeFails && key === 'dashora_theme') throw new Error('Storage unavailable');
      calls.push(['persist', key, value]);
      values.set(key, value);
    },
  };
  const elements = {};
  const context = vm.createContext({
    localStorage,
    document: {
      readyState: loading ? 'loading' : 'complete',
      documentElement: root,
      querySelector: selector => metadata[selector.match(/name="([^"]+)"/)[1]],
      addEventListener: (name, callback, options) => { listeners[name] = { callback, options }; },
      getElementById: id => elements[id] ||= {
        value: '', checked: false, style: {}, textContent: '', innerHTML: '',
        classList: { add: name => calls.push(['open', id, name]) },
      },
    },
    window: { addEventListener: (name, callback) => { listeners[name] = { callback }; } },
    console: { error: (...args) => calls.push(['error', ...args]) },
    toast: message => calls.push(['toast', message]),
    closeModal: id => calls.push(['close', id]),
    hasGlobalPassword: () => false,
    checkDueDateNotifications: () => calls.push(['reminders']),
  });
  vm.runInContext(theme, context);
  return { context, calls, values, localStorage, root, metadata, listeners, elements };
}

test('dark remains the initial default without changing saved preferences', () => {
  const { context, values, root, metadata } = setup();
  assert.equal(context.getAppTheme(), 'dark');
  assert.equal(root.attributes.lang, 'en');
  assert.equal(root.attributes.dir, 'ltr');
  assert.equal(values.has('dashora_theme'), false);
  assert.equal(metadata['theme-color'].attributes.content, '#1a2030');
  assert.equal(metadata['color-scheme'].attributes.content, 'dark');
  assert.equal(metadata['apple-mobile-web-app-status-bar-style'].attributes.content, 'black-translucent');
});

for (const value of ['dark', 'light']) {
  test(value + ' preference is applied during startup', () => {
    const { context, metadata, calls } = setup({ stored: value });
    assert.equal(context.getAppTheme(), value);
    assert.equal(metadata['theme-color'].attributes.content, value === 'light' ? '#ebe7df' : '#1a2030');
    assert.equal(metadata['color-scheme'].attributes.content, value);
    assert.equal(metadata['apple-mobile-web-app-status-bar-style'].attributes.content,
      value === 'light' ? 'default' : 'black-translucent');
    assert.equal(calls.some(call => call[0] === 'persist'), false);
  });
}

test('changing theme persists before applying and survives a new page', () => {
  const { context, values, calls } = setup();
  const offset = calls.length;
  context.setAppTheme('light');
  assert.deepEqual(calls.slice(offset), [
    ['persist', 'dashora_theme', 'light'], ['root', 'data-theme', 'light'],
  ]);
  assert.equal(context.getAppTheme(), 'light');
  assert.equal(setup({ stored: values.get('dashora_theme') }).context.getAppTheme(), 'light');
  context.setAppTheme('dark');
  assert.equal(values.get('dashora_theme'), 'dark');
  assert.equal(context.getAppTheme(), 'dark');
});

for (const value of ['', 'system', '__proto__', 'constructor', null, 1]) {
  test('invalid theme cannot be applied or saved: ' + String(value), () => {
    const { context, values, root } = setup();
    assert.throws(() => context.setAppTheme(value), /Choose Dark or Light/);
    assert.throws(() => context.applyAppTheme(value), /Choose Dark or Light/);
    assert.equal(values.has('dashora_theme'), false);
    assert.equal(root.attributes['data-theme'], 'dark');
  });
}

for (const options of [{ stored: 'unknown' }, { stored: '' }, { readFails: true }]) {
  test('unreadable theme preferences fall back explicitly, with logging and notification: ' + JSON.stringify(options), () => {
    const { context, calls } = setup(options);
    assert.equal(context.getAppTheme(), 'dark');
    assert.equal(calls.filter(call => call[0] === 'error').length, 1);
    assert.equal(calls.filter(call => call[0] === 'toast').length, 1);
    assert.match(calls.find(call => call[0] === 'toast')[1], /Using dark theme/);
  });
}

test('startup notifications wait for the app to load while the palette is applied immediately', () => {
  const { context, calls, listeners } = setup({ stored: 'unknown', loading: true });
  assert.equal(context.getAppTheme(), 'dark');
  assert.equal(calls.some(call => call[0] === 'toast'), false);
  assert.equal(listeners.DOMContentLoaded.options.once, true);
  listeners.DOMContentLoaded.callback();
  assert.equal(calls.filter(call => call[0] === 'toast').length, 1);
});

test('storage write failures leave the current appearance unchanged', () => {
  const { context, calls, values } = setup({ writeFails: true });
  const offset = calls.length;
  assert.throws(() => context.setAppTheme('light'), /Storage unavailable/);
  assert.equal(context.getAppTheme(), 'dark');
  assert.equal(values.has('dashora_theme'), false);
  assert.deepEqual(calls.slice(offset), []);
});

test('theme changes and preference removal synchronize from other local-storage tabs without writing back', () => {
  const { context, listeners, localStorage, calls } = setup();
  listeners.storage.callback({ key: 'dashora_theme', newValue: 'light', storageArea: localStorage });
  assert.equal(context.getAppTheme(), 'light');
  listeners.storage.callback({ key: 'dashora_theme', newValue: null, storageArea: localStorage });
  assert.equal(context.getAppTheme(), 'dark');
  context.applyAppTheme('light');
  listeners.storage.callback({ key: null, newValue: null, storageArea: localStorage });
  assert.equal(context.getAppTheme(), 'dark');
  assert.equal(calls.some(call => call[0] === 'persist'), false);
});

test('unrelated or session-storage changes cannot alter the theme', () => {
  const { context, listeners, localStorage } = setup({ stored: 'light' });
  listeners.storage.callback({ key: 'dashora_autosave', newValue: 'dark', storageArea: localStorage });
  listeners.storage.callback({ key: 'dashora_theme', newValue: 'dark', storageArea: {} });
  assert.equal(context.getAppTheme(), 'light');
});

test('invalid cross-tab preferences are logged and notified without changing the current theme', () => {
  const { context, listeners, localStorage, calls } = setup({ stored: 'light' });
  listeners.storage.callback({ key: 'dashora_theme', newValue: 'unknown', storageArea: localStorage });
  assert.equal(context.getAppTheme(), 'light');
  assert.equal(calls.filter(call => call[0] === 'error').length, 1);
  assert.equal(calls.filter(call => call[0] === 'toast').length, 1);
});

function settings(options) {
  const result = setup(options);
  vm.runInContext(app.slice(app.indexOf('function openSettingsModal('),
    app.indexOf('async function setGlobalPassword(')), result.context);
  vm.runInContext(app.slice(app.indexOf('function saveSettings('),
    app.indexOf('// Close modals on overlay click')), result.context);
  return result;
}

test('opening Settings reflects the active theme; canceling an unsaved choice keeps the current theme', () => {
  const { context, elements } = settings({ stored: 'light' });
  context.openSettingsModal();
  assert.equal(elements.appTheme.value, 'light');
  elements.appTheme.value = 'dark';
  context.closeModal('settingsModal');
  assert.equal(context.getAppTheme(), 'light');
  context.openSettingsModal();
  assert.equal(elements.appTheme.value, 'light');
});

test('saving a theme preserves existing settings behavior and does not rerender item content', () => {
  const { context, elements, calls, values } = settings();
  context.openSettingsModal();
  elements.appTheme.value = 'light';
  elements.autoDeleteEnabled.checked = true;
  elements.autoDeleteDays.value = '3';
  elements.autoSaveEnabled.checked = true;
  context.saveSettings();
  assert.equal(context.getAppTheme(), 'light');
  assert.equal(values.get('dashora_theme'), 'light');
  assert.equal(values.get('dashora_autodelete_enabled'), 'true');
  assert.equal(values.get('dashora_autodelete_days'), '3');
  assert.equal(values.get('dashora_autosave'), 'true');
  assert.equal(values.get('dashora_notifications'), 'false');
  assert.ok(calls.some(call => call[0] === 'close' && call[1] === 'settingsModal'));
  assert.ok(calls.some(call => call[0] === 'toast' && call[1] === 'Settings saved'));
});

for (const options of [{ writeFails: true }, {}]) {
  test('failed theme saves remain open and cannot claim success: ' + JSON.stringify(options), () => {
    const { context, elements, calls, values } = settings(options);
    context.openSettingsModal();
    elements.appTheme.value = options.writeFails ? 'light' : 'invalid';
    const offset = calls.length;
    context.saveSettings();
    assert.equal(context.getAppTheme(), 'dark');
    assert.equal(values.has('dashora_autodelete_enabled'), false);
    assert.equal(calls.slice(offset).some(call => call[0] === 'close'), false);
    assert.equal(calls.slice(offset).some(call => call[0] === 'error'), true);
    assert.match(calls.slice(offset).find(call => call[0] === 'toast')[1], /Could not save theme/);
  });
}

test('theme bootstrap and metadata precede styles, and the bootstrap is cached offline', () => {
  const script = html.indexOf('<script src="js/theme.js"></script>');
  assert.ok(script > 0 && script < html.indexOf('<link rel="stylesheet" href="css/style.css">'));
  for (const name of ['theme-color', 'color-scheme', 'apple-mobile-web-app-status-bar-style']) {
    const position = html.indexOf('name="' + name + '"');
    assert.ok(position >= 0 && position < script);
  }
  assert.match(worker, /'\.\/js\/theme\.js'/);
  assert.match(worker, /const CACHE_VERSION = 39;/);
});

const darkBlock = css.match(/:root\s*\{([\s\S]*?)\}/);
const lightBlock = css.match(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\}/);
assert.ok(darkBlock && lightBlock);

function declarations(block) {
  return Object.fromEntries(Array.from(block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g),
    match => [match[1], match[2].trim()]));
}

const dark = declarations(darkBlock[1]);
const light = { ...dark, ...declarations(lightBlock[1]) };

function value(name, palette = light) {
  assert.ok(Object.hasOwn(palette, name), 'Missing palette token ' + name);
  const reference = palette[name].match(/^var\((--[\w-]+)\)$/);
  return reference ? value(reference[1], palette) : palette[name];
}

function rgb(color) {
  assert.match(color, /^#[0-9a-f]{6}$/i);
  return [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
}

function luminance(channels) {
  return channels.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function blend(foreground, opacity, background) {
  return foreground.map((channel, index) => channel * opacity + background[index] * (1 - opacity));
}

test('light theme uses lower-luminance warm surfaces rather than glaring white panels', () => {
  for (const token of ['--bg', '--surface', '--card']) {
    const brightness = luminance(rgb(value(token)));
    assert.ok(brightness <= 0.85, token + ' is too bright: ' + brightness.toFixed(3));
    assert.notEqual(value(token), '#ffffff');
  }
});

test('flex inputs can shrink inside narrow cards without pushing their buttons outside', () => {
  for (const selector of ['.followup-input', '.due-date-input', '.recurring-time-input']) {
    const block = css.slice(css.indexOf(selector + ' {')).split('}')[0];
    assert.match(block, /min-width:\s*0;/, selector);
  }
  assert.match(css, /\.followup-add \.btn\s*\{\s*flex-shrink:\s*0;/);
  assert.match(css, /\.item-meta-row\s*\{[^}]*flex-wrap:\s*wrap;/);
  assert.match(css, /\.item-quick-actions\s*\{[^}]*min-width:\s*0;/);
});

test('Arabic typography is shared across RTL fields, mixed text and code fallbacks', () => {
  for (const token of ['--font-ui', '--font-heading', '--font-code', '--font-arabic']) {
    assert.match(dark[token], /Noto Kufi Arabic/, token);
  }
  assert.match(css, /#itemDesc:dir\(rtl\)/);
  assert.match(css, /\.followup-input:dir\(rtl\)/);
  assert.match(app, /class="followup-input" dir="auto"/);
  assert.match(app, /class="followup-input followup-edit-input" dir="auto"/);
  const fontUrl = html.match(/<link href="([^"]*fonts\.googleapis\.com[^"]+)"[^>]*crossorigin="anonymous"/)[1];
  assert.ok(fontUrl.includes('Noto+Kufi+Arabic'));
  assert.ok(worker.includes("'" + fontUrl + "'"));
});

test('dark colors are preserved and browser UI colors match the corresponding CSS palette', () => {
  assert.equal(dark['--bg'], '#1a2030');
  assert.equal(dark['--surface'], '#202840');
  assert.equal(dark['--text'], '#e0e4ee');
  assert.equal(dark['--accent'], '#6e8efb');
  for (const stored of ['dark', 'light']) {
    const { metadata } = setup({ stored });
    assert.equal(metadata['theme-color'].attributes.content, value('--bg', stored === 'dark' ? dark : light));
  }
});

for (const background of ['--bg', '--surface', '--card', '--surface-hover', '--card-hover']) {
  test('light text and status colors meet 4.5:1 contrast on ' + background, () => {
    for (const foreground of ['--text', '--text-muted', '--accent', '--danger', '--success', '--warning', '--warm-text']) {
      const ratio = contrast(rgb(value(foreground)), rgb(value(background)));
      assert.ok(ratio >= 4.5, foreground + ' on ' + background + ': ' + ratio.toFixed(2));
    }
  });
}

test('light primary, danger and status buttons retain readable white labels', () => {
  for (const background of ['--accent', '--accent-hover', '--danger', '--danger-hover', '--success', '--warning']) {
    const ratio = contrast(rgb('#ffffff'), rgb(value(background)));
    assert.ok(ratio >= 4.5, 'White on ' + background + ': ' + ratio.toFixed(2));
  }
});

test('active navigation counts retain 4.5:1 contrast through their translucent background', () => {
  const background = blend(rgb('#ffffff'), 0.2, rgb(value('--accent')));
  const ratio = contrast(rgb('#ffffff'), background);
  assert.ok(ratio >= 4.5, 'Navigation count: ' + ratio.toFixed(2));
});

test('light input boundaries meet 3:1 contrast on editor, search and follow-up surfaces', () => {
  for (const background of ['--bg', '--surface', '--card']) {
    const ratio = contrast(rgb(value('--control-border')), rgb(value(background)));
    assert.ok(ratio >= 3, 'Input border on ' + background + ': ' + ratio.toFixed(2));
  }
});

test('translucent card, column and indicator surfaces keep muted text readable', () => {
  const body = rgb(value('--bg'));
  const surface = value('--surface-rgb').split(',').map(Number);
  const gradient = value('--card-gradient-rgb').split(',').map(Number);
  const inset = value('--inset-rgb').split(',').map(Number);
  const column = blend(surface, 0.66, body);
  const card = blend(gradient, 0.9, column);
  for (const background of [column, card, blend(inset, 0.45, card), blend(inset, 0.55, column)]) {
    const ratio = contrast(rgb(value('--text-muted')), background);
    assert.ok(ratio >= 4.5, 'Muted text on translucent surface: ' + ratio.toFixed(2));
  }
});

test('fixed dark panels and native date/time overrides cannot leak into light mode', () => {
  const content = css.replace(darkBlock[0], '').replace(lightBlock[0], '');
  assert.doesNotMatch(content, /rgba\((?:13,\s*18,\s*31|26,\s*32,\s*48|32,\s*40,\s*64|42,\s*52,\s*80),/);
  assert.doesNotMatch(content, /color-scheme:\s*dark/);
  assert.match(content, /\.sketch-canvas-wrap\s*\{[^}]*background:\s*#181e2e/);
  assert.match(content, /\.sketch-preview-large\s*\{[^}]*background:\s*#181e2e/);
  assert.doesNotMatch(content, /filter:\s*invert/);
});
