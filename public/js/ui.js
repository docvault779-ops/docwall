/* Shared helpers: API calls, icons, formatting, modal, toast. */
(function () {
  const ICONS = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M4 10h16M10 4v16"/></svg>',
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    fileText: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    checkCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    grad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    sheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
  };
  const icon = (n) => ICONS[n] || '';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(method, path, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (_) { data = {}; }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function fmtDate(iso, withTime = true) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    if (!withTime) return date;
    return date + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function relDue(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const diff = d - Date.now(); const abs = Math.abs(diff);
    const days = Math.floor(abs / 86400000), hrs = Math.floor((abs % 86400000) / 3600000), mins = Math.floor((abs % 3600000) / 60000);
    let t = days ? `${days}d ${hrs}h` : hrs ? `${hrs}h ${mins}m` : `${mins}m`;
    return diff >= 0 ? `due in ${t}` : `${t} overdue`;
  }
  function fmtSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function fileType(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const cls = /pdf/.test(ext) ? 'pdf' : /docx?|txt|md|rtf|odt|pptx?/.test(ext) ? 'doc' : /png|jpe?g|gif|webp|svg|bmp/.test(ext) ? 'img'
      : /zip|rar|7z|tar|gz/.test(ext) ? 'zip' : /xlsx?|csv|ods/.test(ext) ? 'sheet' : /py|js|java|c|cpp|h|html|css|json|ipynb|sql|sh/.test(ext) ? 'code' : 'other';
    return { ext: (ext || 'file').slice(0, 5).toUpperCase(), cls };
  }
  function fileItem(f, kind, extra = '') {
    const t = fileType(f.filename);
    return `<div class="file-item">
      <span class="ftype ${t.cls}">${esc(t.ext)}</span>
      <span class="fname" title="${esc(f.filename)}">${esc(f.filename)}</span>
      <span class="fsize">${fmtSize(f.size)}</span>
      <a class="btn btn-sm" href="/api/files/${kind}/${f.id}" download="${esc(f.filename)}" title="Download">${icon('download')} Download</a>${extra}
    </div>`;
  }
  function initials(name) { return (name || '?').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase(); }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  /* Pending-upload picker used by both apps */
  function filePicker(container, { maxFiles = 10, maxMB = 25 } = {}) {
    const files = [];
    container.innerHTML = `
      <label class="dropzone">${icon('upload')}<div><strong>Click to choose files</strong> or drag & drop</div>
        <div class="hint">Up to ${maxFiles} files, ${maxMB} MB each</div><input type="file" multiple></label>
      <div class="file-list pending" style="margin-top:10px"></div>`;
    const zone = container.querySelector('.dropzone'), input = container.querySelector('input'), list = container.querySelector('.pending');
    function render() {
      list.innerHTML = files.map((f, i) => {
        const t = fileType(f.name);
        return `<div class="file-item"><span class="ftype ${t.cls}">${esc(t.ext)}</span><span class="fname">${esc(f.name)}</span>
          <span class="fsize">${fmtSize(f.size)}</span><button type="button" class="icon-btn" data-i="${i}" title="Remove">${icon('x')}</button></div>`;
      }).join('');
      list.querySelectorAll('button').forEach((b) => b.onclick = () => { files.splice(+b.dataset.i, 1); render(); });
    }
    function add(fl) {
      for (const f of fl) {
        if (files.length >= maxFiles) { toast(`You can attach at most ${maxFiles} files.`, 'bad'); break; }
        if (f.size > maxMB * 1048576) { toast(`${f.name} is larger than ${maxMB} MB.`, 'bad'); continue; }
        files.push(f);
      }
      render();
    }
    input.onchange = () => { add(input.files); input.value = ''; };
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
    zone.addEventListener('drop', (e) => add(e.dataTransfer.files));
    return {
      files,
      async payload() {
        const out = [];
        for (const f of files) out.push({ name: f.name, data: await readFileAsBase64(f) });
        return out;
      },
    };
  }

  /* Toasts */
  let toastBox;
  function toast(msg, type = '') {
    if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toasts'; document.body.appendChild(toastBox); }
    const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; toastBox.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3200);
  }

  /* Modal */
  function modal({ title, body, footer = '', wide = false, onOpen }) {
    close();
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close title="Close">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ''}</div>`;
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
    document.body.appendChild(bg);
    document.addEventListener('keydown', escClose);
    if (onOpen) onOpen(bg.querySelector('.modal'));
    return bg.querySelector('.modal');
  }
  function escClose(e) { if (e.key === 'Escape') close(); }
  function close() { document.querySelectorAll('.modal-bg').forEach((m) => m.remove()); document.removeEventListener('keydown', escClose); }
  function confirmDialog(title, text, { danger = true, okLabel = 'Delete' } = {}) {
    return new Promise((resolve) => {
      const m = modal({ title, body: `<p style="color:var(--text-secondary)">${esc(text)}</p>`,
        footer: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okLabel)}</button>` });
      m.querySelector('[data-ok]').onclick = () => { close(); resolve(true); };
      m.closest('.modal-bg').addEventListener('click', (e) => { if (e.target === m.closest('.modal-bg') || e.target.closest('[data-close]')) resolve(false); });
    });
  }

  function emptyState(iconName, title, text) {
    return `<div class="empty">${icon(iconName)}<h3>${esc(title)}</h3><div>${esc(text)}</div></div>`;
  }

  /* Session guard shared by both apps */
  async function requireUser(role) {
    try {
      const { user, view_as, portal } = await api('GET', '/api/me');
      if (user.role === role) return user;
      // A teacher opening the student portal sees it through a chosen student's eyes.
      if (role === 'student' && user.role === 'teacher') {
        if (view_as) return { ...view_as, preview_by: user };
        location.href = portal === 'student' ? '/student/login' : '/teacher#/student-view';
        return null;
      }
      location.href = `/${role}/login`; return null;
    } catch (_) { location.href = `/${role}/login`; return null; }
  }

  async function logout(role) {
    try { await api('POST', '/api/auth/logout'); } catch (_) {}
    location.href = `/${role}/login`;
  }

  async function exitPreview() {
    try { await api('DELETE', '/api/preview'); } catch (_) {}
    location.href = '/teacher#/student-view';
  }

  function copyText(text) {
    return navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('Clipboard unavailable'));
  }

  function setupSidebarToggle() {
    const btn = document.querySelector('.menu-btn'), sb = document.querySelector('.sidebar');
    if (!btn || !sb) return;
    btn.onclick = () => sb.classList.toggle('open');
    document.addEventListener('click', (e) => { if (sb.classList.contains('open') && !sb.contains(e.target) && !btn.contains(e.target)) sb.classList.remove('open'); });
  }

  window.UI = { icon, esc, api, fmtDate, relDue, fmtSize, fileType, fileItem, filePicker, initials, toast, modal, closeModal: close, confirmDialog, emptyState, requireUser, logout, exitPreview, copyText, setupSidebarToggle };
})();
