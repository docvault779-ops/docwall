/* Teacher portal: full control over assignments, submissions, grading and accounts. */
(async function () {
  const { icon, esc, api, fmtDate, relDue, fmtSize, fileItem, toast, modal, closeModal, confirmDialog, emptyState } = UI;
  const user = await UI.requireUser('teacher');
  if (!user) return;

  const view = document.getElementById('view');
  const state = { assignments: null, q: '' };

  /* ---- shell ---- */
  document.getElementById('sb-name').textContent = user.name;
  document.getElementById('sb-meta').textContent = user.email;
  document.getElementById('sb-avatar').textContent = UI.initials(user.name);
  document.getElementById('tb-avatar').textContent = UI.initials(user.name);
  document.getElementById('logout').innerHTML = icon('logout');
  document.getElementById('logout').onclick = () => UI.logout('teacher');
  document.getElementById('search-ico').innerHTML = icon('search');
  document.getElementById('new-cta').innerHTML = `${icon('plus')} New assignment`;
  document.querySelector('.menu-btn').innerHTML = icon('menu');
  UI.setupSidebarToggle();
  document.getElementById('search').oninput = (e) => { state.q = e.target.value.trim().toLowerCase(); route(); };

  const NAV = { dashboard: ['Dashboard', 'dashboard'], assignments: ['Assignments', 'book'], grading: ['Needs grading', 'inbox'], students: ['Students', 'grad'], teachers: ['Teachers', 'users'], preview: ['Student view', 'eye'], profile: ['Profile', 'user'] };

  /* Open the student portal as a given student (teacher preview, read-only). */
  async function previewAs(studentId) {
    try { await api('POST', '/api/preview', { student_id: studentId }); location.href = '/student'; }
    catch (e) { toast(e.message, 'bad'); }
  }
  function paintNav(active) {
    const list = state.assignments || [];
    const counts = { assignments: list.length, grading: list.reduce((s, a) => s + a.ungraded_count, 0) };
    for (const [key, [label, ic]] of Object.entries(NAV)) {
      const el = document.querySelector(`[data-nav="${key}"]`);
      el.innerHTML = `${icon(ic)}<span>${label}</span>${counts[key] != null ? `<span class="count">${counts[key]}</span>` : ''}`;
      el.classList.toggle('active', key === active);
    }
  }
  async function loadAssignments() { ({ assignments: state.assignments } = await api('GET', '/api/teacher/assignments')); }

  const stat = (tint, ic, lbl, val, href) => `<a class="card stat" ${href ? `href="${href}"` : ''} style="text-decoration:none;color:inherit"><div class="ico ${tint}">${icon(ic)}</div><div><div class="lbl">${lbl}</div><div class="val">${val}</div></div></a>`;
  function statusBadge(a) {
    if (a.status === 'draft') return '<span class="badge draft">Draft</span>';
    if (!a.accept_submissions) return '<span class="badge closed">Closed</span>';
    if (a.overdue) return '<span class="badge overdue">Past due</span>';
    return '<span class="badge published">Open</span>';
  }
  const groupLabel = (g) => g ? `<span class="badge plain all" style="background:var(--surface-alt);color:var(--text-secondary)">${esc(g)}</span>` : '<span class="badge plain all">All students</span>';

  /* ---- dashboard ---- */
  async function renderDashboard() {
    paintNav('dashboard');
    view.innerHTML = '<div class="loading">Loading…</div>';
    const { stats, recent_submissions, upcoming } = await api('GET', '/api/teacher/overview');
    view.innerHTML = `
      <div class="page-head"><div><h1>${icon('dashboard')} Dashboard</h1><p class="sub">Welcome back, ${esc(user.name)}.</p></div>
        <a class="btn btn-primary" href="#/assignments/new">${icon('plus')} New assignment</a></div>
      <div class="stats">
        ${stat('tint-blue', 'book', 'Assignments', `${stats.published}<span style="font-size:14px;color:var(--text-muted);font-weight:500"> / ${stats.assignments} published</span>`, '#/assignments')}
        ${stat('tint-violet', 'inbox', 'Submissions', stats.submissions, '#/grading')}
        ${stat('tint-amber', 'star', 'Needs grading', stats.ungraded, '#/grading')}
        ${stat('tint-green', 'grad', 'Students', stats.students, '#/students')}
      </div>
      <div class="section-title">${icon('clock')} Upcoming deadlines</div>
      ${upcoming.length ? `<div class="card table-wrap"><table><thead><tr><th>Assignment</th><th>Target</th><th>Due</th><th>Submitted</th><th></th></tr></thead><tbody>
        ${upcoming.map((a) => `<tr><td><a class="strong" href="#/assignments/${a.id}">${esc(a.title)}</a><div class="dim">${esc(a.subject || 'General')}</div></td><td>${groupLabel(a.target_group)}</td><td>${fmtDate(a.due_at)}<div class="dim">${relDue(a.due_at)}</div></td><td><span class="strong">${a.submission_count}</span> <span class="dim">/ ${a.student_count}</span></td><td class="actions"><a class="btn btn-sm" href="#/assignments/${a.id}">${icon('eye')} Review</a></td></tr>`).join('')}
      </tbody></table></div>` : emptyState('calendar', 'No upcoming deadlines', 'Publish an assignment to see it here.')}
      <div class="section-title">${icon('inbox')} Recent submissions</div>
      ${recent_submissions.length ? `<div class="card table-wrap"><table><thead><tr><th>Student</th><th>Assignment</th><th>Submitted</th><th>Status</th></tr></thead><tbody>
        ${recent_submissions.map((s) => `<tr><td><span class="strong">${esc(s.student_name)}</span><div class="dim">${esc(s.roll_no || '')} ${s.group_name ? '· ' + esc(s.group_name) : ''}</div></td><td><a href="#/assignments/${s.assignment_id}">${esc(s.title)}</a></td><td>${fmtDate(s.submitted_at)}${s.is_late ? ' <span class="badge late">Late</span>' : ''}</td><td>${s.grade != null ? `<span class="badge graded">${s.grade}/${s.max_marks}</span>` : '<span class="badge submitted">To grade</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : emptyState('inbox', 'No submissions yet', 'Student submissions will appear here as they come in.')}`;
  }

  /* ---- assignments list ---- */
  function renderAssignments(filter = 'all') {
    paintNav('assignments');
    const all = state.assignments;
    const FILTERS = [['all', 'All', () => true], ['open', 'Open', (a) => a.status === 'published' && a.accept_submissions && !a.overdue], ['due', 'Past due', (a) => a.status === 'published' && a.overdue], ['draft', 'Drafts', (a) => a.status === 'draft'], ['closed', 'Closed', (a) => a.status === 'published' && !a.accept_submissions]];
    const f = FILTERS.find(([k]) => k === filter) || FILTERS[0];
    let items = all.filter(f[2]);
    if (state.q) items = items.filter((a) => (a.title + ' ' + a.subject + ' ' + a.target_group).toLowerCase().includes(state.q));
    view.innerHTML = `
      <div class="page-head"><div><h1>${icon('book')} Assignments</h1><p class="sub">Create, edit, publish and review every assignment.</p></div>
        <a class="btn btn-primary" href="#/assignments/new">${icon('plus')} New assignment</a></div>
      <div class="chips">${FILTERS.map(([k, l, fn]) => `<a class="chip ${k === filter ? 'active' : ''}" href="#/assignments${k === 'all' ? '' : '/filter/' + k}">${l}<span class="n">${all.filter(fn).length}</span></a>`).join('')}</div>
      ${items.length ? `<div class="card table-wrap"><table><thead><tr><th>Assignment</th><th>Target</th><th>Due</th><th>Status</th><th>Submissions</th><th></th></tr></thead><tbody>
        ${items.map((a) => `<tr>
          <td><a class="strong" href="#/assignments/${a.id}">${esc(a.title)}</a><div class="dim">${esc(a.subject || 'General')} · ${a.max_marks} marks${a.files.length ? ` · ${a.files.length} file${a.files.length > 1 ? 's' : ''}` : ''}</div></td>
          <td>${groupLabel(a.target_group)}</td>
          <td>${fmtDate(a.due_at)}<div class="dim">${relDue(a.due_at)}</div></td>
          <td>${statusBadge(a)}</td>
          <td><span class="strong">${a.submission_count}</span> <span class="dim">/ ${a.student_count}</span>${a.ungraded_count ? `<div class="dim" style="color:var(--warning)">${a.ungraded_count} to grade</div>` : ''}</td>
          <td class="actions">
            <a class="icon-btn" href="#/assignments/${a.id}" title="Submissions">${icon('inbox')}</a>
            <a class="icon-btn" href="#/assignments/${a.id}/edit" title="Edit">${icon('edit')}</a>
            <button class="icon-btn" data-toggle="${a.id}" title="${a.status === 'published' ? 'Unpublish (hide from students)' : 'Publish'}">${icon(a.status === 'published' ? 'eye' : 'send')}</button>
            <button class="icon-btn" data-lock="${a.id}" title="${a.accept_submissions ? 'Close submissions' : 'Reopen submissions'}">${icon(a.accept_submissions ? 'lock' : 'unlock')}</button>
            <button class="icon-btn" data-del="${a.id}" title="Delete" style="color:var(--danger)">${icon('trash')}</button>
          </td></tr>`).join('')}
      </tbody></table></div>` : emptyState('book', 'No assignments', state.q ? 'Nothing matches your search.' : 'Create your first assignment with the button above.')}`;
    bindRowActions();
  }
  function bindRowActions() {
    view.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
      const a = state.assignments.find((x) => x.id === +b.dataset.toggle);
      try { await api('PUT', `/api/teacher/assignments/${a.id}`, { status: a.status === 'published' ? 'draft' : 'published' }); toast(a.status === 'published' ? 'Assignment hidden from students' : 'Assignment published', 'ok'); await loadAssignments(); route(); }
      catch (e) { toast(e.message, 'bad'); }
    });
    view.querySelectorAll('[data-lock]').forEach((b) => b.onclick = async () => {
      const a = state.assignments.find((x) => x.id === +b.dataset.lock);
      try { await api('PUT', `/api/teacher/assignments/${a.id}`, { accept_submissions: !a.accept_submissions }); toast(a.accept_submissions ? 'Submissions closed' : 'Submissions reopened', 'ok'); await loadAssignments(); route(); }
      catch (e) { toast(e.message, 'bad'); }
    });
    view.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const a = state.assignments.find((x) => x.id === +b.dataset.del);
      if (!(await confirmDialog('Delete assignment?', `“${a.title}” and all ${a.submission_count} submission(s) will be permanently deleted.`))) return;
      try { await api('DELETE', `/api/teacher/assignments/${a.id}`); toast('Assignment deleted', 'ok'); await loadAssignments(); location.hash = '#/assignments'; route(); }
      catch (e) { toast(e.message, 'bad'); }
    });
  }

  /* ---- assignment form ---- */
  async function renderForm(id) {
    paintNav('assignments');
    view.innerHTML = '<div class="loading">Loading…</div>';
    const [{ groups }, existing] = await Promise.all([api('GET', '/api/teacher/groups'), id ? api('GET', `/api/teacher/assignments/${id}`).then((r) => r.assignment) : null]);
    const a = existing || { title: '', subject: '', description: '', target_group: '', due_at: '', max_marks: 100, status: 'draft', allow_late: 0, accept_submissions: 1, files: [] };
    const removeIds = new Set();
    const defaultDue = (() => { const d = new Date(Date.now() + 7 * 86400000); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T23:59`; })();
    const dueLocal = a.due_at ? a.due_at.slice(0, 16) : defaultDue;
    const knownGroup = !a.target_group || groups.includes(a.target_group);
    view.innerHTML = `
      <div class="crumb"><a href="#/assignments">Assignments</a> › ${id ? 'Edit' : 'New'}</div>
      <div class="page-head"><div><h1>${icon(id ? 'edit' : 'plus')} ${id ? 'Edit assignment' : 'New assignment'}</h1><p class="sub">${id ? 'Changes are visible to students immediately after saving.' : 'Save as a draft to keep working, or publish straight away.'}</p></div></div>
      <form id="a-form" class="detail">
        <div class="card card-pad">
          <div class="field"><label>Title *</label><input name="title" required maxlength="200" value="${esc(a.title)}" placeholder="e.g. Unit 3 – Data Structures lab report"></div>
          <div class="grid-2">
            <div class="field"><label>Subject</label><input name="subject" maxlength="100" value="${esc(a.subject)}" placeholder="e.g. Data Structures"></div>
            <div class="field"><label>Max marks *</label><input name="max_marks" type="number" min="1" step="0.5" required value="${a.max_marks}"></div>
          </div>
          <div class="field"><label>Instructions</label><textarea name="description" rows="10" placeholder="Describe what students need to do, how to format their work, and how it will be evaluated.">${esc(a.description)}</textarea></div>
          <div class="field"><label>Attachments</label>
            ${a.files.length ? `<div class="file-list" id="existing-files" style="margin-bottom:10px">${a.files.map((f) => fileItem(f, 'assignment', `<button type="button" class="icon-btn" data-rm="${f.id}" title="Remove">${icon('x')}</button>`)).join('')}</div>` : ''}
            <div id="picker"></div></div>
        </div>
        <div>
          <div class="card card-pad">
            <div class="field"><label>Who can see it *</label>
              <select name="target_select"><option value="">All students</option>${groups.map((g) => `<option value="${esc(g)}" ${g === a.target_group ? 'selected' : ''}>${esc(g)}</option>`).join('')}<option value="__custom" ${!knownGroup ? 'selected' : ''}>Other class / section…</option></select>
              <input name="target_custom" placeholder="e.g. ECE-2B" value="${knownGroup ? '' : esc(a.target_group)}" ${knownGroup ? 'hidden' : ''} style="margin-top:6px">
              <span class="hint">Students enter their class/section when signing up; it must match exactly.</span></div>
            <div class="field"><label>Deadline *</label><input name="due_at" type="datetime-local" required value="${dueLocal}"></div>
            <label class="check"><input type="checkbox" name="allow_late" ${a.allow_late ? 'checked' : ''}> Accept late submissions (marked as late)</label>
            <label class="check"><input type="checkbox" name="accept_submissions" ${a.accept_submissions ? 'checked' : ''}> Submissions open</label>
            <div class="field"><label>Visibility</label>
              <label class="check"><input type="radio" name="status" value="draft" ${a.status === 'draft' ? 'checked' : ''}> Draft – hidden from students</label>
              <label class="check"><input type="radio" name="status" value="published" ${a.status === 'published' ? 'checked' : ''}> Published – visible to students</label></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn btn-primary btn-lg" type="submit" style="flex:1">${icon('check')} ${id ? 'Save changes' : 'Create assignment'}</button>
            <a class="btn btn-lg" href="${id ? '#/assignments/' + id : '#/assignments'}">Cancel</a>
          </div>
        </div>
      </form>`;
    const form = document.getElementById('a-form');
    const sel = form.target_select, custom = form.target_custom;
    sel.onchange = () => { custom.hidden = sel.value !== '__custom'; if (!custom.hidden) custom.focus(); };
    view.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { removeIds.add(+b.dataset.rm); b.closest('.file-item').remove(); });
    const picker = UI.filePicker(document.getElementById('picker'));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      const fd = new FormData(form);
      const body = {
        title: fd.get('title'), subject: fd.get('subject'), description: fd.get('description'), max_marks: fd.get('max_marks'), due_at: fd.get('due_at'),
        target_group: sel.value === '__custom' ? custom.value.trim() : sel.value, status: fd.get('status'),
        allow_late: form.allow_late.checked, accept_submissions: form.accept_submissions.checked,
        files: await picker.payload(), remove_file_ids: [...removeIds],
      };
      try {
        const { assignment } = id ? await api('PUT', `/api/teacher/assignments/${id}`, body) : await api('POST', '/api/teacher/assignments', body);
        toast(id ? 'Assignment updated' : (assignment.status === 'published' ? 'Assignment published' : 'Draft saved'), 'ok');
        await loadAssignments(); location.hash = `#/assignments/${assignment.id}`;
      } catch (ex) { toast(ex.message, 'bad'); btn.disabled = false; }
    };
  }

  /* ---- submissions / grading ---- */
  async function renderSubmissions(id, filter = 'all') {
    paintNav('assignments');
    view.innerHTML = '<div class="loading">Loading…</div>';
    let data;
    try { data = await api('GET', `/api/teacher/assignments/${id}/submissions`); } catch (e) { view.innerHTML = emptyState('alert', 'Not found', e.message); return; }
    const { assignment: a, students } = data;
    const full = state.assignments.find((x) => x.id === a.id) || { ...a, files: [], overdue: false };
    const count = (s) => students.filter((x) => x.state === s).length;
    const FILTERS = [['all', 'All students'], ['submitted', 'To grade'], ['graded', 'Graded'], ['missing', 'Not submitted']];
    let items = filter === 'all' ? students : students.filter((s) => s.state === filter);
    if (state.q) items = items.filter((s) => (s.name + ' ' + s.roll_no + ' ' + s.email + ' ' + s.group_name).toLowerCase().includes(state.q));
    view.innerHTML = `
      <div class="crumb"><a href="#/assignments">Assignments</a> › ${esc(a.subject || 'General')}</div>
      <div class="page-head">
        <div><h1>${esc(a.title)}</h1>
          <div class="meta-row" style="margin-top:8px">
            <span>${statusBadge(full)}</span><span>${icon('users')}${a.target_group ? esc(a.target_group) : 'All students'}</span>
            <span>${icon('calendar')}Due ${fmtDate(a.due_at)} · ${relDue(a.due_at)}</span><span>${icon('star')}${a.max_marks} marks</span>
            ${full.files.length ? `<span>${icon('file')}${full.files.length} attachment${full.files.length > 1 ? 's' : ''}</span>` : ''}
          </div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn" href="/api/teacher/assignments/${a.id}/export.csv">${icon('sheet')} Export CSV</a>
          <a class="btn" href="#/assignments/${a.id}/edit">${icon('edit')} Edit</a>
          <button class="btn ${a.status === 'published' ? '' : 'btn-primary'}" id="pub-btn">${icon(a.status === 'published' ? 'eye' : 'send')} ${a.status === 'published' ? 'Unpublish' : 'Publish'}</button>
        </div></div>
      <div class="stats" style="margin-bottom:18px">
        ${stat('tint-blue', 'users', 'Students', students.length)}${stat('tint-violet', 'inbox', 'Submitted', count('submitted') + count('graded'))}
        ${stat('tint-green', 'star', 'Graded', count('graded'))}${stat('tint-red', 'alert', 'Missing', count('missing'))}
      </div>
      ${a.description ? `<details class="card card-pad" style="margin-bottom:18px"><summary style="cursor:pointer;font-weight:600">Instructions shown to students</summary><div class="prose" style="margin-top:10px">${esc(a.description)}</div>${full.files.length ? `<div class="file-list" style="margin-top:12px">${full.files.map((f) => fileItem(f, 'assignment')).join('')}</div>` : ''}</details>` : ''}
      <div class="chips">${FILTERS.map(([k, l]) => `<a class="chip ${k === filter ? 'active' : ''}" href="#/assignments/${a.id}${k === 'all' ? '' : '/' + k}">${l}<span class="n">${k === 'all' ? students.length : count(k)}</span></a>`).join('')}</div>
      ${items.length ? `<div class="card table-wrap"><table><thead><tr><th>Roll no</th><th>Student</th><th>Status</th><th>Submitted</th><th>Files</th><th>Grade</th><th></th></tr></thead><tbody>
        ${items.map((s) => `<tr>
          <td class="strong">${esc(s.roll_no || '—')}</td>
          <td><span class="strong">${esc(s.name)}</span><div class="dim">${esc(s.group_name)} · ${esc(s.email)}</div></td>
          <td><span class="badge ${s.state}">${{ submitted: 'To grade', graded: 'Graded', missing: 'Not submitted' }[s.state]}</span>${s.is_late ? ' <span class="badge late">Late</span>' : ''}</td>
          <td>${s.submitted_at ? fmtDate(s.submitted_at) : '<span class="dim">—</span>'}</td>
          <td>${s.files.length ? s.files.map((f) => `<a href="/api/files/submission/${f.id}" download="${esc(f.filename)}" title="${esc(f.filename)} (${fmtSize(f.size)})" class="dim" style="display:block;color:var(--primary)">${icon('download').replace('<svg', '<svg style="width:13px;height:13px;vertical-align:-2px;margin-right:3px"')}${esc(f.filename)}</a>`).join('') : '<span class="dim">—</span>'}</td>
          <td>${s.grade != null ? `<span class="strong">${s.grade}</span> <span class="dim">/ ${a.max_marks}</span>` : '<span class="dim">—</span>'}</td>
          <td class="actions">${s.submission_id ? `<button class="btn btn-sm ${s.state === 'submitted' ? 'btn-primary' : ''}" data-review="${s.submission_id}">${icon('edit')} ${s.state === 'graded' ? 'Edit grade' : 'Grade'}</button>` : ''}</td>
        </tr>`).join('')}
      </tbody></table></div>` : emptyState('users', 'Nobody here', filter === 'all' ? 'No student accounts match this assignment’s class yet.' : 'No students in this category.')}`;

    document.getElementById('pub-btn').onclick = async () => {
      try { await api('PUT', `/api/teacher/assignments/${a.id}`, { status: a.status === 'published' ? 'draft' : 'published' }); toast(a.status === 'published' ? 'Hidden from students' : 'Published to students', 'ok'); await loadAssignments(); renderSubmissions(id, filter); }
      catch (e) { toast(e.message, 'bad'); }
    };
    view.querySelectorAll('[data-review]').forEach((b) => b.onclick = () => {
      const s = students.find((x) => x.submission_id === +b.dataset.review);
      openGradeModal(a, s, () => renderSubmissions(id, filter));
    });
  }

  function openGradeModal(a, s, onDone) {
    const m = modal({
      title: `${s.name} · ${s.roll_no || s.email}`, wide: true,
      body: `
        <div class="meta-row" style="margin-bottom:12px"><span>${icon('calendar')}Submitted ${fmtDate(s.submitted_at)}</span>${s.is_late ? '<span class="badge late">Late</span>' : ''}${s.graded_at ? `<span>${icon('star')}Graded ${fmtDate(s.graded_at)}</span>` : ''}</div>
        <h3 style="font-size:14px;margin-bottom:6px">Written answer</h3>
        <div class="prose card card-pad" style="font-size:13.5px;max-height:260px;overflow:auto;margin-bottom:14px">${s.text_answer ? esc(s.text_answer) : '<span style="color:var(--text-muted)">No written answer.</span>'}</div>
        <h3 style="font-size:14px;margin-bottom:6px">Files</h3>
        ${s.files.length ? `<div class="file-list" style="margin-bottom:14px">${s.files.map((f) => fileItem(f, 'submission')).join('')}</div>` : '<div class="hint" style="margin-bottom:14px">No files attached.</div>'}
        <form id="grade-form">
          <div class="grid-2">
            <div class="field"><label>Marks (out of ${a.max_marks})</label><input name="grade" type="number" min="0" max="${a.max_marks}" step="0.5" value="${s.grade ?? ''}" placeholder="Leave empty to un-grade"></div>
          </div>
          <div class="field"><label>Feedback for the student</label><textarea name="feedback" rows="4" placeholder="What was good, what to improve…">${esc(s.feedback || '')}</textarea></div>
        </form>`,
      footer: `<button class="btn btn-danger" id="del-sub" style="margin-right:auto">${icon('trash')} Delete submission</button><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save-grade">${icon('check')} Save grade</button>`,
    });
    m.querySelector('#save-grade').onclick = async () => {
      const fd = new FormData(m.querySelector('#grade-form'));
      try { await api('PUT', `/api/teacher/submissions/${s.submission_id}/grade`, { grade: fd.get('grade'), feedback: fd.get('feedback') }); toast('Grade saved', 'ok'); closeModal(); await loadAssignments(); onDone(); }
      catch (e) { toast(e.message, 'bad'); }
    };
    m.querySelector('#del-sub').onclick = async () => {
      if (!(await confirmDialog('Delete submission?', `${s.name}'s submission will be removed so they can submit again.`))) return;
      try { await api('DELETE', `/api/teacher/submissions/${s.submission_id}`); toast('Submission deleted', 'ok'); await loadAssignments(); onDone(); }
      catch (e) { toast(e.message, 'bad'); }
    };
  }

  function renderGrading() {
    paintNav('grading');
    const items = state.assignments.filter((a) => a.ungraded_count > 0);
    view.innerHTML = `
      <div class="page-head"><div><h1>${icon('inbox')} Needs grading</h1><p class="sub">Assignments with submissions waiting for marks.</p></div></div>
      ${items.length ? `<div class="cards">${items.map((a) => `<a class="card a-card" href="#/assignments/${a.id}/submitted">
        <div class="top"><span class="subject">${esc(a.subject || 'General')}</span><span class="badge submitted">${a.ungraded_count} to grade</span></div>
        <h3>${esc(a.title)}</h3><p class="desc">${a.submission_count} of ${a.student_count} submitted · ${groupLabel(a.target_group)}</p>
        <div class="foot"><span>${icon('calendar')}${fmtDate(a.due_at)}</span><span>${relDue(a.due_at)}</span></div></a>`).join('')}</div>`
      : emptyState('checkCircle', 'All caught up', 'Every submission has been graded.')}`;
  }

  /* ---- people ---- */
  async function renderUsers(role) {
    paintNav(role === 'student' ? 'students' : 'teachers');
    view.innerHTML = '<div class="loading">Loading…</div>';
    const { users, groups } = await api('GET', `/api/teacher/users?role=${role}`);
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const group = params.get('group') || '';
    let items = users.filter((u) => !group || u.group_name === group);
    if (state.q) items = items.filter((u) => (u.name + ' ' + u.email + ' ' + (u.roll_no || '') + ' ' + u.group_name).toLowerCase().includes(state.q));
    const isStudent = role === 'student';
    view.innerHTML = `
      <div class="page-head"><div><h1>${icon(isStudent ? 'grad' : 'users')} ${isStudent ? 'Students' : 'Teachers'}</h1><p class="sub">${isStudent ? `${users.length} student account${users.length === 1 ? '' : 's'} across ${groups.length} class${groups.length === 1 ? '' : 'es'}.` : `${users.length} teacher account${users.length === 1 ? '' : 's'} with full access.`}</p></div>
        <button class="btn btn-primary" id="add-user">${icon('plus')} Add ${role}</button></div>
      ${isStudent && groups.length ? `<div class="chips"><a class="chip ${!group ? 'active' : ''}" href="#/students">All<span class="n">${users.length}</span></a>${groups.map((g) => `<a class="chip ${g === group ? 'active' : ''}" href="#/students?group=${encodeURIComponent(g)}">${esc(g)}<span class="n">${users.filter((u) => u.group_name === g).length}</span></a>`).join('')}</div>` : ''}
      ${items.length ? `<div class="card table-wrap"><table><thead><tr>${isStudent ? '<th>Roll no</th>' : ''}<th>Name</th>${isStudent ? '<th>Class</th>' : ''}<th>Email</th>${isStudent ? '<th>Submissions</th>' : '<th>Added</th>'}<th></th></tr></thead><tbody>
        ${items.map((u) => `<tr>${isStudent ? `<td class="strong">${esc(u.roll_no || '—')}</td>` : ''}<td><span class="strong">${esc(u.name)}</span>${u.id === user.id ? ' <span class="badge plain all">You</span>' : ''}</td>${isStudent ? `<td>${groupLabel(u.group_name)}</td>` : ''}<td class="dim">${esc(u.email)}</td><td>${isStudent ? u.submission_count : fmtDate(u.created_at, false)}</td>
          <td class="actions">${isStudent ? `<button class="icon-btn" data-view="${u.id}" title="View student portal as ${esc(u.name)}">${icon('eye')}</button>` : ''}<button class="icon-btn" data-edit="${u.id}" title="Edit / reset password">${icon('edit')}</button>${u.id !== user.id ? `<button class="icon-btn" data-del="${u.id}" title="Delete" style="color:var(--danger)">${icon('trash')}</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : emptyState('users', `No ${role}s found`, isStudent ? 'Students can sign up from the student login page, or add them here.' : 'Add a colleague with the button above.')}`;
    document.getElementById('add-user').onclick = () => openUserModal(role, null, groups, () => renderUsers(role));
    view.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => previewAs(+b.dataset.view));
    view.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openUserModal(role, users.find((u) => u.id === +b.dataset.edit), groups, () => renderUsers(role)));
    view.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const u = users.find((x) => x.id === +b.dataset.del);
      if (!(await confirmDialog(`Delete ${role}?`, `${u.name} (${u.email}) will be removed${isStudent ? ' along with all their submissions' : ''}.`))) return;
      try { await api('DELETE', `/api/teacher/users/${u.id}`); toast('Account deleted', 'ok'); renderUsers(role); } catch (e) { toast(e.message, 'bad'); }
    });
  }

  function openUserModal(role, u, groups, onDone) {
    const isStudent = role === 'student';
    const m = modal({
      title: u ? `Edit ${role}` : `Add ${role}`,
      body: `<form id="u-form">
        <div class="field"><label>Full name *</label><input name="name" required value="${esc(u?.name || '')}"></div>
        <div class="field"><label>Email *</label><input name="email" type="email" required value="${esc(u?.email || '')}"></div>
        ${isStudent ? `<div class="grid-2">
          <div class="field"><label>Roll number *</label><input name="roll_no" required value="${esc(u?.roll_no || '')}" placeholder="CS2301"></div>
          <div class="field"><label>Class / section *</label><input name="group_name" required list="groups" value="${esc(u?.group_name || '')}" placeholder="CSE-3A"><datalist id="groups">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist></div></div>` : ''}
        <div class="field"><label>${u ? 'New password (leave blank to keep)' : 'Password *'}</label><input name="password" type="password" minlength="6" ${u ? '' : 'required'} autocomplete="new-password"><span class="hint">${u ? 'Setting a new password signs the user out everywhere.' : 'Share it with the user; they can change it from their profile.'}</span></div>
      </form>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="save-user">${icon('check')} ${u ? 'Save' : 'Create account'}</button>`,
    });
    m.querySelector('#save-user').onclick = async () => {
      const form = m.querySelector('#u-form');
      if (!form.reportValidity()) return;
      const fd = Object.fromEntries(new FormData(form).entries());
      try {
        if (u) { const body = { ...fd }; if (fd.password) body.new_password = fd.password; delete body.password; await api('PUT', `/api/teacher/users/${u.id}`, body); }
        else await api('POST', '/api/teacher/users', { role, ...fd });
        toast(u ? 'Account updated' : 'Account created', 'ok'); closeModal(); onDone();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  async function renderStudentView() {
    paintNav('preview');
    view.innerHTML = '<div class="loading">Loading…</div>';
    const { users, groups } = await api('GET', '/api/teacher/users?role=student');
    const me = await api('GET', '/api/me');
    const current = me.view_as;
    view.innerHTML = `
      <div class="page-head"><div><h1>${icon('eye')} Student view</h1><p class="sub">Open the student portal exactly as one of your students sees it, using your teacher login. Submitting is disabled in preview.</p></div></div>
      ${current ? `<div class="callout info" style="margin-bottom:14px">${icon('eye')}<div>You are currently previewing as <strong>${esc(current.name)}</strong>${current.roll_no ? ` (${esc(current.roll_no)})` : ''}. <a href="/student">Open the student portal</a> or <button class="link-btn" id="stop-preview">stop previewing</button>.</div></div>` : ''}
      <div class="detail">
        <form class="card card-pad" id="pv-form">
          <h3 style="font-size:15px;margin-bottom:12px">Choose a student</h3>
          ${users.length ? `
          <div class="field"><label for="pv-group">Class / section</label><select id="pv-group"><option value="">All classes</option>${groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</select></div>
          <div class="field"><label for="pv-student">Student</label><select id="pv-student" required></select></div>
          <button class="btn btn-primary" type="submit">${icon('eye')} Open student portal as this student</button>` : emptyState('grad', 'No students yet', 'Add students from the Students page first.')}
        </form>
        <div class="card card-pad">
          <h3 style="font-size:15px;margin-bottom:10px">What you can do in preview</h3>
          <ul style="font-size:13.5px;padding-left:18px;line-height:1.6;color:var(--text-secondary);display:grid;gap:6px">
            <li>See the dashboard, assignments, attachments and grades for that student's class.</li>
            <li>Check how instructions and deadlines read before students see them.</li>
            <li>Submitting work and changing the password are blocked, so nothing is recorded under the student's name.</li>
            <li>Your teacher session stays signed in; use <em>Exit preview</em> in the student portal to come back here.</li>
          </ul>
        </div>
      </div>`;
    const stop = document.getElementById('stop-preview');
    if (stop) stop.onclick = async () => { await api('DELETE', '/api/preview'); toast('Preview ended', 'ok'); renderStudentView(); };
    const gSel = document.getElementById('pv-group'), sSel = document.getElementById('pv-student');
    if (!sSel) return;
    const fill = () => {
      const list = users.filter((u) => !gSel.value || u.group_name === gSel.value);
      sSel.innerHTML = list.map((u) => `<option value="${u.id}">${esc(u.name)}${u.roll_no ? ` — ${esc(u.roll_no)}` : ''}${!gSel.value && u.group_name ? ` (${esc(u.group_name)})` : ''}</option>`).join('');
    };
    gSel.onchange = fill; fill();
    document.getElementById('pv-form').onsubmit = (e) => { e.preventDefault(); if (sSel.value) previewAs(+sSel.value); };
  }

  function renderProfile() {
    paintNav('profile');
    view.innerHTML = `
      <div class="page-head"><div><h1>${icon('user')} Profile</h1><p class="sub">Signed in as a teacher with full access.</p></div></div>
      <div class="detail">
        <dl class="kv card card-pad"><dt>Name</dt><dd>${esc(user.name)}</dd><dt>Email</dt><dd>${esc(user.email)}</dd><dt>Role</dt><dd>Teacher</dd><dt>Member since</dt><dd>${fmtDate(user.created_at, false)}</dd></dl>
        <form class="card card-pad" id="pw-form"><h3 style="font-size:15px;margin-bottom:12px">Change password</h3>
          <div class="field"><label>Current password</label><input type="password" name="current_password" required autocomplete="current-password"></div>
          <div class="field"><label>New password</label><input type="password" name="new_password" minlength="6" required autocomplete="new-password"></div>
          <button class="btn btn-primary" type="submit">Update password</button></form>
      </div>`;
    document.getElementById('pw-form').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/me/password', Object.fromEntries(new FormData(e.target).entries())); toast('Password updated', 'ok'); e.target.reset(); } catch (ex) { toast(ex.message, 'bad'); }
    };
  }

  /* ---- router ---- */
  async function route() {
    try {
      if (!state.assignments) await loadAssignments();
      const h = (location.hash || '#/dashboard').split('?')[0];
      let m;
      if (h === '#/dashboard') await renderDashboard();
      else if (h === '#/assignments') renderAssignments('all');
      else if ((m = h.match(/^#\/assignments\/filter\/(\w+)$/))) renderAssignments(m[1]);
      else if (h === '#/assignments/new') await renderForm(null);
      else if ((m = h.match(/^#\/assignments\/(\d+)\/edit$/))) await renderForm(+m[1]);
      else if ((m = h.match(/^#\/assignments\/(\d+)(?:\/(submitted|graded|missing))?$/))) await renderSubmissions(+m[1], m[2] || 'all');
      else if (h === '#/grading') renderGrading();
      else if (h === '#/students') await renderUsers('student');
      else if (h === '#/student-view') await renderStudentView();
      else if (h === '#/teachers') await renderUsers('teacher');
      else if (h === '#/profile') renderProfile();
      else location.hash = '#/dashboard';
    } catch (e) { view.innerHTML = emptyState('alert', 'Something went wrong', e.message); }
    document.querySelector('.sidebar').classList.remove('open');
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', async () => { await loadAssignments().catch(() => {}); route(); });
  route();
})();
