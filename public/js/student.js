/* Student portal: read-only view of published assignments + submit work. */
(async function () {
  const { icon, esc, api, fmtDate, relDue, fmtSize, fileItem, toast, emptyState } = UI;
  const user = await UI.requireUser('student');
  if (!user) return;

  const view = document.getElementById('view');
  const state = { assignments: [], loaded: false, q: '' };

  /* ---- shell ---- */
  document.getElementById('sb-name').textContent = user.name;
  document.getElementById('sb-meta').textContent = [user.roll_no, user.group_name].filter(Boolean).join(' · ') || user.email;
  document.getElementById('sb-avatar').textContent = UI.initials(user.name);
  document.getElementById('tb-avatar').textContent = UI.initials(user.name);
  const preview = user.preview_by || null;
  document.getElementById('logout').innerHTML = icon(preview ? 'x' : 'logout');
  document.getElementById('logout').title = preview ? 'Exit preview' : 'Sign out';
  document.getElementById('logout').onclick = () => (preview ? UI.exitPreview() : UI.logout('student'));
  if (preview) {
    const bar = document.createElement('div');
    bar.className = 'preview-bar';
    bar.innerHTML = `${icon('eye')}<div class="min0"><strong>Teacher preview</strong> · You (${esc(preview.name)}) are viewing the student portal as <strong>${esc(user.name)}</strong>${user.roll_no ? ` (${esc(user.roll_no)}${user.group_name ? ', ' + esc(user.group_name) : ''})` : ''}. Submitting and password changes are disabled.</div>
      <a class="btn btn-sm" href="/teacher#/student-view">Switch student</a><button class="btn btn-sm btn-primary" id="exit-preview">Exit preview</button>`;
    document.querySelector('.main').prepend(bar);
    bar.querySelector('#exit-preview').onclick = UI.exitPreview;
  }
  document.getElementById('search-ico').innerHTML = icon('search');
  document.querySelector('.menu-btn').innerHTML = icon('menu');
  UI.setupSidebarToggle();
  document.getElementById('search').oninput = (e) => { state.q = e.target.value.trim().toLowerCase(); if (!location.hash.startsWith('#/assignments')) location.hash = '#/assignments'; else route(); };

  const NAV = { dashboard: ['Dashboard', 'dashboard'], assignments: ['Assignments', 'book'], submitted: ['Submitted', 'checkCircle'], grades: ['Grades', 'star'], profile: ['Profile', 'user'] };
  function paintNav(active) {
    const counts = { assignments: state.assignments.filter((a) => a.state === 'pending').length, submitted: state.assignments.filter((a) => a.state === 'submitted').length, grades: state.assignments.filter((a) => a.state === 'graded').length };
    for (const [key, [label, ic]] of Object.entries(NAV)) {
      const el = document.querySelector(`[data-nav="${key}"]`);
      el.innerHTML = `${icon(ic)}<span>${label}</span>${counts[key] != null ? `<span class="count">${counts[key]}</span>` : ''}`;
      el.classList.toggle('active', key === active);
    }
  }

  async function load() {
    const { assignments } = await api('GET', '/api/student/assignments');
    state.assignments = assignments; state.loaded = true;
  }

  const badge = (s) => `<span class="badge ${s}">${{ pending: 'Pending', submitted: 'Submitted', graded: 'Graded', overdue: 'Overdue' }[s] || s}</span>`;

  function card(a) {
    const due = new Date(a.due_at);
    const soon = a.state === 'pending' && due - Date.now() < 2 * 86400000;
    return `<a class="card a-card" href="#/assignment/${a.id}">
      <div class="top"><span class="subject">${esc(a.subject || 'General')}</span>${badge(a.state)}</div>
      <h3>${esc(a.title)}</h3>
      <p class="desc">${esc(a.description || 'No description provided.')}</p>
      <div class="foot">
        <span style="${soon ? 'color:var(--danger);font-weight:600' : ''}">${icon('calendar')}${fmtDate(a.due_at)}</span>
        <span>${a.files.length ? `${icon('file')}${a.files.length} file${a.files.length > 1 ? 's' : ''}` : ''}${a.grade != null ? `${icon('star')}${a.grade}/${a.max_marks}` : ''}</span>
      </div></a>`;
  }

  /* ---- pages ---- */
  function renderDashboard() {
    paintNav('dashboard');
    const by = (s) => state.assignments.filter((a) => a.state === s);
    const pending = by('pending').sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
    const recentGraded = by('graded').sort((a, b) => new Date(b.graded_at) - new Date(a.graded_at)).slice(0, 4);
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    view.innerHTML = `
      <div class="page-head"><div><h1>${greet}, ${esc(user.name.split(' ')[0])}</h1><p class="sub">${user.group_name ? `Class ${esc(user.group_name)} · ` : ''}${pending.length ? `${pending.length} assignment${pending.length > 1 ? 's' : ''} waiting for you` : 'You are all caught up'}</p></div></div>
      <div class="stats">
        ${stat('tint-blue', 'clock', 'Pending', pending.length)}
        ${stat('tint-violet', 'checkCircle', 'Submitted', by('submitted').length)}
        ${stat('tint-green', 'star', 'Graded', by('graded').length)}
        ${stat('tint-red', 'alert', 'Overdue', by('overdue').length)}
      </div>
      <div class="section-title">${icon('clock')} Due soon</div>
      ${pending.length ? `<div class="cards">${pending.slice(0, 6).map(card).join('')}</div>` : emptyState('checkCircle', 'Nothing pending', 'New assignments from your teachers will show up here.')}
      ${recentGraded.length ? `<div class="section-title">${icon('star')} Recently graded</div><div class="cards">${recentGraded.map(card).join('')}</div>` : ''}`;
  }
  const stat = (tint, ic, lbl, val) => `<div class="card stat"><div class="ico ${tint}">${icon(ic)}</div><div><div class="lbl">${lbl}</div><div class="val">${val}</div></div></div>`;

  function renderList(filter, navKey, title) {
    paintNav(navKey);
    const FILTERS = [['all', 'All'], ['pending', 'Pending'], ['submitted', 'Submitted'], ['graded', 'Graded'], ['overdue', 'Overdue']];
    let items = state.assignments.slice();
    if (filter !== 'all') items = items.filter((a) => a.state === filter);
    if (state.q) items = items.filter((a) => (a.title + ' ' + a.subject + ' ' + a.description).toLowerCase().includes(state.q));
    const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k === 'all' ? state.assignments.length : state.assignments.filter((a) => a.state === k).length]));
    view.innerHTML = `
      <div class="page-head"><div><h1>${icon('book')} ${title}</h1><p class="sub">Assignments published for ${user.group_name ? `class ${esc(user.group_name)}` : 'you'}${state.q ? ` · filtered by “${esc(state.q)}”` : ''}</p></div></div>
      <div class="chips">${FILTERS.map(([k, l]) => `<a class="chip ${k === filter ? 'active' : ''}" href="#/assignments${k === 'all' ? '' : '/' + k}">${l}<span class="n">${counts[k]}</span></a>`).join('')}</div>
      ${items.length ? `<div class="cards">${items.map(card).join('')}</div>` : emptyState('inbox', 'No assignments here', state.q ? 'Try a different search.' : 'Check back later or try another filter.')}`;
  }

  function renderGrades() {
    paintNav('grades');
    const graded = state.assignments.filter((a) => a.state === 'graded');
    const total = graded.reduce((s, a) => s + a.grade, 0), max = graded.reduce((s, a) => s + a.max_marks, 0);
    view.innerHTML = `
      <div class="page-head"><div><h1>${icon('star')} Grades</h1><p class="sub">${graded.length ? `${graded.length} graded · overall ${total}/${max} (${Math.round((total / max) * 100)}%)` : 'Nothing has been graded yet'}</p></div></div>
      ${graded.length ? `<div class="card table-wrap"><table><thead><tr><th>Assignment</th><th>Subject</th><th>Submitted</th><th>Marks</th><th>Feedback</th></tr></thead><tbody>
        ${graded.map((a) => `<tr><td><a href="#/assignment/${a.id}" class="strong">${esc(a.title)}</a></td><td>${esc(a.subject || '—')}</td><td>${fmtDate(a.submitted_at)}${a.is_late ? ' <span class="badge late">Late</span>' : ''}</td><td><span class="strong">${a.grade}</span> <span class="dim">/ ${a.max_marks}</span></td><td class="dim">${esc(a.feedback || '—')}</td></tr>`).join('')}
      </tbody></table></div>` : emptyState('star', 'No grades yet', 'Marks and feedback will appear here once your teacher grades your work.')}`;
  }

  async function renderDetail(id) {
    paintNav('assignments');
    view.innerHTML = '<div class="loading">Loading…</div>';
    let a;
    try { ({ assignment: a } = await api('GET', `/api/student/assignments/${id}`)); }
    catch (e) { view.innerHTML = emptyState('alert', 'Assignment not available', e.message); return; }

    const statusCallout = a.state === 'graded'
      ? `<div class="callout ok">${icon('star')}<div><strong>Graded: ${a.grade} / ${a.max_marks}</strong>${a.feedback ? `<div style="margin-top:4px">${esc(a.feedback)}</div>` : ''}<div class="hint" style="margin-top:4px">Graded on ${fmtDate(a.graded_at)}</div></div></div>`
      : a.state === 'submitted'
        ? `<div class="callout ok">${icon('checkCircle')}<div><strong>Submitted</strong> on ${fmtDate(a.submitted_at)}${a.is_late ? ' (late)' : ''}. ${a.can_submit ? 'You can resubmit until the deadline; the new submission replaces the old one.' : 'Waiting for your teacher to grade it.'}</div></div>`
        : a.state === 'overdue'
          ? `<div class="callout bad">${icon('alert')}<div><strong>Deadline passed</strong> on ${fmtDate(a.due_at)}. ${a.can_submit ? 'Late submissions are still accepted and will be marked late.' : 'Late submissions are not accepted.'}</div></div>`
          : `<div class="callout info">${icon('clock')}<div><strong>${relDue(a.due_at)}</strong> · deadline ${fmtDate(a.due_at)}</div></div>`;

    view.innerHTML = `
      <div class="crumb"><a href="#/assignments">Assignments</a> › <span>${esc(a.subject || 'General')}</span></div>
      <div class="page-head">
        <div><h1>${esc(a.title)}</h1>
          <div class="meta-row" style="margin-top:8px">
            <span>${icon('tag')}${esc(a.subject || 'General')}</span>
            <span>${icon('users')}${a.target_group ? esc(a.target_group) : 'All students'}</span>
            <span>${icon('calendar')}Due ${fmtDate(a.due_at)}</span>
            <span>${icon('star')}${a.max_marks} marks</span>
          </div></div>
        ${badge(a.state)}
      </div>
      <div class="detail">
        <div>
          <div class="card card-pad">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="font-size:15px">Instructions</h3><button class="btn btn-sm" id="copy-desc">${icon('copy')} Copy text</button></div>
            <div class="prose">${esc(a.description || 'No written instructions. See the attached files.')}</div>
          </div>
          <div class="section-title">${icon('file')} Attachments <span class="n">${a.files.length}</span></div>
          ${a.files.length ? `<div class="file-list">${a.files.map((f) => fileItem(f, 'assignment')).join('')}</div>` : `<div class="card card-pad" style="color:var(--text-muted)">The teacher did not attach any files.</div>`}
        </div>
        <div>
          ${statusCallout}
          ${a.submission_id ? `<div class="card card-pad" style="margin-top:14px"><h3 style="font-size:15px;margin-bottom:10px">Your submission</h3>
              ${a.text_answer ? `<div class="prose" style="font-size:13.5px;margin-bottom:10px">${esc(a.text_answer)}</div>` : ''}
              ${a.submission_files.length ? `<div class="file-list">${a.submission_files.map((f) => fileItem(f, 'submission')).join('')}</div>` : '<div class="hint">No files attached.</div>'}
            </div>` : ''}
          ${a.can_submit && preview ? `<div class="callout info" style="margin-top:14px">${icon('eye')}<div>The student would see a <strong>${a.submission_id ? 'Resubmit work' : 'Submit your work'}</strong> form here. Submitting is disabled while you preview.</div></div>` : ''}
          ${a.can_submit && !preview ? `<div class="card card-pad" style="margin-top:14px">
              <h3 style="font-size:15px;margin-bottom:12px">${a.submission_id ? 'Resubmit work' : 'Submit your work'}</h3>
              <form id="submit-form">
                <div class="field"><label for="answer">Written answer <span class="hint">(optional if you attach files)</span></label><textarea id="answer" placeholder="Type your answer or notes for the teacher…"></textarea></div>
                <div class="field"><label>Files</label><div id="picker"></div></div>
                <button class="btn btn-primary btn-block" type="submit">${icon('send')} ${a.submission_id ? 'Replace submission' : 'Submit assignment'}</button>
              </form></div>`
          : (!a.accept_submissions && a.state !== 'graded' ? `<div class="callout warn" style="margin-top:14px">${icon('lock')}<div>Submissions are closed by the teacher.</div></div>` : '')}
          <dl class="kv card card-pad" style="margin-top:14px">
            <dt>Posted</dt><dd>${fmtDate(a.created_at, false)}</dd>
            <dt>Last updated</dt><dd>${fmtDate(a.updated_at, false)}</dd>
            <dt>Late submissions</dt><dd>${a.allow_late ? 'Allowed' : 'Not allowed'}</dd>
          </dl>
        </div>
      </div>`;

    document.getElementById('copy-desc').onclick = () => {
      const text = `${a.title}\nSubject: ${a.subject || 'General'}\nDue: ${fmtDate(a.due_at)}\nMax marks: ${a.max_marks}\n\n${a.description}`;
      UI.copyText(text).then(() => toast('Instructions copied to clipboard', 'ok')).catch(() => toast('Could not copy', 'bad'));
    };
    const form = document.getElementById('submit-form');
    if (form) {
      const picker = UI.filePicker(document.getElementById('picker'));
      form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        const text = document.getElementById('answer').value.trim();
        if (!text && !picker.files.length) { toast('Write an answer or attach a file first.', 'bad'); return; }
        btn.disabled = true; btn.textContent = 'Uploading…';
        try {
          await api('POST', `/api/student/assignments/${id}/submit`, { text_answer: text, files: await picker.payload() });
          toast('Submission received!', 'ok');
          await load(); renderDetail(id);
        } catch (ex) { toast(ex.message, 'bad'); btn.disabled = false; btn.innerHTML = `${icon('send')} Submit assignment`; }
      };
    }
  }

  function renderProfile() {
    paintNav('profile');
    view.innerHTML = `
      <div class="page-head"><div><h1>${icon('user')} Profile</h1><p class="sub">Your account details are managed by the college.</p></div></div>
      <div class="detail">
        <dl class="kv card card-pad">
          <dt>Name</dt><dd>${esc(user.name)}</dd><dt>Roll number</dt><dd>${esc(user.roll_no || '—')}</dd>
          <dt>Class / section</dt><dd>${esc(user.group_name || '—')}</dd><dt>Email</dt><dd>${esc(user.email)}</dd><dt>Role</dt><dd>Student</dd>
        </dl>
        ${preview ? `<div class="callout info">${icon('eye')}<div>Students can change their password here. Use <em>Students</em> in the teacher portal to reset a password.</div></div>` : `<form class="card card-pad" id="pw-form"><h3 style="font-size:15px;margin-bottom:12px">Change password</h3>
          <div class="field"><label>Current password</label><input type="password" name="current_password" required autocomplete="current-password"></div>
          <div class="field"><label>New password</label><input type="password" name="new_password" minlength="6" required autocomplete="new-password"></div>
          <button class="btn btn-primary" type="submit">Update password</button></form>`}
      </div>`;
    const pwForm = document.getElementById('pw-form');
    if (pwForm) pwForm.onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/me/password', Object.fromEntries(new FormData(e.target).entries())); toast('Password updated', 'ok'); e.target.reset(); }
      catch (ex) { toast(ex.message, 'bad'); }
    };
  }

  /* ---- router ---- */
  async function route() {
    if (!state.loaded) { try { await load(); } catch (e) { view.innerHTML = emptyState('alert', 'Could not load assignments', e.message); return; } }
    const h = location.hash || '#/dashboard';
    let m;
    if (h === '#/dashboard') renderDashboard();
    else if ((m = h.match(/^#\/assignments(?:\/(pending|submitted|graded|overdue))?$/))) renderList(m[1] || 'all', 'assignments', 'Assignments');
    else if (h === '#/submitted') renderList('submitted', 'submitted', 'Submitted work');
    else if (h === '#/grades') renderGrades();
    else if ((m = h.match(/^#\/assignment\/(\d+)$/))) renderDetail(+m[1]);
    else if (h === '#/profile') renderProfile();
    else location.hash = '#/dashboard';
    document.querySelector('.sidebar').classList.remove('open');
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', async () => { await load().catch(() => {}); route(); });
  route();
})();
