/* Login / sign-up logic shared by the two login pages. The role is fixed per page. */
window.Auth = {
  init(role) {
    const $ = (s) => document.querySelector(s);
    // Already logged in with this role? Go straight to the app.
    UI.api('GET', '/api/me').then(({ user, view_as }) => {
      if (user.role === role) location.href = `/${role}`;
      else if (role === 'student' && user.role === 'teacher' && view_as) location.href = '/student';
    }).catch(() => {});

    if (role === 'student') {
      UI.api('GET', '/api/config').then((c) => {
        $('#signup-link').hidden = !c.allow_student_signup;
        $('#no-signup').hidden = c.allow_student_signup;
        // The teacher login is only mentioned on the combined portal, never on the student-only one.
        const t = $('#teacher-link'); if (t) t.hidden = c.portal !== 'both';
        const d = c.allowed_email_domains || [];
        if (d.length) {
          $('#domain-hint').textContent = `Use your ${d.map((x) => '@' + x).join(' or ')} address.`;
          $('#s-email').placeholder = `yourname@${d[0]}`;
        }
      }).catch(() => {});
      $('#show-signup').onclick = () => { $('#login-view').hidden = true; $('#signup-view').hidden = false; $('#s-email').focus(); };
      $('#show-login').onclick = () => { $('#signup-view').hidden = true; $('#login-view').hidden = false; $('#l-id').focus(); };
      $('#signup-form').onsubmit = async (e) => {
        e.preventDefault();
        const err = $('#signup-error'); err.hidden = true;
        const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
        try {
          const body = Object.fromEntries(new FormData(e.target).entries());
          const res = await UI.api('POST', '/api/auth/register', body);
          // Request recorded; the student can sign in once a teacher approves it.
          $('#signup-view').hidden = true; $('#login-view').hidden = false;
          const done = $('#signup-done');
          done.innerHTML = `${UI.icon('checkCircle')}<div>${UI.esc(res.message || 'Request sent. A teacher will approve your account; after that you can sign in here.')}</div>`;
          done.hidden = false;
          e.target.reset(); btn.disabled = false;
          $('#l-id').value = body.email;
        } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
      };
    }

    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#login-error'); err.hidden = true;
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const body = Object.fromEntries(new FormData(e.target).entries());
        await UI.api('POST', '/api/auth/login', { role, ...body });
        location.href = `/${role}`;
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    };
  },
};
