const APP_THEMES = {
  dark: { background: '#1a2030', statusBar: 'black-translucent' },
  light: { background: '#f3f1ed', statusBar: 'default' },
};

function validateAppTheme(theme) {
  if (typeof theme !== 'string' || !Object.hasOwn(APP_THEMES, theme)) {
    throw new Error('Choose Dark or Light.');
  }
}

function applyAppTheme(theme) {
  validateAppTheme(theme);
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', APP_THEMES[theme].background);
  document.querySelector('meta[name="color-scheme"]').setAttribute('content', theme);
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    .setAttribute('content', APP_THEMES[theme].statusBar);
}

function getAppTheme() {
  return document.documentElement.getAttribute('data-theme');
}

function setAppTheme(theme) {
  validateAppTheme(theme);
  localStorage.setItem('dashora_theme', theme);
  applyAppTheme(theme);
}

function reportThemeError(message, error) {
  console.error(message, error);
  const notify = () => toast(message);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', notify, { once: true });
  } else {
    notify();
  }
}

function initializeAppTheme() {
  let theme = 'dark';
  try {
    const stored = localStorage.getItem('dashora_theme');
    if (stored !== null) {
      validateAppTheme(stored);
      theme = stored;
    }
  } catch (error) {
    reportThemeError('Could not load the theme preference. Using dark theme.', error);
  }
  applyAppTheme(theme);
}

initializeAppTheme();

window.addEventListener('storage', event => {
  if (event.storageArea !== localStorage || (event.key !== 'dashora_theme' && event.key !== null)) return;
  try {
    applyAppTheme(event.newValue === null ? 'dark' : event.newValue);
  } catch (error) {
    reportThemeError('Could not apply the updated theme preference.', error);
  }
});
