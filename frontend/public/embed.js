/*!
 * Alejandro AI — embeddable chat widget.
 * <script src="https://YOUR-APP/embed.js" data-clinic="your-clinic-slug" async></script>
 * Optional: data-label="Need an appointment?" data-color="#4f46e5" data-position="left|right" data-open="true"
 * The chat runs inside an isolated iframe served by Alejandro AI; the host page never sees patient data.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || window.__alejandroAiWidget) return;
  window.__alejandroAiWidget = true;
  var slug = script.getAttribute('data-clinic');
  if (!slug) return console.warn('[Alejandro AI] Missing data-clinic attribute');
  var origin = new URL(script.src).origin;
  var color = script.getAttribute('data-color') || '#4f46e5';
  var label = script.getAttribute('data-label') || 'Chat';
  var side = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var z = 2147483000;

  var css =
    '.aai-btn{position:fixed;bottom:20px;' + side + ':20px;z-index:' + (z + 1) + ';display:flex;align-items:center;gap:10px;border:0;border-radius:999px;padding:8px 18px 8px 8px;background:' + color + ';color:#fff;font:600 14px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 12px 32px -8px rgba(15,23,42,.45);cursor:pointer;transition:transform .2s}' +
    '.aai-btn:hover{transform:translateY(-2px)}.aai-btn:focus-visible{outline:3px solid #a5b4fc;outline-offset:3px}' +
    '.aai-ic{display:grid;place-items:center;width:40px;height:40px;border-radius:999px;background:rgba(255,255,255,.18)}' +
    '.aai-frame{position:fixed;bottom:84px;' + side + ':20px;z-index:' + z + ';width:400px;height:min(640px,calc(100vh - 110px));border:0;border-radius:20px;box-shadow:0 30px 90px -20px rgba(15,23,42,.5);background:#fff;opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .25s,transform .25s}' +
    '.aai-open .aai-frame{opacity:1;transform:none;pointer-events:auto}' +
    '@media (max-width:640px){.aai-frame{inset:0;width:100%;height:100%;border-radius:0}.aai-open .aai-btn{top:10px;bottom:auto;padding:8px}.aai-open .aai-btn .aai-lb{display:none}}' +
    '@media (prefers-reduced-motion:reduce){.aai-btn,.aai-frame{transition:none}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var root = document.createElement('div');
  root.className = 'aai-root';
  var frame = null;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'aai-btn';
  btn.setAttribute('aria-expanded', 'false');
  var chatIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.4-4 8-9 8a9.8 9.8 0 0 1-4-.8L3 20l1.4-3.7A7.6 7.6 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8Z"/></svg>';
  var closeIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  function render(open) {
    btn.innerHTML = '<span class="aai-ic">' + (open ? closeIcon : chatIcon) + '</span><span class="aai-lb"></span>';
    btn.querySelector('.aai-lb').textContent = open ? '' : label;
    btn.setAttribute('aria-label', open ? 'Close chat' : label);
    btn.setAttribute('aria-expanded', String(open));
  }
  function toggle(force) {
    var open = typeof force === 'boolean' ? force : !root.classList.contains('aai-open');
    if (open && !frame) {
      frame = document.createElement('iframe');
      frame.className = 'aai-frame';
      frame.title = label;
      frame.src = origin + '/c/' + encodeURIComponent(slug) + '?embed=1';
      frame.allow = 'microphone; clipboard-write';
      root.insertBefore(frame, btn);
    }
    root.classList.toggle('aai-open', open);
    render(open);
  }
  btn.addEventListener('click', function () {
    toggle();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('aai-open')) {
      toggle(false);
      btn.focus();
    }
  });
  render(false);
  root.appendChild(btn);
  (document.body || document.documentElement).appendChild(root);
  if (script.getAttribute('data-open') === 'true') toggle(true);
  window.AlejandroAI = { open: function () { toggle(true); }, close: function () { toggle(false); } };
})();
