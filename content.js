/**
 * content.js — minimal content script.
 *
 * Only responsibility: listen for messages from background.js
 * and render the success / error indicator on the page.
 *
 * The heavy lifting (data collection, clipboard) is done by
 * background.js via chrome.scripting.executeScript.
 */

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (message.action === 'showSuccess') {
    _showIndicator('success');
    sendResponse({ ok: true });
  } else if (message.action === 'showError') {
    _showIndicator('error');
    sendResponse({ ok: true });
  }
});


// ─── Indicator ────────────────────────────────────────────────────────────

function _showIndicator(kind) {
  _cleanup();
  _injectStyles();

  const isSuccess = kind === 'success';

  const el = document.createElement('div');
  el.id = '__lc_ind__';

  Object.assign(el.style, {
    all:                  'initial',
    position:             'fixed',
    bottom:               '20px',
    right:                '20px',
    width:                '50px',
    height:               '50px',
    borderRadius:         '50%',
    background:           isSuccess ? 'rgba(34,197,94,0.92)' : 'rgba(239,68,68,0.92)',
    display:              'flex',
    alignItems:           'center',
    justifyContent:       'center',
    zIndex:               '2147483647',
    backdropFilter:       'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    boxShadow:            isSuccess
      ? '0 0 18px 8px rgba(34,197,94,0.45), 0 2px 8px rgba(0,0,0,0.15)'
      : '0 0 18px 8px rgba(239,68,68,0.45), 0 2px 8px rgba(0,0,0,0.15)',
    animation:            '__lc_pop 0.35s cubic-bezier(0.16,1,0.3,1) forwards'
  });

  el.innerHTML = isSuccess
    ? '<svg width="26" height="26" viewBox="0 0 26 26" fill="none">' +
        '<polyline points="5,13 11,19 21,7"' +
          ' stroke="white" stroke-width="2.8"' +
          ' stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>'
    : '<svg width="26" height="26" viewBox="0 0 26 26" fill="none">' +
        '<line x1="7" y1="7" x2="19" y2="19"' +
          ' stroke="white" stroke-width="2.8" stroke-linecap="round"/>' +
        '<line x1="19" y1="7" x2="7" y2="19"' +
          ' stroke="white" stroke-width="2.8" stroke-linecap="round"/>' +
      '</svg>';

  document.body.appendChild(el);
  _scheduleRemoval(el);
}


// ─── Helpers ──────────────────────────────────────────────────────────────

function _injectStyles() {
  if (document.getElementById('__lc_styles__')) return;
  const s = document.createElement('style');
  s.id = '__lc_styles__';
  s.textContent =
    '@keyframes __lc_pop{' +
      '0%{transform:scale(0.5);opacity:0}' +
      '70%{transform:scale(1.08)}' +
      '100%{transform:scale(1);opacity:1}' +
    '}' +
    '@keyframes __lc_out{to{opacity:0;transform:scale(0.85)}}';
  document.head.appendChild(s);
}

function _scheduleRemoval(el) {
  setTimeout(function () {
    el.style.animation = '__lc_out 0.3s ease forwards';
    setTimeout(function () { el.remove(); }, 320);
  }, 2000);
}

function _cleanup() {
  document.getElementById('__lc_ind__')?.remove();
  document.getElementById('__lc_styles__')?.remove();
}
