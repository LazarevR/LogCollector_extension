/**
 * background.js — service worker.
 *
 * • Click on icon  → collect data, write to clipboard, show page indicator.
 * • Right-click    → context menu → "Настройки" → opens settings.html.
 */

// ── Context menu setup ────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id:       'lc-settings',
    title:    'Настройки',
    contexts: ['action']
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'lc-settings') {
    chrome.runtime.openOptionsPage();
  }
});

// ── Icon click → collect ──────────────────────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  const url = tab.url || '';
  const isInjectable =
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('file://');

  if (!isInjectable) return;

  const stored = await chrome.storage.sync.get('lcSettings');
  const settings = { ...DEFAULTS, ...(stored.lcSettings || {}) };

  _collectAll(tab.id, settings).catch(() => {});
});

// ── Defaults (mirrored in settings.js) ───────────────────────────────────

const DEFAULTS = {
  url:            true,
  browser:        true,
  viewport:       true,
  localStorage:   false,
  cookies:        false,
  sessionStorage: false
};

// ── Main orchestrator ─────────────────────────────────────────────────────

async function _collectAll(tabId, settings) {
  const errors = [];
  const lines  = [];

  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || '';

  // Page data (browser info + viewport + optional storages)
  let pageData = null;
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func:   _collectPageData,
      args:   [{
        needLocalStorage:   !!settings.localStorage,
        needSessionStorage: !!settings.sessionStorage
      }]
    });
    pageData = r.result;
  } catch (e) {
    errors.push('Данные страницы: ' + e.message);
  }

  if (settings.url) {
    lines.push('Ссылка: ' + url);
  }

  if (settings.browser && pageData) {
    lines.push(
      'Браузер: ' + pageData.browserName +
      ', Версия: ' + pageData.browserVersion +
      pageData.arch
    );
  }

  if (settings.viewport && pageData) {
    lines.push('Разрешение: ' + pageData.viewport.w + 'x' + pageData.viewport.h);
  }

  if (settings.localStorage && pageData) {
    if (pageData.localStorageError) {
      errors.push('localStorage: ' + pageData.localStorageError);
    } else {
      const entries = Object.entries(pageData.localStorage || {});
      lines.push('');
      lines.push('LocalStorage (Ключей: ' + entries.length + '):');
      if (entries.length === 0) {
        lines.push('  (пусто)');
      } else {
        for (const [k, v] of entries) {
          const val = v && v.length > 300 ? v.slice(0, 300) + '…' : v;
          lines.push('  ' + k + ': ' + val);
        }
      }
    }
  }

  if (settings.sessionStorage && pageData) {
    if (pageData.sessionStorageError) {
      errors.push('sessionStorage: ' + pageData.sessionStorageError);
    } else {
      const entries = Object.entries(pageData.sessionStorage || {});
      lines.push('');
      lines.push('SessionStorage (Ключей: ' + entries.length + '):');
      if (entries.length === 0) {
        lines.push('  (пусто)');
      } else {
        for (const [k, v] of entries) {
          const val = v && v.length > 300 ? v.slice(0, 300) + '…' : v;
          lines.push('  ' + k + ': ' + val);
        }
      }
    }
  }

  if (settings.cookies) {
    try {
      const cookies = await chrome.cookies.getAll({ url });
      lines.push('');
      lines.push('Cookie (' + cookies.length + '):');
      if (cookies.length === 0) {
        lines.push('  (нет)');
      } else {
        for (const c of cookies) {
          lines.push('  ' + c.name + '=' + c.value);
        }
      }
    } catch (e) {
      errors.push('Cookies: ' + e.message);
    }
  }

  // Write to clipboard via page context
  const text = lines.join('\n');
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func:   _writeToClipboard,
      args:   [text]
    });
  } catch (e) {
    errors.push('Буфер обмена: ' + e.message);
  }

  // Show page indicator
  const indicatorFn = errors.length === 0 ? _showSuccessIndicator : _showErrorIndicator;
  chrome.tabs.sendMessage(tabId, {
    action: errors.length === 0 ? 'showSuccess' : 'showError'
  }).catch(() => {
    chrome.scripting.executeScript({
      target: { tabId },
      func:   indicatorFn
    }).catch(() => {});
  });

  return { text, errors };
}


// ─────────────────────────────────────────────────────────────────────────────
// Functions serialised into page context via executeScript (self-contained).
// ─────────────────────────────────────────────────────────────────────────────

async function _collectPageData({ needLocalStorage, needSessionStorage }) {
  let browserName    = 'Unknown';
  let browserVersion = 'Unknown';
  let arch           = '';

  if (navigator.userAgentData) {
    try {
      const hints = await navigator.userAgentData.getHighEntropyValues([
        'fullVersionList', 'architecture'
      ]);
      const PRIORITY = [
        'Yandex', 'YaBrowser', 'Opera',
        'Microsoft Edge', 'Edge',
        'Google Chrome', 'Chrome', 'Chromium'
      ];
      let chosen = null;
      for (const brand of PRIORITY) {
        chosen = hints.fullVersionList.find(
          b => b.brand.toLowerCase().includes(brand.toLowerCase())
        );
        if (chosen) break;
      }
      if (!chosen) {
        chosen = hints.fullVersionList.find(
          b => !b.brand.includes('Not') && b.version !== '99.0.0.0'
        );
      }
      if (chosen) { browserName = chosen.brand; browserVersion = chosen.version; }
      if (hints.architecture) arch = ' (' + hints.architecture + ')';
    } catch (_e) { /* fall through */ }
  }

  if (browserName === 'Unknown') {
    const ua = navigator.userAgent;
    const rules = [
      { name: 'Yandex Browser',  re: /YaBrowser\/([\d.]+)/      },
      { name: 'Opera',           re: /OPR\/([\d.]+)/            },
      { name: 'Firefox',         re: /Firefox\/([\d.]+)/        },
      { name: 'Samsung Browser', re: /SamsungBrowser\/([\d.]+)/ },
      { name: 'Edge',            re: /Edg\/([\d.]+)/            },
      {
        name: 'Safari', re: /Version\/([\d.]+)/,
        guard: () => ua.includes('Safari') && !ua.includes('Chrome')
      },
      { name: 'Chrome', re: /Chrome\/([\d.]+)/ }
    ];
    for (const r of rules) {
      if (r.guard && !r.guard()) continue;
      const m = ua.match(r.re);
      if (m) { browserName = r.name; browserVersion = m[1]; break; }
    }
  }

  const result = {
    browserName, browserVersion, arch,
    viewport: { w: window.innerWidth, h: window.innerHeight }
  };

  if (needLocalStorage) {
    try {
      const ls = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        ls[key] = localStorage.getItem(key);
      }
      result.localStorage = ls;
    } catch (e) { result.localStorageError = e.message; }
  }

  if (needSessionStorage) {
    try {
      const ss = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        ss[key] = sessionStorage.getItem(key);
      }
      result.sessionStorage = ss;
    } catch (e) { result.sessionStorageError = e.message; }
  }

  return result;
}

async function _writeToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch (_e) { /* fall through */ }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    Object.assign(el.style, { position: 'fixed', top: '-9999px', opacity: '0' });
    document.body.appendChild(el);
    el.focus(); el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return { ok };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _showSuccessIndicator() {
  document.getElementById('__lc_ind__')?.remove();
  document.getElementById('__lc_ind_styles__')?.remove();
  const style = document.createElement('style');
  style.id = '__lc_ind_styles__';
  style.textContent =
    '@keyframes __lc_pop{0%{transform:scale(0.5);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}' +
    '@keyframes __lc_out{to{opacity:0;transform:scale(0.85)}}';
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = '__lc_ind__';
  Object.assign(el.style, {
    all: 'initial', position: 'fixed', bottom: '20px', right: '20px',
    width: '50px', height: '50px', borderRadius: '50%',
    background: 'rgba(34,197,94,0.92)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: '2147483647',
    backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
    boxShadow: '0 0 18px 8px rgba(34,197,94,0.45), 0 2px 8px rgba(0,0,0,0.15)',
    animation: '__lc_pop 0.35s cubic-bezier(0.16,1,0.3,1) forwards'
  });
  el.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26" fill="none"><polyline points="5,13 11,19 21,7" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.animation = '__lc_out 0.3s ease forwards';
    setTimeout(() => el.remove(), 320);
  }, 2000);
}

function _showErrorIndicator() {
  document.getElementById('__lc_ind__')?.remove();
  document.getElementById('__lc_ind_styles__')?.remove();
  const style = document.createElement('style');
  style.id = '__lc_ind_styles__';
  style.textContent =
    '@keyframes __lc_pop{0%{transform:scale(0.5);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}' +
    '@keyframes __lc_out{to{opacity:0;transform:scale(0.85)}}';
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = '__lc_ind__';
  Object.assign(el.style, {
    all: 'initial', position: 'fixed', bottom: '20px', right: '20px',
    width: '50px', height: '50px', borderRadius: '50%',
    background: 'rgba(239,68,68,0.92)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: '2147483647',
    backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
    boxShadow: '0 0 18px 8px rgba(239,68,68,0.45), 0 2px 8px rgba(0,0,0,0.15)',
    animation: '__lc_pop 0.35s cubic-bezier(0.16,1,0.3,1) forwards'
  });
  el.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26" fill="none"><line x1="7" y1="7" x2="19" y2="19" stroke="white" stroke-width="2.8" stroke-linecap="round"/><line x1="19" y1="7" x2="7" y2="19" stroke="white" stroke-width="2.8" stroke-linecap="round"/></svg>';
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.animation = '__lc_out 0.3s ease forwards';
    setTimeout(() => el.remove(), 320);
  }, 2000);
}
