/* Login / sign-up logic shared by the two login pages. The role is fixed per page. */
window.Auth = {
  init(role) {
    const $ = (s) => document.querySelector(s);
    // Already logged in with this role? Go straight to the app.
    UI.api('GET', '/api/me').then(({ user, view_as }) => {
      if (user.role === role) location.href = `/${role}`;
      else if (role === 'student' && user.role === 'teacher' && view_as) location.href = '/student';
    }).catch(() => {});

    if ($('#signup-form')) {
      UI.api('GET', '/api/config').then((c) => {
        const allowed = role === 'student' ? c.allow_student_signup : c.allow_teacher_signup;
        $('#signup-link').hidden = !allowed;
        $('#no-signup').hidden = allowed;
        // The teacher login is only mentioned on the combined portal, never on the student-only one.
        const t = $('#teacher-link'); if (t) t.hidden = c.portal !== 'both';
        // Teachers sign up with the access code; the field disappears when no code is set.
        const code = $('#code-field'); if (code) { code.hidden = !c.teacher_code_required; $('#s-code').required = !!c.teacher_code_required; }
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
          if (body.password !== body.password_confirm) throw new Error('The two passwords do not match. Please type them again.');
          delete body.password_confirm;
          const res = await UI.api('POST', '/api/auth/register', { role, ...body });
          // Students: request recorded, they sign in once a teacher approves it. Teachers: account ready now.
          $('#signup-view').hidden = true; $('#login-view').hidden = false;
          const done = $('#signup-done');
          done.innerHTML = `${UI.icon('checkCircle')}<div>${UI.esc(res.message || 'Request sent. A teacher will approve your account; after that you can sign in here.')}</div>`;
          // Say which account was requested, so a teacher knows the student portal is separate.
          done.hidden = false;
          e.target.reset(); btn.disabled = false;
          $('#l-id').value = body.roll_no || body.email;
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
