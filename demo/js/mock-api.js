/* DocVault demo mode.
 *
 * This file turns the normal DocVault front end into a server-less demo that can be
 * hosted on any static host (Netlify, GitHub Pages, a USB stick). It replaces
 * window.fetch for every /api/... call with an in-browser fake backend that mirrors
 * server.py route by route and keeps its data in localStorage. Files are stored as
 * base64 inside that data, so keep uploads small.
 *
 * Nothing here is used by the real app: server.py and public/ are untouched.
 */
(function () {
  'use strict';

  const KEY = 'docvault_demo_v1';
  const DEFAULT_TEACHER_CODE = 'DV-TEACHER-2026';
  const COLLEGE_NAME = 'DocVault demo';
  const MAX_FILE_BYTES = 1.5 * 1024 * 1024;   // localStorage is small (~5 MB); the real server allows 25 MB
  const ROLES = ['student', 'teacher'];
  const realFetch = window.fetch.bind(window);

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  /* ---------- small helpers (same behaviour as server.py) ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  function iso(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  const nowIso = () => iso(new Date());
  const isPast = (s) => { const d = new Date(s); return !isNaN(d) && d < new Date(); };
  function fromNow(days, hours = 0) { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(d.getHours() + hours); d.setSeconds(0, 0); return iso(d); }
  function dueIn(days) { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(23, 59, 0, 0); return iso(d).slice(0, 16); }
  const cmp = (a, b) => { a = a == null ? '' : a; b = b == null ? '' : b; return a < b ? -1 : a > b ? 1 : 0; };
  const sortBy = (arr, ...keys) => arr.slice().sort((x, y) => { for (const k of keys) { const r = typeof k === 'function' ? k(x, y) : cmp(x[k], y[k]); if (r) return r; } return 0; });
  const num = (v) => (v == null ? '' : String(Number(v)));
  const normalizeCode = (c) => String(c || '').replace(/[\s-]/g, '').toUpperCase();
  const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e || '');
  function require(body, ...fields) {
    const missing = fields.filter((f) => !String(body[f] == null ? '' : body[f]).trim());
    if (missing.length) throw new ApiError(400, 'Missing required field(s): ' + missing.join(', '));
  }
  function validatePassword(pw) { if (String(pw || '').length < 6) throw new ApiError(400, 'Password must be at least 6 characters.'); }
  function safeFilename(name) {
    name = String(name || 'file').split(/[\\/]/).pop().trim() || 'file';
    return name.replace(/[^\w.\- ()\[\]]/g, '_').slice(0, 180);
  }
  const MIMES = { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', zip: 'application/zip', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', py: 'text/x-python', js: 'text/javascript', json: 'application/json', html: 'text/html', css: 'text/css' };
  const guessMime = (name) => MIMES[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

  // Demo-grade password hashing (FNV-1a with a salt). Good enough for sample accounts in a browser;
  // the real server uses PBKDF2-SHA256.
  function fnv(str, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  function hashPassword(pw, salt) {
    salt = salt || Math.random().toString(36).slice(2, 12);
    const s = salt + ':' + pw;
    return `demo$${salt}$${fnv(s, 0x811c9dc5)}${fnv(s, 0x9747b28c)}${fnv(s, 0x1b873593)}`;
  }
  function verifyPassword(pw, stored) {
    const parts = String(stored || '').split('$');
    return parts.length === 3 && hashPassword(pw, parts[1]) === stored;
  }
  function b64text(text) { return btoa(unescape(encodeURIComponent(text))); }
  function b64bytes(b64) {
    try { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
    catch (_) { return null; }
  }

  /* ---------- storage ---------- */
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (_) { /* corrupt or blocked: reseed */ }
    return null;
  }
  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { throw new ApiError(413, 'The browser storage for this demo is full. Remove some attachments or submissions, or reset the demo data.'); }
  }
  function getDb() {
    let db = load();
    if (!db || db.version !== 1) { db = seed(); save(db); }
    return db;
  }
  function resetDb() { const db = seed(); save(db); return db; }

  /* ---------- sample data ---------- */
  function seed() {
    const db = {
      version: 1, seq: { users: 0, assignments: 0, afiles: 0, submissions: 0, sfiles: 0 },
      users: [], assignments: [], assignment_files: [], submissions: [], submission_files: [],
      settings: { student_signup: '1', teacher_signup: '1', allowed_email_domains: 'gmail.com', teacher_code: DEFAULT_TEACHER_CODE },
      session: null,
    };
    const user = (o) => {
      const u = { id: ++db.seq.users, role: 'student', name: '', email: '', roll_no: null, group_name: '', status: 'active', created_at: fromNow(-30), ...o };
      u.password_hash = hashPassword(o.password || 'student123'); delete u.password;
      db.users.push(u); return u;
    };
    const assignment = (o) => {
      const a = { id: ++db.seq.assignments, subject: '', description: '', target_group: '', max_marks: null, status: 'published', allow_late: 0, accept_submissions: 1, created_by: 1, created_at: fromNow(-10), updated_at: fromNow(-10), ...o };
      db.assignments.push(a); return a;
    };
    const afile = (assignment_id, filename, text) => db.assignment_files.push({ id: ++db.seq.afiles, assignment_id, filename, data: b64text(text), size: new TextEncoder().encode(text).length, mime: guessMime(filename), uploaded_at: fromNow(-10) });
    const submission = (o, files = []) => {
      const s = { id: ++db.seq.submissions, text_answer: '', is_late: 0, grade: null, feedback: '', graded_at: null, graded_by: null, ...o };
      db.submissions.push(s);
      for (const [filename, text] of files) db.submission_files.push({ id: ++db.seq.sfiles, submission_id: s.id, filename, data: b64text(text), size: new TextEncoder().encode(text).length, mime: guessMime(filename) });
      return s;
    };

    // Teachers (password: teacher123)
    const priya = user({ role: 'teacher', name: 'Priya Nair', email: 'priya.nair@gmail.com', password: 'teacher123', created_at: fromNow(-40) });
    const arun = user({ role: 'teacher', name: 'Arun Mehta', email: 'arun.mehta@gmail.com', password: 'teacher123', created_at: fromNow(-35) });
    // Students (password: student123)
    const ananya = user({ name: 'Ananya Rao', email: 'ananya.rao@gmail.com', roll_no: 'CS2301', group_name: 'CSE-3A', created_at: fromNow(-28) });
    const rahul = user({ name: 'Rahul Verma', email: 'rahul.verma@gmail.com', roll_no: 'CS2302', group_name: 'CSE-3A', created_at: fromNow(-28) });
    const sneha = user({ name: 'Sneha Iyer', email: 'sneha.iyer@gmail.com', roll_no: 'CS2303', group_name: 'CSE-3A', created_at: fromNow(-27) });
    user({ name: 'Karan Patel', email: 'karan.patel@gmail.com', roll_no: 'CS2304', group_name: 'CSE-3A', created_at: fromNow(-27) });
    const meera = user({ name: 'Meera Joshi', email: 'meera.joshi@gmail.com', roll_no: 'EC2201', group_name: 'ECE-2B', created_at: fromNow(-25) });
    // One student request waiting for a teacher
    user({ name: 'Vikram Singh', email: 'vikram.singh@gmail.com', roll_no: 'CS2305', group_name: '', status: 'pending', created_at: fromNow(0, -2) });

    const lab = assignment({
      title: 'Unit 3 – Data Structures lab report', subject: 'Data Structures', target_group: 'CSE-3A', due_at: dueIn(5), max_marks: 20, created_by: priya.id,
      description: 'Implement a singly linked list with insert, delete and reverse operations in C or Python.\n\nSubmit a short report (2–3 pages) covering:\n1. Your design and the data structure diagram\n2. Source code with comments\n3. Test cases and their output\n4. Time complexity of each operation\n\nAttach the code file along with the report. See lab3-instructions.txt for the marking scheme.',
    });
    afile(lab.id, 'lab3-instructions.txt', 'Unit 3 lab – Linked lists\n\nMarking scheme (20 marks)\n- Correct insert / delete / reverse: 8\n- Report and diagrams: 6\n- Test cases: 4\n- Complexity analysis: 2\n\nDeadline is strict. Late submissions are not accepted for this lab.\n');
    submission({ assignment_id: lab.id, student_id: ananya.id, submitted_at: fromNow(-3, 2), text_answer: 'Report attached. I implemented the list in Python with a tail pointer so append is O(1). Reverse is iterative using three pointers.', grade: 17, feedback: 'Clear analysis of the linked list operations. Add the complexity of deletion by value next time.', graded_at: fromNow(-2), graded_by: priya.id },
      [['ananya-lab3-report.txt', 'Ananya Rao – CS2301\nUnit 3 lab report: singly linked list\n\n1. Design: Node(value, next); List keeps head and tail.\n2. Operations: insert_front O(1), append O(1), delete(value) O(n), reverse O(n).\n3. Tests: 12 cases, all passing.\n']]);
    submission({ assignment_id: lab.id, student_id: rahul.id, submitted_at: fromNow(-1, -3), text_answer: 'Code and report attached. Reverse uses recursion.' },
      [['rahul_lab3.py', 'class Node:\n    def __init__(self, value, nxt=None):\n        self.value, self.next = value, nxt\n\nclass LinkedList:\n    def __init__(self):\n        self.head = None\n\n    def insert(self, value):\n        self.head = Node(value, self.head)\n\n    def reverse(self, node=None, prev=None):\n        node = node or self.head\n        if node is None:\n            return prev\n        nxt, node.next = node.next, prev\n        if nxt is None:\n            self.head = node\n            return node\n        return self.reverse(nxt, node)\n']]);

    const essay = assignment({
      title: 'Essay: Ethics in Artificial Intelligence', subject: 'Professional Ethics', target_group: '', due_at: dueIn(12), max_marks: null, allow_late: 1, created_by: arun.id, created_at: fromNow(-6), updated_at: fromNow(-6),
      description: 'Write a 1000-word essay on one ethical problem raised by AI systems in everyday life: hiring tools, facial recognition, recommendation feeds or self-driving cars.\n\nThis is a feedback-only assignment: there are no marks, you will get written comments instead.\n\nType the essay in the answer box or attach a document.',
    });
    submission({ assignment_id: essay.id, student_id: meera.id, submitted_at: fromNow(-3), text_answer: 'Bias in AI hiring tools\n\nAutomated screening tools learn from past hiring decisions, so they also learn past prejudice. When a model is trained on résumés of people who were hired before, it quietly rewards whatever those people had in common, including gender and college names, rather than what makes someone good at the job...', feedback: 'Well argued, especially the section on bias in hiring tools. Cite at least two sources next time.', graded_at: fromNow(-1), graded_by: arun.id });
    submission({ assignment_id: essay.id, student_id: ananya.id, submitted_at: fromNow(-2, 5), text_answer: 'Facial recognition in public places\n\nCities are installing cameras that identify people as they walk by. Even when the goal is safety, the system changes how people behave in public: protests become risky, and errors fall hardest on people the model has seen the least...' });

    const quiz = assignment({
      title: 'DBMS Quiz 1 – SQL joins', subject: 'Database Systems', target_group: 'CSE-3A', due_at: dueIn(-3), max_marks: 10, allow_late: 1, created_by: priya.id, created_at: fromNow(-14), updated_at: fromNow(-14),
      description: 'Answer the five questions on inner, left and full outer joins from the quiz sheet. Write the SQL for each and one line explaining the result set.',
    });
    submission({ assignment_id: quiz.id, student_id: ananya.id, submitted_at: fromNow(-4), text_answer: 'Q1: SELECT s.name, m.marks FROM students s INNER JOIN marks m ON m.student_id = s.id; ... (all five answered)', grade: 9, feedback: 'Q4 missed the NULL rows of the left join.', graded_at: fromNow(-3), graded_by: priya.id });
    submission({ assignment_id: quiz.id, student_id: rahul.id, submitted_at: fromNow(-4, 1), text_answer: 'Answers to Q1–Q5 below.\nQ1: inner join on student_id ...', grade: 7, feedback: 'Good, but a FULL OUTER JOIN is not the same as a UNION of two inner joins.', graded_at: fromNow(-3), graded_by: priya.id });
    submission({ assignment_id: quiz.id, student_id: sneha.id, submitted_at: fromNow(-2), is_late: 1, text_answer: 'Sorry for the late submission. Q1–Q5 answered in the attached file.' },
      [['sneha-quiz1.txt', 'Q1 SELECT ... INNER JOIN ...\nQ2 SELECT ... LEFT JOIN ...\nQ3 SELECT ... FULL OUTER JOIN ...\nQ4 ...\nQ5 ...\n']]);

    assignment({
      title: 'Mini project proposal', subject: 'Software Engineering', target_group: '', due_at: dueIn(20), max_marks: 50, status: 'draft', created_by: arun.id, created_at: fromNow(-1), updated_at: fromNow(-1),
      description: 'Draft: propose a mini project for the semester. One page: problem, users, features, tech stack and a four-week plan.',
    });
    return db;
  }

  /* ---------- shared query helpers ---------- */
  const publicUser = (u) => ({ id: u.id, role: u.role, name: u.name, email: u.email, roll_no: u.roll_no, group_name: u.group_name, created_at: u.created_at, status: u.status || 'active' });
  const allowedDomains = (db) => db.settings.allowed_email_domains.split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const settingsPayload = (db) => ({ student_signup: db.settings.student_signup === '1', teacher_signup: db.settings.teacher_signup === '1', allowed_email_domains: allowedDomains(db), teacher_code: db.settings.teacher_code });
  const filesOf = (db, aid) => db.assignment_files.filter((f) => f.assignment_id === aid).map(({ id, assignment_id, filename, size, mime, uploaded_at }) => ({ id, assignment_id, filename, size, mime, uploaded_at }));
  const subFilesOf = (db, sid) => db.submission_files.filter((f) => f.submission_id === sid).map(({ id, submission_id, filename, size, mime }) => ({ id, submission_id, filename, size, mime }));
  const findUser = (db, id) => db.users.find((u) => u.id === id) || null;
  const emailTaken = (db, email, excludeId) => db.users.some((u) => u.email.toLowerCase() === email.toLowerCase() && u.id !== excludeId);
  function rollTaken(db, roll, excludeId) {
    if (!roll) return false;
    return db.users.some((u) => u.role === 'student' && u.roll_no && u.roll_no.toLowerCase() === roll.toLowerCase() && u.id !== excludeId);
  }
  function storeFile(f) {
    const name = safeFilename(f && f.name);
    const bytes = b64bytes((f && f.data) || '');
    if (!bytes) throw new ApiError(400, `Attachment '${name}' is not valid base64 data.`);
    if (bytes.length > MAX_FILE_BYTES) throw new ApiError(413, `Attachment '${name}' is too large for the demo. Files are kept in your browser; please keep each one under 1.5 MB.`);
    return { filename: name, data: f.data, size: bytes.length, mime: guessMime(name) };
  }

  /* ---------- auth / session ---------- */
  function apiConfig({ db }) {
    return { college_name: COLLEGE_NAME, allow_student_signup: db.settings.student_signup === '1', allow_teacher_signup: db.settings.teacher_signup === '1',
      teacher_code_required: !!db.settings.teacher_code, allowed_email_domains: allowedDomains(db), portal: 'both', demo: true };
  }
  function apiLogin({ db, body }) {
    const role = body.role;
    if (!ROLES.includes(role)) throw new ApiError(400, 'Invalid role.');
    const identifier = String(body.identifier || body.email || '').trim();
    const password = body.password || '';
    if (!identifier || !password) throw new ApiError(400, 'Enter your email (or roll number) and password.');
    const id = identifier.toLowerCase();
    const user = db.users.find((u) => u.role === role && (u.email.toLowerCase() === id || (u.roll_no && u.roll_no.toLowerCase() === id)));
    if (!user || !verifyPassword(password, user.password_hash)) throw new ApiError(401, `No ${role} account matches those credentials.`);
    if (user.status === 'pending') throw new ApiError(403, 'Your request has been sent. You can sign in once a teacher approves your account.');
    db.session = { user_id: user.id, view_as: null };
    save(db);
    return { user: publicUser(user) };
  }
  function apiRegister({ db, body }) {
    const role = body.role || 'student';
    if (!ROLES.includes(role)) throw new ApiError(400, 'Invalid role.');
    if (db.settings[`${role}_signup`] !== '1') throw new ApiError(403, 'Sign-up is currently closed. Ask a teacher to create your account.');
    require(body, 'email', 'password');
    if (role === 'teacher') {
      const expected = normalizeCode(db.settings.teacher_code);
      if (expected && normalizeCode(body.access_code) !== expected) throw new ApiError(403, 'The teacher access code is wrong. Ask your department for the current code.');
    }
    const email = String(body.email).trim().toLowerCase();
    if (!validEmail(email)) throw new ApiError(400, 'Please enter a valid email address.');
    const domains = allowedDomains(db);
    if (domains.length && !domains.includes(email.split('@').pop())) throw new ApiError(400, 'Please use your ' + domains.map((d) => '@' + d).join(' or ') + ' address.');
    validatePassword(body.password);
    let roll = null;
    if (role === 'student') {
      roll = String(body.roll_no || '').trim().toUpperCase().slice(0, 50);
      if (!roll) throw new ApiError(400, 'Enter your student ID / roll number.');
      if (rollTaken(db, roll)) throw new ApiError(409, 'That ID number is already registered. Sign in, or ask your teacher.');
    }
    if (emailTaken(db, email)) throw new ApiError(409, 'An account with that email already exists.');
    const local = email.split('@')[0];
    const name = local.split(/[._\-+]+|\d+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ') || local;
    db.users.push({ id: ++db.seq.users, role, name, email, roll_no: roll, group_name: '', password_hash: hashPassword(body.password), created_at: nowIso(), status: role === 'student' ? 'pending' : 'active' });
    save(db);
    if (role === 'teacher') return { pending: false, message: 'Your teacher account is ready. Sign in with your email and password.' };
    return { pending: true, message: 'Request sent. Your teacher will approve it, then you can sign in.' };
  }
  function apiLogout({ db }) { db.session = null; save(db); return { ok: true }; }
  function apiMe({ user, viewAs }) { return { user: publicUser(user), view_as: viewAs ? publicUser(viewAs) : null, portal: 'both' }; }
  function apiPreviewStart({ db, body }) {
    const sid = parseInt(body.student_id, 10);
    if (!sid) throw new ApiError(400, 'Choose a student.');
    const student = db.users.find((u) => u.id === sid && u.role === 'student' && u.status === 'active');
    if (!student) throw new ApiError(404, 'Student not found.');
    db.session.view_as = sid; save(db);
    return { view_as: publicUser(student) };
  }
  function apiPreviewStop({ db }) { if (db.session) db.session.view_as = null; save(db); return { ok: true }; }
  function apiChangePassword({ db, user, body, preview }) {
    if (preview) throw new ApiError(403, 'Password changes are disabled in preview.');
    if (!verifyPassword(body.current_password || '', user.password_hash)) throw new ApiError(400, 'Current password is incorrect.');
    validatePassword(body.new_password);
    user.password_hash = hashPassword(body.new_password); save(db);
    return { ok: true };
  }

  /* ---------- files ---------- */
  function apiDownload({ db, user, params, query }) {
    const id = parseInt(params.id, 10);
    let f;
    if (params.kind === 'assignment') {
      f = db.assignment_files.find((x) => x.id === id);
      if (!f) throw new ApiError(404, 'File not found.');
      const a = db.assignments.find((x) => x.id === f.assignment_id);
      if (user.role === 'student' && (a.status !== 'published' || (a.target_group && a.target_group !== user.group_name))) throw new ApiError(403, 'You do not have access to this file.');
    } else {
      f = db.submission_files.find((x) => x.id === id);
      if (!f) throw new ApiError(404, 'File not found.');
      const s = db.submissions.find((x) => x.id === f.submission_id);
      if (user.role === 'student' && s.student_id !== user.id) throw new ApiError(403, 'You do not have access to this file.');
    }
    return { __file: { data: f.data, mime: f.mime, filename: f.filename, inline: query.inline === '1' } };
  }

  /* ---------- student ---------- */
  function studentAssignments(db, user, onlyId) {
    let items = db.assignments.filter((a) => a.status === 'published' && (a.target_group === '' || a.target_group === user.group_name));
    if (onlyId != null) items = items.filter((a) => a.id === onlyId);
    return sortBy(items, 'due_at').map((a) => {
      const s = db.submissions.find((x) => x.assignment_id === a.id && x.student_id === user.id) || null;
      const out = { id: a.id, title: a.title, subject: a.subject, description: a.description, target_group: a.target_group, due_at: a.due_at, max_marks: a.max_marks,
        allow_late: a.allow_late, accept_submissions: a.accept_submissions, created_at: a.created_at, updated_at: a.updated_at,
        submission_id: s ? s.id : null, text_answer: s ? s.text_answer : null, submitted_at: s ? s.submitted_at : null, is_late: s ? s.is_late : null,
        grade: s ? s.grade : null, feedback: s ? s.feedback : null, graded_at: s ? s.graded_at : null, files: filesOf(db, a.id) };
      out.overdue = isPast(out.due_at);
      out.state = out.graded_at ? 'graded' : out.submission_id ? 'submitted' : out.overdue ? 'overdue' : 'pending';
      out.can_submit = !!out.accept_submissions && out.grade == null && (!out.overdue || !!out.allow_late);
      out.submission_files = s ? subFilesOf(db, s.id) : [];
      return out;
    });
  }
  const apiStudentAssignments = ({ db, user }) => ({ assignments: studentAssignments(db, user) });
  function apiStudentAssignment({ db, user, params }) {
    const items = studentAssignments(db, user, parseInt(params.id, 10));
    if (!items.length) throw new ApiError(404, 'Assignment not found.');
    return { assignment: items[0] };
  }
  function apiStudentSubmit(ctx) {
    const { db, user, body, params, preview } = ctx;
    if (preview) throw new ApiError(403, 'You are previewing the portal as a student. Submissions are disabled in preview.');
    const aid = parseInt(params.id, 10);
    const a = studentAssignments(db, user, aid)[0];
    if (!a) throw new ApiError(404, 'Assignment not found.');
    if (!a.can_submit) {
      if (a.graded_at) throw new ApiError(403, 'This submission has already been graded and is locked.');
      if (!a.accept_submissions) throw new ApiError(403, 'The teacher has closed submissions for this assignment.');
      throw new ApiError(403, 'The deadline has passed and late submissions are not allowed.');
    }
    const text = String(body.text_answer || '').trim();
    const files = body.files || [];
    if (!Array.isArray(files) || files.length > 10) throw new ApiError(400, 'You can attach up to 10 files.');
    if (!text && !files.length) throw new ApiError(400, 'Write an answer or attach at least one file.');
    const stored = files.map(storeFile);
    const old = db.submissions.find((x) => x.assignment_id === aid && x.student_id === user.id);
    if (old) { db.submission_files = db.submission_files.filter((f) => f.submission_id !== old.id); db.submissions = db.submissions.filter((x) => x.id !== old.id); }
    const sid = ++db.seq.submissions;
    db.submissions.push({ id: sid, assignment_id: aid, student_id: user.id, text_answer: text, submitted_at: nowIso(), is_late: a.overdue ? 1 : 0, grade: null, feedback: '', graded_at: null, graded_by: null });
    for (const f of stored) db.submission_files.push({ id: ++db.seq.sfiles, submission_id: sid, ...f });
    save(db);
    return apiStudentAssignment(ctx);
  }

  /* ---------- teacher: assignments ---------- */
  function teacherRows(db, filter) {
    let items = db.assignments.filter(filter || (() => true));
    items = sortBy(items, (x, y) => -cmp(x.status, y.status), 'due_at');
    return items.map((a) => {
      const subs = db.submissions.filter((s) => s.assignment_id === a.id);
      const creator = findUser(db, a.created_by);
      return { ...a, created_by_name: creator ? creator.name : null, submission_count: subs.length, ungraded_count: subs.filter((s) => !s.graded_at).length,
        student_count: db.users.filter((u) => u.role === 'student' && u.status === 'active' && (a.target_group === '' || u.group_name === a.target_group)).length,
        files: filesOf(db, a.id), overdue: isPast(a.due_at) };
    });
  }
  function apiTeacherOverview({ db }) {
    const now = nowIso();
    const stats = {
      assignments: db.assignments.length, published: db.assignments.filter((a) => a.status === 'published').length,
      students: db.users.filter((u) => u.role === 'student' && u.status === 'active').length,
      pending_students: db.users.filter((u) => u.role === 'student' && u.status === 'pending').length,
      teachers: db.users.filter((u) => u.role === 'teacher' && u.status === 'active').length,
      submissions: db.submissions.length, ungraded: db.submissions.filter((s) => !s.graded_at).length,
    };
    const recent = sortBy(db.submissions, (x, y) => -cmp(x.submitted_at, y.submitted_at)).slice(0, 8).map((s) => {
      const a = db.assignments.find((x) => x.id === s.assignment_id) || {}; const u = findUser(db, s.student_id) || {};
      return { id: s.id, submitted_at: s.submitted_at, is_late: s.is_late, grade: s.grade, assignment_id: a.id, title: a.title, max_marks: a.max_marks, student_name: u.name, roll_no: u.roll_no, group_name: u.group_name };
    });
    const upcoming = teacherRows(db, (a) => a.status === 'published' && a.due_at >= now).slice(0, 5);
    return { stats, recent_submissions: recent, upcoming };
  }
  const apiTeacherAssignments = ({ db }) => ({ assignments: teacherRows(db) });
  function apiTeacherAssignment({ db, params }) {
    const rows = teacherRows(db, (a) => a.id === parseInt(params.id, 10));
    if (!rows.length) throw new ApiError(404, 'Assignment not found.');
    return { assignment: rows[0] };
  }
  function parseAssignment(body) {
    require(body, 'title', 'due_at');
    if (isNaN(new Date(body.due_at))) throw new ApiError(400, 'Due date is not valid.');
    const raw = body.max_marks;
    let maxMarks = null;
    if (!(raw == null || String(raw).trim() === '')) {
      maxMarks = Number(raw);
      if (isNaN(maxMarks)) throw new ApiError(400, 'Max marks must be a number.');
      if (maxMarks <= 0) throw new ApiError(400, 'Max marks must be greater than zero.');
    }
    const status = body.status || 'draft';
    if (!['draft', 'published'].includes(status)) throw new ApiError(400, 'Status must be draft or published.');
    return { title: String(body.title).trim().slice(0, 200), subject: String(body.subject || '').trim().slice(0, 100), description: String(body.description || '').trim(),
      target_group: String(body.target_group || '').trim().toUpperCase().slice(0, 50), due_at: String(body.due_at).slice(0, 16), max_marks: maxMarks, status,
      allow_late: body.allow_late ? 1 : 0, accept_submissions: body.accept_submissions === false ? 0 : 1 };
  }
  function addFiles(db, aid, files) {
    if (!Array.isArray(files) || files.length > 10) throw new ApiError(400, 'You can attach up to 10 files per request.');
    for (const f of files.map(storeFile)) db.assignment_files.push({ id: ++db.seq.afiles, assignment_id: aid, ...f, uploaded_at: nowIso() });
  }
  function apiTeacherCreateAssignment(ctx) {
    const { db, user, body } = ctx;
    const data = parseAssignment(body);
    const ts = nowIso();
    const a = { id: ++db.seq.assignments, ...data, created_by: user.id, created_at: ts, updated_at: ts };
    db.assignments.push(a);
    addFiles(db, a.id, body.files || []);
    save(db);
    return apiTeacherAssignment({ db, params: { id: a.id } });
  }
  function apiTeacherUpdateAssignment({ db, body, params }) {
    const aid = parseInt(params.id, 10);
    const a = db.assignments.find((x) => x.id === aid);
    if (!a) throw new ApiError(404, 'Assignment not found.');
    const merged = { ...a };
    for (const [k, v] of Object.entries(body)) if (k !== 'files' && k !== 'remove_file_ids') merged[k] = v;
    merged.accept_submissions = 'accept_submissions' in body ? !!body.accept_submissions : !!a.accept_submissions;
    const data = parseAssignment(merged);
    Object.assign(a, data, { updated_at: nowIso() });
    const remove = new Set((body.remove_file_ids || []).map((x) => parseInt(x, 10)));
    db.assignment_files = db.assignment_files.filter((f) => !(f.assignment_id === aid && remove.has(f.id)));
    addFiles(db, aid, body.files || []);
    save(db);
    return apiTeacherAssignment({ db, params: { id: aid } });
  }
  function apiTeacherDeleteAssignment({ db, params }) {
    const aid = parseInt(params.id, 10);
    if (!db.assignments.some((a) => a.id === aid)) throw new ApiError(404, 'Assignment not found.');
    const subIds = new Set(db.submissions.filter((s) => s.assignment_id === aid).map((s) => s.id));
    db.submission_files = db.submission_files.filter((f) => !subIds.has(f.submission_id));
    db.submissions = db.submissions.filter((s) => s.assignment_id !== aid);
    db.assignment_files = db.assignment_files.filter((f) => f.assignment_id !== aid);
    db.assignments = db.assignments.filter((a) => a.id !== aid);
    save(db);
    return { ok: true };
  }

  /* ---------- teacher: submissions & grading ---------- */
  function submissionsFor(db, aid) {
    const a = db.assignments.find((x) => x.id === aid);
    if (!a) throw new ApiError(404, 'Assignment not found.');
    const students = sortBy(db.users.filter((u) => u.role === 'student' && u.status === 'active' && (a.target_group === '' || u.group_name === a.target_group)), 'group_name', 'roll_no', 'name')
      .map((u) => {
        const s = db.submissions.find((x) => x.student_id === u.id && x.assignment_id === aid) || null;
        return { student_id: u.id, name: u.name, roll_no: u.roll_no, email: u.email, group_name: u.group_name,
          submission_id: s ? s.id : null, text_answer: s ? s.text_answer : null, submitted_at: s ? s.submitted_at : null, is_late: s ? s.is_late : null,
          grade: s ? s.grade : null, feedback: s ? s.feedback : null, graded_at: s ? s.graded_at : null,
          files: s ? subFilesOf(db, s.id) : [], state: s ? (s.graded_at ? 'graded' : 'submitted') : 'missing' };
      });
    return { assignment: { ...a }, students };
  }
  const apiTeacherSubmissions = ({ db, params }) => submissionsFor(db, parseInt(params.id, 10));
  function apiTeacherExport({ db, params }) {
    const { assignment: a, students } = submissionsFor(db, parseInt(params.id, 10));
    const cell = (v) => { v = v == null ? '' : String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [['Roll No', 'Name', 'Group', 'Email', 'Status', 'Submitted At', 'Late', 'Grade', 'Max Marks', 'Feedback']];
    for (const s of students) lines.push([s.roll_no || '', s.name, s.group_name, s.email, s.state, s.submitted_at || '', s.is_late ? 'yes' : '', num(s.grade), num(a.max_marks), s.feedback || '']);
    const csv = '﻿' + lines.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
    return { __file: { data: b64text(csv), mime: 'text/csv; charset=utf-8', filename: safeFilename(`${a.title}-marks.csv`) } };
  }
  function apiTeacherGrade({ db, user, body, params }) {
    const s = db.submissions.find((x) => x.id === parseInt(params.id, 10));
    if (!s) throw new ApiError(404, 'Submission not found.');
    const a = db.assignments.find((x) => x.id === s.assignment_id);
    let grade = null;
    if (!(body.grade == null || body.grade === '')) {
      grade = Number(body.grade);
      if (isNaN(grade)) throw new ApiError(400, 'Grade must be a number.');
      if (grade < 0) throw new ApiError(400, 'Grade cannot be negative.');
      if (a.max_marks != null && grade > a.max_marks) throw new ApiError(400, `Grade must be between 0 and ${num(a.max_marks)}.`);
    }
    const feedback = String(body.feedback || '').trim();
    // An assignment without max marks counts as graded once feedback (or a number) is saved.
    const graded = grade != null || (a.max_marks == null && !!feedback);
    Object.assign(s, { grade, feedback, graded_at: graded ? nowIso() : null, graded_by: graded ? user.id : null });
    save(db);
    return { ok: true };
  }
  function apiTeacherDeleteSubmission({ db, params }) {
    const sid = parseInt(params.id, 10);
    db.submission_files = db.submission_files.filter((f) => f.submission_id !== sid);
    db.submissions = db.submissions.filter((s) => s.id !== sid);
    save(db);
    return { ok: true };
  }

  /* ---------- teacher: people & settings ---------- */
  const groupsOf = (db) => [...new Set(db.users.filter((u) => u.role === 'student' && u.group_name).map((u) => u.group_name))].sort();
  function apiTeacherUsers({ db, query }) {
    const role = query.role || 'student';
    if (!ROLES.includes(role)) throw new ApiError(400, 'Invalid role.');
    const users = sortBy(db.users.filter((u) => u.role === role), (x, y) => (y.status === 'pending') - (x.status === 'pending'), 'group_name', 'roll_no', 'name')
      .map((u) => ({ ...publicUser(u), submission_count: db.submissions.filter((s) => s.student_id === u.id).length }));
    return { users, groups: groupsOf(db) };
  }
  function apiTeacherGroups({ db }) {
    return { groups: [...new Set([...groupsOf(db), ...db.assignments.map((a) => a.target_group).filter(Boolean)])].sort() };
  }
  function apiTeacherCreateUser({ db, body }) {
    const role = body.role;
    if (!ROLES.includes(role)) throw new ApiError(400, 'Invalid role.');
    require(body, 'name', 'email', 'password');
    const roll = String(body.roll_no || '').trim().toUpperCase() || null;
    if (role === 'student') { require(body, 'roll_no', 'group_name'); if (rollTaken(db, roll)) throw new ApiError(409, 'Another student already has that roll number.'); }
    const email = String(body.email).trim().toLowerCase();
    if (!validEmail(email)) throw new ApiError(400, 'Please enter a valid email address.');
    validatePassword(body.password);
    if (emailTaken(db, email)) throw new ApiError(409, 'An account with that email already exists.');
    const u = { id: ++db.seq.users, role, name: String(body.name).trim(), email, roll_no: roll, group_name: String(body.group_name || '').trim().toUpperCase(), password_hash: hashPassword(body.password), created_at: nowIso(), status: 'active' };
    db.users.push(u); save(db);
    return { user: publicUser(u) };
  }
  function apiTeacherUpdateUser({ db, body, params }) {
    const uid = parseInt(params.id, 10);
    const u = findUser(db, uid);
    if (!u) throw new ApiError(404, 'User not found.');
    const email = String(body.email || u.email).trim().toLowerCase();
    if (!validEmail(email)) throw new ApiError(400, 'Please enter a valid email address.');
    if (emailTaken(db, email, uid)) throw new ApiError(409, 'Another account already uses that email.');
    const roll = ('roll_no' in body ? body.roll_no : u.roll_no) || null;
    const group = ('group_name' in body ? body.group_name : u.group_name) || '';
    Object.assign(u, { name: String(body.name || u.name).trim(), email, roll_no: roll ? String(roll).trim().toUpperCase() : null, group_name: String(group).trim().toUpperCase() });
    if (body.new_password) {
      validatePassword(body.new_password);
      u.password_hash = hashPassword(body.new_password);
      if (db.session && db.session.user_id === uid) db.session = null;   // a new password signs the user out everywhere
    }
    save(db);
    return { user: publicUser(u) };
  }
  function apiTeacherApproveUser({ db, body, params }) {
    const uid = parseInt(params.id, 10);
    const u = findUser(db, uid);
    if (!u) throw new ApiError(404, 'User not found.');
    if (u.role !== 'student') throw new ApiError(400, 'Only student requests need approval.');
    require(body, 'name', 'roll_no', 'group_name');
    const roll = String(body.roll_no).trim().toUpperCase();
    if (rollTaken(db, roll, uid)) throw new ApiError(409, 'Another student already has that roll number.');
    Object.assign(u, { name: String(body.name).trim(), roll_no: roll, group_name: String(body.group_name).trim().toUpperCase(), status: 'active' });
    save(db);
    return { user: publicUser(u) };
  }
  function apiTeacherDeleteUser({ db, user, params }) {
    const uid = parseInt(params.id, 10);
    if (uid === user.id) throw new ApiError(400, 'You cannot delete your own account.');
    const u = findUser(db, uid);
    if (!u) throw new ApiError(404, 'User not found.');
    if (u.role === 'teacher' && u.status === 'active' && db.users.filter((x) => x.role === 'teacher' && x.status === 'active').length <= 1) throw new ApiError(400, 'At least one teacher account must remain.');
    const subIds = new Set(db.submissions.filter((s) => s.student_id === uid).map((s) => s.id));
    db.submission_files = db.submission_files.filter((f) => !subIds.has(f.submission_id));
    db.submissions = db.submissions.filter((s) => s.student_id !== uid);
    db.users = db.users.filter((x) => x.id !== uid);
    if (db.session && db.session.view_as === uid) db.session.view_as = null;
    save(db);
    return { ok: true };
  }
  function apiTeacherRequests({ db }) {
    const pending = sortBy(db.users.filter((u) => u.status === 'pending' && u.role === 'student'), (x, y) => -cmp(x.created_at, y.created_at))
      .map(({ id, role, name, email, roll_no, created_at }) => ({ id, role, name, email, roll_no, created_at }));
    return { requests: pending, server_time: nowIso() };
  }
  const apiTeacherSettings = ({ db }) => ({ settings: settingsPayload(db) });
  function apiTeacherUpdateSettings({ db, body }) {
    if ('student_signup' in body) db.settings.student_signup = body.student_signup ? '1' : '0';
    if ('teacher_signup' in body) db.settings.teacher_signup = body.teacher_signup ? '1' : '0';
    if ('teacher_code' in body) {
      const code = String(body.teacher_code || '').trim();
      if (code && normalizeCode(code).length < 4) throw new ApiError(400, 'The teacher access code must be at least 4 letters or digits.');
      db.settings.teacher_code = code;
    }
    if ('allowed_email_domains' in body) {
      const raw = body.allowed_email_domains;
      const clean = [];
      for (let d of Array.isArray(raw) ? raw : String(raw).split(',')) {
        d = d.trim().toLowerCase().replace(/^@/, '');
        if (!d) continue;
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new ApiError(400, `'${d}' is not a valid email domain.`);
        clean.push(d);
      }
      db.settings.allowed_email_domains = clean.join(',');
    }
    save(db);
    return { settings: settingsPayload(db) };
  }

  /* ---------- routing (same table as server.py) ---------- */
  const ROUTES = [
    ['GET', /^\/api\/config$/, apiConfig, null],
    ['POST', /^\/api\/auth\/login$/, apiLogin, null],
    ['POST', /^\/api\/auth\/register$/, apiRegister, null],
    ['POST', /^\/api\/auth\/logout$/, apiLogout, null],
    ['GET', /^\/api\/me$/, apiMe, 'any'],
    ['POST', /^\/api\/me\/password$/, apiChangePassword, 'any'],
    ['POST', /^\/api\/preview$/, apiPreviewStart, 'teacher'],
    ['DELETE', /^\/api\/preview$/, apiPreviewStop, 'teacher'],
    ['GET', /^\/api\/files\/(?<kind>assignment|submission)\/(?<id>\d+)$/, apiDownload, 'any'],
    ['GET', /^\/api\/student\/assignments$/, apiStudentAssignments, 'student'],
    ['GET', /^\/api\/student\/assignments\/(?<id>\d+)$/, apiStudentAssignment, 'student'],
    ['POST', /^\/api\/student\/assignments\/(?<id>\d+)\/submit$/, apiStudentSubmit, 'student'],
    ['GET', /^\/api\/teacher\/overview$/, apiTeacherOverview, 'teacher'],
    ['GET', /^\/api\/teacher\/groups$/, apiTeacherGroups, 'teacher'],
    ['GET', /^\/api\/teacher\/assignments$/, apiTeacherAssignments, 'teacher'],
    ['POST', /^\/api\/teacher\/assignments$/, apiTeacherCreateAssignment, 'teacher'],
    ['GET', /^\/api\/teacher\/assignments\/(?<id>\d+)$/, apiTeacherAssignment, 'teacher'],
    ['PUT', /^\/api\/teacher\/assignments\/(?<id>\d+)$/, apiTeacherUpdateAssignment, 'teacher'],
    ['DELETE', /^\/api\/teacher\/assignments\/(?<id>\d+)$/, apiTeacherDeleteAssignment, 'teacher'],
    ['GET', /^\/api\/teacher\/assignments\/(?<id>\d+)\/submissions$/, apiTeacherSubmissions, 'teacher'],
    ['GET', /^\/api\/teacher\/assignments\/(?<id>\d+)\/export\.csv$/, apiTeacherExport, 'teacher'],
    ['PUT', /^\/api\/teacher\/submissions\/(?<id>\d+)\/grade$/, apiTeacherGrade, 'teacher'],
    ['DELETE', /^\/api\/teacher\/submissions\/(?<id>\d+)$/, apiTeacherDeleteSubmission, 'teacher'],
    ['GET', /^\/api\/teacher\/users$/, apiTeacherUsers, 'teacher'],
    ['POST', /^\/api\/teacher\/users$/, apiTeacherCreateUser, 'teacher'],
    ['PUT', /^\/api\/teacher\/users\/(?<id>\d+)$/, apiTeacherUpdateUser, 'teacher'],
    ['PUT', /^\/api\/teacher\/users\/(?<id>\d+)\/approve$/, apiTeacherApproveUser, 'teacher'],
    ['GET', /^\/api\/teacher\/requests$/, apiTeacherRequests, 'teacher'],
    ['GET', /^\/api\/teacher\/settings$/, apiTeacherSettings, 'teacher'],
    ['PUT', /^\/api\/teacher\/settings$/, apiTeacherUpdateSettings, 'teacher'],
    ['DELETE', /^\/api\/teacher\/users\/(?<id>\d+)$/, apiTeacherDeleteUser, 'teacher'],
  ];

  function handle(method, path, query, body) {
    const db = getDb();
    for (const [m, re, fn, role] of ROUTES) {
      const match = re.exec(path);
      if (!match || m !== method) continue;
      let user = null, viewAs = null, preview = false;
      if (db.session) {
        user = findUser(db, db.session.user_id);
        if (user && user.role === 'teacher' && db.session.view_as) viewAs = db.users.find((u) => u.id === db.session.view_as && u.role === 'student') || null;
      }
      if (role !== null) {
        if (!user || user.status === 'pending') throw new ApiError(401, 'Please log in.');
        if (role === 'student' && user.role === 'teacher' && viewAs) { user = viewAs; preview = true; }
        else if (role !== 'any' && user.role !== role) throw new ApiError(403, `This action requires a ${role} account.`);
      }
      return fn({ db, user, viewAs, preview, body: body || {}, params: match.groups || {}, query: query || {} });
    }
    if (ROUTES.some(([, re]) => re.test(path))) throw new ApiError(405, 'Method not allowed.');
    throw new ApiError(404, 'Unknown API endpoint.');
  }

  /* ---------- fetch interception ---------- */
  const jsonResponse = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  function fileBlob(f) { return new Blob([b64bytes(f.data) || new Uint8Array()], { type: f.mime }); }
  function fileResponse(f) {
    return new Response(fileBlob(f), { status: 200, headers: { 'Content-Type': f.mime, 'Content-Disposition': `${f.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}` } });
  }
  function isApiUrl(url) { return url.origin === location.origin && url.pathname.startsWith('/api/'); }

  window.fetch = async function (input, init) {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const url = new URL(isRequest ? input.url : String(input), location.href);
    if (!isApiUrl(url)) return realFetch(input, init);
    const method = String((init && init.method) || (isRequest && input.method) || 'GET').toUpperCase();
    let body = {};
    const raw = init && init.body != null ? init.body : (isRequest && method !== 'GET' ? await input.text() : null);
    if (raw != null && raw !== '') {
      try { body = JSON.parse(raw); } catch (_) { return jsonResponse(400, { error: 'Request body is not valid JSON.' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonResponse(400, { error: 'Request body must be a JSON object.' });
    }
    try {
      const result = handle(method, url.pathname, Object.fromEntries(url.searchParams), body);
      if (result && result.__file) return fileResponse(result.__file);
      return jsonResponse(200, result == null ? { ok: true } : result);
    } catch (e) {
      if (e instanceof ApiError) return jsonResponse(e.status, { error: e.message });
      console.error('[DocVault demo] unhandled error', e);
      return jsonResponse(500, { error: 'Internal demo error: ' + e.message });
    }
  };

  // Download links (<a href="/api/files/..."> and the CSV export) are real navigations, not fetches:
  // answer them from the fake backend and hand the browser a Blob to save.
  function downloadBlob(f) {
    const url = URL.createObjectURL(fileBlob(f));
    const a = document.createElement('a'); a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const notify = (msg, type) => (window.UI && UI.toast ? UI.toast(msg, type) : alert(msg));
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    let url; try { url = new URL(a.getAttribute('href'), location.href); } catch (_) { return; }
    if (!isApiUrl(url)) return;
    e.preventDefault();
    try {
      const r = handle('GET', url.pathname, Object.fromEntries(url.searchParams), {});
      if (r && r.__file) downloadBlob(r.__file);
    } catch (err) { notify(err.message, 'bad'); }
  }, true);

  /* ---------- the demo banner ---------- */
  const SAMPLE_ACCOUNTS = [
    ['Teacher', 'priya.nair@gmail.com', 'teacher123'],
    ['Teacher', 'arun.mehta@gmail.com', 'teacher123'],
    ['Student (CSE-3A)', 'CS2301 or ananya.rao@gmail.com', 'student123'],
    ['Student (CSE-3A)', 'CS2302 or rahul.verma@gmail.com', 'student123'],
    ['Student (ECE-2B)', 'EC2201 or meera.joshi@gmail.com', 'student123'],
  ];
  function showAccounts() {
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    if (window.UI && UI.modal) {
      UI.modal({
        title: 'Sample logins for the demo',
        body: `<p style="color:var(--text-secondary);margin-bottom:12px">Every account below already exists. New teachers sign up with the access code <code style="font-family:ui-monospace,Menlo,monospace;background:var(--surface-alt);padding:2px 6px;border-radius:6px">${DEFAULT_TEACHER_CODE}</code>; new students send a request that a teacher approves.</p>
          <div class="table-wrap"><table><thead><tr><th>Role</th><th>Sign in with</th><th>Password</th></tr></thead><tbody>
          ${SAMPLE_ACCOUNTS.map(([r, id, pw]) => `<tr><td>${esc(r)}</td><td>${esc(id)}</td><td><code>${esc(pw)}</code></td></tr>`).join('')}
          </tbody></table></div>
          <p class="hint" style="margin-top:12px">There is also one pending student request (vikram.singh@gmail.com) waiting under Students → Account requests.</p>`,
        footer: '<button class="btn btn-primary" data-close>Got it</button>',
      });
    } else {
      alert('Sample logins\n\n' + SAMPLE_ACCOUNTS.map(([r, id, pw]) => `${r}: ${id} / ${pw}`).join('\n') + `\n\nTeacher access code: ${DEFAULT_TEACHER_CODE}`);
    }
  }
  function resetDemo() {
    const ok = window.UI && UI.confirmDialog
      ? UI.confirmDialog('Reset demo data?', 'Everything you changed in this browser is thrown away and the sample accounts, assignments and submissions come back.', { okLabel: 'Reset' })
      : Promise.resolve(confirm('Reset the demo data in this browser?'));
    ok.then((yes) => { if (!yes) return; resetDb(); location.href = '/'; });
  }
  function mountBanner() {
    if (document.querySelector('.demo-banner')) return;
    const style = document.createElement('style');
    style.textContent = `
      :root { --demo-h: 36px; }
      body { height: auto; min-height: 100%; }
      .demo-banner { position: sticky; top: 0; z-index: 60; display: flex; align-items: center; justify-content: center; gap: 8px 12px; flex-wrap: wrap;
        min-height: 36px; padding: 6px 14px; background: #fffbeb; color: #92400e; border-bottom: 1px solid #fcd34d;
        font: 500 12.5px/1.3 -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
      .demo-banner svg { width: 15px; height: 15px; flex: none; }
      .demo-banner strong { color: #78350f; font-weight: 700; }
      .demo-banner .demo-actions { display: flex; gap: 6px; }
      .demo-banner button { font: inherit; font-weight: 600; color: #92400e; background: #fef3c7; border: 1px solid #fcd34d; border-radius: 999px; padding: 2px 10px; cursor: pointer; line-height: 1.5; }
      .demo-banner button:hover { background: #fde68a; }
      .app, .auth, .landing { min-height: calc(100vh - var(--demo-h)); }
      .sidebar { top: var(--demo-h); height: calc(100vh - var(--demo-h)); }
      .topbar { top: var(--demo-h); }
      .preview-bar { top: var(--demo-h); }
      .preview-bar + .topbar { top: calc(var(--demo-h) + 42px); }
      @media (max-width: 760px) { .preview-bar + .topbar { top: auto; } }
      @media (max-width: 600px) { .demo-banner { padding: 5px 10px; font-size: 12px; gap: 4px 8px; } .demo-banner > svg { display: none; } }`;
    document.head.appendChild(style);
    const bar = document.createElement('div');
    bar.className = 'demo-banner'; bar.setAttribute('role', 'status');
    bar.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <span><strong>Demo mode</strong> – data lives only in this browser. Nothing is sent to a server.</span>
      <span class="demo-actions"><button type="button" data-accounts>Sample logins</button><button type="button" data-reset>Reset demo data</button></span>`;
    bar.querySelector('[data-accounts]').onclick = showAccounts;
    bar.querySelector('[data-reset]').onclick = resetDemo;
    document.body.prepend(bar);
    const fit = () => document.documentElement.style.setProperty('--demo-h', bar.offsetHeight + 'px');
    fit(); window.addEventListener('resize', fit);
  }
  if (document.body) mountBanner(); else document.addEventListener('DOMContentLoaded', mountBanner);

  getDb();   // seed on first visit
  window.DocVaultDemo = { reset: resetDb, key: KEY, accounts: SAMPLE_ACCOUNTS, teacherCode: DEFAULT_TEACHER_CODE };
})();
