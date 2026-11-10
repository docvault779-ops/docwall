# DocVault – College Assignment Portal

DocVault is a small web app for colleges with **two separate portals** served by **one
server** that shares a single assignments database:

| Portal | Default address | Who signs in there | What they can do |
|--------|-----------------|--------------------|------------------|
| **Student portal** | `http://<server>:8080` | Students only. There is **no teacher login** on this portal, and it is never mentioned. | See the assignments published for their class, read the instructions, download attachments, copy the text, submit a typed answer and/or files, resubmit until the deadline, and see marks + feedback. Nothing else. |
| **Teacher portal** | `http://<server>:8081` | Teachers. It also offers the student login, and a signed-in teacher can open the **student view** with their own teacher password. | Everything: create / edit / publish / unpublish / delete assignments, attach files, set deadlines and late policy, open or close submissions, review every submission, grade with feedback, export marks to CSV, and manage student and teacher accounts. |

A student account cannot log in on the teacher page (and vice versa), teacher accounts are
refused outright on the student portal, and every API route checks the role on the server,
not just in the browser.

**Student view (teacher preview).** From **Teacher portal → Student view** (or the eye icon
next to a student under **Students**) a teacher picks a student and opens the student portal
exactly as that student sees it: dashboard, assignments, attachments, grades. Submitting and
changing the password are disabled in preview, so nothing is ever recorded under the student's
name, and the teacher stays signed in as a teacher the whole time. Use **Exit preview** to
return.

The UI follows the DocVault prototype (dark sidebar, blue accent, card layout) and is **mobile friendly**: on phones (tested at a Pixel 9 size, 412 × 915) the sidebar becomes a slide-in menu, stat tiles go two-up, tables scroll sideways and dialogs fit the screen. Students can submit from their phones.

---

## Requirements

* **Python 3.10 or newer** – nothing else. No `pip install`, no Node, no database server.
  Data is stored in a SQLite file; uploaded files are stored on disk.

Check the server has Python:

```bash
python3 --version
```

---

## Run it (quick start)

```bash
cd docwall
python3 server.py
```

This starts both portals:

* Student portal: <http://localhost:8080>
* Teacher portal: <http://localhost:8081>

On the very first run DocVault creates `data/docwall.db` and prints the first teacher account:

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Teacher | `teacher@college.edu` | `Teacher@123` | Change this immediately (Profile → Change password). |

No students or assignments are created: students join by request and teachers create the assignments.

---

## How classes work

Each student has a **class / section** (for example `CSE-3A`). When a teacher creates an
assignment they choose who can see it: **All students** or one class. Students only ever
see assignments for their own class (or for everyone). The teacher's submission list shows
every student of that class, including the ones who have **not** submitted.

## How students join

Students never get in on their own. The flow is:

1. On the student portal the student chooses **Request a student account** and enters an
   **email address, their student ID / roll number, and a password** (typed twice). By default the email must be a `@gmail.com` address; the
   teacher can change the accepted domains (for example to the college's own domain).
2. The request shows up in the teacher portal under **Students → Account requests** (with a
   badge on the Students menu and a notice on the dashboard). Until a teacher acts, the student
   cannot sign in and sees "waiting for approval" if they try.
3. The teacher clicks **Approve**, checks the ID number the student gave, fills in the name
   and class/section, and the account becomes active. An ID that is already registered is refused. **Reject** removes the request.
4. Teachers can also create accounts directly with **Add student**, or switch requests off
   entirely in **Settings** once everyone has joined.

**Live invites.** While a teacher is signed in, the teacher portal checks for new requests every
few seconds. When a student (or a colleague) asks to join, a card pops up in the corner with
**Approve** and **Later**, so the teacher can let them in on the spot without going to the
Students page.

## How teachers join

Only the first teacher account is created by the server (see *Default accounts*). Every other
teacher either gets an account from a colleague (**Teachers → Add teacher**) or requests one:

1. On the teacher portal they choose **Request teacher access** and enter their **personal
   Gmail** (or another accepted domain) and a password (typed twice).
2. The request shows up under **Teachers → Teacher access requests** and as a live invite for any
   signed-in teacher. Approve only colleagues you know: an approved teacher has full control.
3. Teacher requests can be switched off in **Settings** once the staff has joined.

---

## Configuration (environment variables)

| Variable | Default | Meaning |
|----------|---------|---------|
| `DOCWALL_HOST` | `0.0.0.0` | Interface to listen on. Use `127.0.0.1` when behind Nginx/Apache. |
| `DOCWALL_STUDENT_PORT` | `8080` | Port of the student portal (`DOCWALL_PORT` is accepted as an alias). |
| `DOCWALL_TEACHER_PORT` | `8081` | Port of the teacher portal. Set it **equal** to the student port to serve one combined site with a "Student / Teacher" chooser page instead of two portals. |
| `DOCWALL_DATA` | `./data` | Where the SQLite DB and uploads live. Point this at a disk that gets backed up. |
| `DOCWALL_MAX_UPLOAD_MB` | `25` | Max size of a single uploaded file. |
| `DOCWALL_SESSION_DAYS` | `7` | How long a login lasts. |
| `DOCWALL_STUDENT_SIGNUP` | `1` | Initial value of the "students may request an account" switch. Teachers change it later in **Settings**. |
| `DOCWALL_TEACHER_SIGNUP` | `1` | Initial value of the "teachers may request access" switch. Teachers change it later in **Settings**. |
| `DOCWALL_ALLOWED_EMAIL_DOMAINS` | `gmail.com` | Initial list of email domains accepted for student requests (comma separated, empty = any). Teachers change it later in **Settings**. |
| `DOCWALL_SECURE_COOKIE` | `0` | Set to `1` when the site is served over HTTPS. |
| `DOCWALL_COLLEGE_NAME` | `DocVault College Portal` | Shown in the browser tab on the landing page. |
| `DOCWALL_ADMIN_EMAIL` | `teacher@college.edu` | First teacher account (first run only). |
| `DOCWALL_ADMIN_PASSWORD` | `Teacher@123` | Its password (first run only). |

---

## Deploying on the college server (Linux)

1. **Copy the folder** to the server, e.g. `/opt/docwall`, and make sure `python3 --version`
   is 3.10+.

2. **Create a data directory** that will be backed up:
   ```bash
   sudo mkdir -p /var/lib/docwall
   sudo chown www-data:www-data /var/lib/docwall
   ```

3. **Install the systemd service** (edit the email/password in it first):
   ```bash
   sudo cp deploy/docwall.service /etc/systemd/system/docwall.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now docwall
   sudo systemctl status docwall
   ```
   Logs: `journalctl -u docwall -f`

4. **Put Nginx in front (recommended)** so each portal gets its own hostname on port 80/443,
   for example `assignments.college.edu` for students and `staff.college.edu` for teachers:
   ```bash
   sudo cp deploy/nginx-docwall.conf /etc/nginx/sites-available/docwall
   sudo ln -s /etc/nginx/sites-available/docwall /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
   Edit the two `server_name` lines first. Then set `DOCWALL_SECURE_COOKIE=1` in the service
   file once HTTPS is on (e.g. with `certbot --nginx`).

   Give students only the student address. The teacher address can stay internal to the
   department (or be limited to the campus network with an Nginx `allow`/`deny` block).

5. **First login**: open the **teacher** address, sign in with the admin account,
   change the password and add the other teachers under **Teachers**.

### Without root access / on Windows

Just run `python3 server.py` (or `py server.py` on Windows) in a terminal or a `screen`/`tmux`
session. Students open `http://<server-ip>:8080`, teachers open `http://<server-ip>:8081`.
Set `DOCWALL_DATA` to a folder you own.

### Backups

Everything is in the data directory: `docwall.db` (users, assignments, grades) and
`uploads/` (files). Copy that folder; that's the whole backup.

```bash
tar czf docwall-backup-$(date +%F).tgz -C /var/lib/docwall .
```

---

## Project layout

```
docwall/
├── server.py              # HTTP server + REST API + SQLite schema (stdlib only)
├── public/
│   ├── index.html         # landing page: choose Student / Teacher
│   ├── student/           # student login + student portal
│   ├── teacher/           # teacher login + teacher portal
│   ├── css/styles.css     # design tokens from the DocVault prototype
│   └── js/                # ui.js (shared), auth.js, student.js, teacher.js
├── deploy/
│   ├── docwall.service    # systemd unit
│   └── nginx-docwall.conf # reverse-proxy config
└── data/                  # created on first run (DB + uploads) – back this up
```

## API overview

All endpoints return JSON; the session is an HttpOnly cookie.

| Method & path | Role | Purpose |
|---------------|------|---------|
| `POST /api/auth/login` | – | `{role, identifier, password}`; role must match the account; `teacher` is refused on the student portal |
| `POST /api/auth/register` | – | `{role, email, password}` account request (student, or teacher on the teacher portal); created as *pending* until a teacher approves |
| `POST /api/auth/logout`, `GET /api/me`, `POST /api/me/password` | any | session + password |
| `POST /api/preview` `{student_id}`, `DELETE /api/preview` | teacher | start / stop viewing the student portal as that student (student routes then run read-only as them) |
| `PUT /api/teacher/users/{id}/approve` `{name, roll_no, group_name}` | teacher | approve a pending request (students need roll_no and group_name; `DELETE /api/teacher/users/{id}` rejects) |
| `GET /api/teacher/requests` | teacher | pending requests, polled by the portal for live invites |
| `GET/PUT /api/teacher/settings` | teacher | `{student_signup, teacher_signup, allowed_email_domains}` |
| `GET /api/student/assignments[/{id}]` | student | published assignments for the student's class |
| `POST /api/student/assignments/{id}/submit` | student | `{text_answer, files:[{name,data(base64)}]}` |
| `GET /api/files/{assignment|submission}/{id}` | any (checked) | download a file |
| `GET /api/teacher/overview` | teacher | dashboard numbers |
| `GET/POST /api/teacher/assignments`, `GET/PUT/DELETE …/{id}` | teacher | manage assignments (+files) |
| `GET /api/teacher/assignments/{id}/submissions`, `…/export.csv` | teacher | review + export |
| `PUT /api/teacher/submissions/{id}/grade`, `DELETE …/{id}` | teacher | grade / remove |
| `GET/POST /api/teacher/users`, `PUT/DELETE …/{id}` | teacher | manage students & teachers |

## Security notes

* Passwords are hashed with PBKDF2-SHA256 (150k iterations). Sessions are random tokens in an
  HttpOnly, SameSite=Lax cookie.
* Uploaded files are stored under random names and served with `Content-Disposition: attachment`,
  so nothing a student uploads can run in another user's browser.
* Role checks live on the server for every route.
* Serve over HTTPS in production and set `DOCWALL_SECURE_COOKIE=1`.
