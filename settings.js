const DEFAULTS = {
  url:            true,
  browser:        true,
  viewport:       true,
  localStorage:   false,
  sessionStorage: false,
  cookies:        false
};

const toggles = {
  url:            document.getElementById('sUrl'),
  browser:        document.getElementById('sBrowser'),
  viewport:       document.getElementById('sViewport'),
  localStorage:   document.getElementById('sLocalStorage'),
  sessionStorage: document.getElementById('sSessionStorage'),
  cookies:        document.getElementById('sCookies')
};

const savedMsg = document.getElementById('savedMsg');
let saveTimer  = null;

// ── Load ──────────────────────────────────────────────

chrome.storage.sync.get('lcSettings', (stored) => {
  const s = { ...DEFAULTS, ...(stored.lcSettings || {}) };
  for (const [key, el] of Object.entries(toggles)) {
    el.checked = s[key];
  }
});

// ── Save on every toggle change ───────────────────────

for (const el of Object.values(toggles)) {
  el.addEventListener('change', save);
}

function save() {
  const s = {};
  for (const [key, el] of Object.entries(toggles)) {
    s[key] = el.checked;
  }
  chrome.storage.sync.set({ lcSettings: s });

  // Show "Сохранено" briefly
  clearTimeout(saveTimer);
  savedMsg.classList.add('visible');
  saveTimer = setTimeout(() => savedMsg.classList.remove('visible'), 1500);
}
