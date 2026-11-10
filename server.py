#!/usr/bin/env python3
"""
DocWall - assignment portal for colleges.

Two separate roles with separate logins:
  * student  - view published assignments, download attachments, submit work, see grades
  * teacher  - full control: create / edit / publish / delete assignments, grade, manage accounts

Runs on the Python standard library only (Python 3.10+). No pip install needed.

    python3 server.py

Configuration is read from environment variables (see README.md).
"""
import base64
import csv
import hashlib
import hmac
import io
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import threading
import uuid
from datetime import datetime, timedelta
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
DATA_DIR = os.environ.get("DOCWALL_DATA", os.path.join(BASE_DIR, "data"))
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
DB_PATH = os.path.join(DATA_DIR, "docwall.db")

HOST = os.environ.get("DOCWALL_HOST", "0.0.0.0")
# The student portal and the teacher portal are served on two different ports by
# the same process, sharing one database. Set both to the same port to get a single
# combined site with a role-chooser landing page instead.
STUDENT_PORT = int(os.environ.get("DOCWALL_STUDENT_PORT", os.environ.get("DOCWALL_PORT", "8080")))
TEACHER_PORT = int(os.environ.get("DOCWALL_TEACHER_PORT", "8081"))
MAX_BODY_BYTES = int(os.environ.get("DOCWALL_MAX_UPLOAD_MB", "25")) * 1024 * 1024
SESSION_DAYS = int(os.environ.get("DOCWALL_SESSION_DAYS", "7"))
ALLOW_STUDENT_SIGNUP = os.environ.get("DOCWALL_STUDENT_SIGNUP", "1") != "0"      # initial value; teachers can change it in Settings
ALLOWED_EMAIL_DOMAINS = os.environ.get("DOCWALL_ALLOWED_EMAIL_DOMAINS", "gmail.com")  # initial value; comma separated, '' = any
SECURE_COOKIE = os.environ.get("DOCWALL_SECURE_COOKIE", "0") == "1"
COLLEGE_NAME = os.environ.get("DOCWALL_COLLEGE_NAME", "DocWall College Portal")

DEFAULT_TEACHER_EMAIL = os.environ.get("DOCWALL_ADMIN_EMAIL", "teacher@college.edu")
DEFAULT_TEACHER_PASSWORD = os.environ.get("DOCWALL_ADMIN_PASSWORD", "Teacher@123")
SEED_DEMO_DATA = os.environ.get("DOCWALL_SEED_DEMO", "1") != "0"

COOKIE_NAME = "docwall_session"
ROLES = ("student", "teacher")

mimetypes.add_type("application/javascript", ".js")


# --------------------------------------------------------------------------- #
# Database
# --------------------------------------------------------------------------- #
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    role          TEXT NOT NULL CHECK (role IN ('student','teacher')),
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    roll_no       TEXT,
    group_name    TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active'  -- 'pending' = student request waiting for a teacher
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    view_as    INTEGER REFERENCES users(id) ON DELETE SET NULL  -- teacher previewing as this student
);
CREATE TABLE IF NOT EXISTS assignments (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    title              TEXT NOT NULL,
    subject            TEXT NOT NULL DEFAULT '',
    description        TEXT NOT NULL DEFAULT '',
    target_group       TEXT NOT NULL DEFAULT '',
    due_at             TEXT NOT NULL,
    max_marks          REAL NOT NULL DEFAULT 100,
    status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    allow_late         INTEGER NOT NULL DEFAULT 0,
    accept_submissions INTEGER NOT NULL DEFAULT 1,
    created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assignment_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    stored_name   TEXT NOT NULL,
    size          INTEGER NOT NULL,
    mime          TEXT NOT NULL DEFAULT 'application/octet-stream',
    uploaded_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text_answer   TEXT NOT NULL DEFAULT '',
    submitted_at  TEXT NOT NULL,
    is_late       INTEGER NOT NULL DEFAULT 0,
    grade         REAL,
    feedback      TEXT NOT NULL DEFAULT '',
    graded_at     TEXT,
    graded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (assignment_id, student_id)
);
CREATE TABLE IF NOT EXISTS submission_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    stored_name   TEXT NOT NULL,
    size          INTEGER NOT NULL,
    mime          TEXT NOT NULL DEFAULT 'application/octet-stream'
);
CREATE INDEX IF NOT EXISTS idx_sub_assignment ON submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_sub_student ON submissions(student_id);
"""


def now_iso():
    return datetime.now().replace(microsecond=0).isoformat()


def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 150_000).hex()
    return f"pbkdf2_sha256$150000${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, digest = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iters)).hex()
        return hmac.compare_digest(calc, digest)
    except (ValueError, AttributeError):
        return False


def init_db():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    first_run = not os.path.exists(DB_PATH)
    conn = db()
    conn.executescript(SCHEMA)
    # migrations for databases created by older versions
    if "view_as" not in [r[1] for r in conn.execute("PRAGMA table_info(sessions)")]:
        conn.execute("ALTER TABLE sessions ADD COLUMN view_as INTEGER REFERENCES users(id) ON DELETE SET NULL")
    if "status" not in [r[1] for r in conn.execute("PRAGMA table_info(users)")]:
        conn.execute("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    conn.commit()
    if first_run:
        seed(conn)
    conn.close()


def seed(conn):
    ts = now_iso()
    conn.execute(
        "INSERT INTO users (role, name, email, roll_no, group_name, password_hash, created_at) VALUES (?,?,?,?,?,?,?)",
        ("teacher", "Default Teacher", DEFAULT_TEACHER_EMAIL, None, "", hash_password(DEFAULT_TEACHER_PASSWORD), ts),
    )
    print(f"[seed] Created teacher account  -> {DEFAULT_TEACHER_EMAIL} / {DEFAULT_TEACHER_PASSWORD}")
    if SEED_DEMO_DATA:
        conn.execute(
            "INSERT INTO users (role, name, email, roll_no, group_name, password_hash, created_at) VALUES (?,?,?,?,?,?,?)",
            ("student", "Demo Student", "student@college.edu", "CS2301", "CSE-3A", hash_password("Student@123"), ts),
        )
        print("[seed] Created demo student     -> student@college.edu / Student@123  (roll CS2301, group CSE-3A)")
        due = (datetime.now() + timedelta(days=7)).replace(hour=23, minute=59, second=0, microsecond=0)
        conn.execute(
            """INSERT INTO assignments (title, subject, description, target_group, due_at, max_marks, status,
               allow_late, accept_submissions, created_by, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                "Welcome to DocWall - sample assignment",
                "Orientation",
                "This is a sample assignment created on first run.\n\n"
                "Teachers: edit or delete it from the Assignments page.\n"
                "Students: open it, read the instructions, attach your work and press Submit.",
                "",
                due.isoformat(timespec="minutes"),
                10,
                "published",
                1,
                1,
                1,
                ts,
                ts,
            ),
        )
    conn.commit()
    print("[seed] Please change the default passwords after the first login.")


# --------------------------------------------------------------------------- #
# Settings (stored in the database, editable by teachers; env vars give the initial values)
# --------------------------------------------------------------------------- #
SETTING_DEFAULTS = {
    "student_signup": "1" if ALLOW_STUDENT_SIGNUP else "0",
    "allowed_email_domains": ALLOWED_EMAIL_DOMAINS,
}


def get_setting(conn, key):
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else SETTING_DEFAULTS[key]


def set_setting(conn, key, value):
    conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, str(value)))


def allowed_domains(conn):
    return [d.strip().lower().lstrip("@") for d in get_setting(conn, "allowed_email_domains").split(",") if d.strip()]


def settings_payload(conn):
    return {"student_signup": get_setting(conn, "student_signup") == "1", "allowed_email_domains": allowed_domains(conn)}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def row_to_dict(row):
    return {k: row[k] for k in row.keys()} if row is not None else None


def rows(cur):
    return [row_to_dict(r) for r in cur.fetchall()]


def safe_filename(name: str) -> str:
    name = os.path.basename(name or "file").strip() or "file"
    return re.sub(r"[^\w.\- ()\[\]]", "_", name)[:180]


def store_file(data_b64: str, filename: str):
    try:
        raw = base64.b64decode(data_b64, validate=True)
    except Exception:
        raise ApiError(400, f"Attachment '{filename}' is not valid base64 data.")
    if len(raw) > MAX_BODY_BYTES:
        raise ApiError(413, f"Attachment '{filename}' is too large.")
    stored = f"{uuid.uuid4().hex}{os.path.splitext(filename)[1][:12]}"
    with open(os.path.join(UPLOAD_DIR, stored), "wb") as fh:
        fh.write(raw)
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return stored, len(raw), mime


def delete_stored(stored_name):
    try:
        os.remove(os.path.join(UPLOAD_DIR, stored_name))
    except OSError:
        pass


def is_past(due_at: str) -> bool:
    try:
        return datetime.fromisoformat(due_at) < datetime.now()
    except ValueError:
        return False


def require(body, *fields):
    missing = [f for f in fields if not str(body.get(f, "")).strip()]
    if missing:
        raise ApiError(400, "Missing required field(s): " + ", ".join(missing))


def validate_email(email):
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email or ""):
        raise ApiError(400, "Please enter a valid email address.")


def validate_password(pw):
    if len(pw or "") < 6:
        raise ApiError(400, "Password must be at least 6 characters.")


# --------------------------------------------------------------------------- #
# API handlers.  Each takes (ctx) with: conn, user, body, params, query, handler
# --------------------------------------------------------------------------- #
def public_user(u):
    return {
        "id": u["id"],
        "role": u["role"],
        "name": u["name"],
        "email": u["email"],
        "roll_no": u["roll_no"],
        "group_name": u["group_name"],
        "created_at": u["created_at"],
        "status": u["status"] if "status" in u.keys() else "active",
    }


def api_config(ctx):
    conn = ctx["conn"]
    return {"college_name": COLLEGE_NAME, "allow_student_signup": get_setting(conn, "student_signup") == "1",
            "allowed_email_domains": allowed_domains(conn), "portal": ctx["handler"].portal}


def api_login(ctx):
    body = ctx["body"]
    role = body.get("role")
    if role not in ROLES:
        raise ApiError(400, "Invalid role.")
    if role == "teacher" and ctx["handler"].portal == "student":
        raise ApiError(403, "Teacher accounts cannot sign in on the student portal.")
    identifier = (body.get("identifier") or body.get("email") or "").strip()
    password = body.get("password") or ""
    if not identifier or not password:
        raise ApiError(400, "Enter your email (or roll number) and password.")
    conn = ctx["conn"]
    user = conn.execute(
        "SELECT * FROM users WHERE role = ? AND (email = ? COLLATE NOCASE OR roll_no = ? COLLATE NOCASE)",
        (role, identifier, identifier),
    ).fetchone()
    if user is None or not verify_password(password, user["password_hash"]):
        raise ApiError(401, f"No {role} account matches those credentials.")
    if user["status"] == "pending":
        raise ApiError(403, "Your request has been sent. You can sign in once a teacher approves your account.")
    token = secrets.token_urlsafe(32)
    expires = (datetime.now() + timedelta(days=SESSION_DAYS)).isoformat()
    conn.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)", (token, user["id"], expires))
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now_iso(),))
    conn.commit()
    ctx["handler"].set_session_cookie(token)
    return {"user": public_user(user)}


def api_register(ctx):
    """Student requests an account with just an email and a password. A teacher must approve it
    (adding roll number and class) before the student can sign in."""
    conn, body = ctx["conn"], ctx["body"]
    if get_setting(conn, "student_signup") != "1":
        raise ApiError(403, "Sign-up is currently closed. Ask your teacher to create your account.")
    require(body, "email", "password")
    email = body["email"].strip().lower()
    validate_email(email)
    domains = allowed_domains(conn)
    if domains and email.rsplit("@", 1)[-1] not in domains:
        raise ApiError(400, "Please use your " + " or ".join(f"@{d}" for d in domains) + " address.")
    validate_password(body["password"])
    local = email.split("@", 1)[0]
    name = " ".join(part.capitalize() for part in re.split(r"[._\-+]+|\d+", local) if part) or local
    try:
        conn.execute(
            "INSERT INTO users (role, name, email, roll_no, group_name, password_hash, created_at, status) VALUES (?,?,?,?,?,?,?,?)",
            ("student", name, email, None, "", hash_password(body["password"]), now_iso(), "pending"),
        )
    except sqlite3.IntegrityError:
        raise ApiError(409, "An account with that email already exists.")
    conn.commit()
    return {"pending": True, "message": "Request sent. Your teacher will approve it, then you can sign in."}


def api_logout(ctx):
    token = ctx["handler"].session_token()
    if token:
        ctx["conn"].execute("DELETE FROM sessions WHERE token = ?", (token,))
        ctx["conn"].commit()
    ctx["handler"].clear_session_cookie()
    return {"ok": True}


def api_me(ctx):
    return {
        "user": public_user(ctx["user"]),
        "view_as": public_user(ctx["view_as"]) if ctx.get("view_as") is not None else None,
        "portal": ctx["handler"].portal,
    }


def api_preview_start(ctx):
    """Teacher only: open the student portal as a chosen student (read-only preview)."""
    conn, body = ctx["conn"], ctx["body"]
    try:
        sid = int(body.get("student_id"))
    except (TypeError, ValueError):
        raise ApiError(400, "Choose a student.")
    student = conn.execute("SELECT * FROM users WHERE id = ? AND role = 'student' AND status = 'active'", (sid,)).fetchone()
    if student is None:
        raise ApiError(404, "Student not found.")
    conn.execute("UPDATE sessions SET view_as = ? WHERE token = ?", (sid, ctx["handler"].session_token()))
    conn.commit()
    return {"view_as": public_user(student)}


def api_preview_stop(ctx):
    ctx["conn"].execute("UPDATE sessions SET view_as = NULL WHERE token = ?", (ctx["handler"].session_token(),))
    ctx["conn"].commit()
    return {"ok": True}


def api_change_password(ctx):
    body = ctx["body"]
    user = ctx["user"]
    if not verify_password(body.get("current_password") or "", user["password_hash"]):
        raise ApiError(400, "Current password is incorrect.")
    validate_password(body.get("new_password"))
    ctx["conn"].execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(body["new_password"]), user["id"]))
    ctx["conn"].commit()
    return {"ok": True}


# ---- files (shared) -------------------------------------------------------- #
def api_download(ctx):
    kind = ctx["params"]["kind"]
    file_id = int(ctx["params"]["id"])
    conn, user = ctx["conn"], ctx["user"]
    if kind == "assignment":
        f = conn.execute(
            "SELECT f.*, a.status, a.target_group FROM assignment_files f JOIN assignments a ON a.id = f.assignment_id WHERE f.id = ?",
            (file_id,),
        ).fetchone()
        if f is None:
            raise ApiError(404, "File not found.")
        if user["role"] == "student":
            if f["status"] != "published" or (f["target_group"] and f["target_group"] != user["group_name"]):
                raise ApiError(403, "You do not have access to this file.")
    elif kind == "submission":
        f = conn.execute(
            "SELECT f.*, s.student_id FROM submission_files f JOIN submissions s ON s.id = f.submission_id WHERE f.id = ?",
            (file_id,),
        ).fetchone()
        if f is None:
            raise ApiError(404, "File not found.")
        if user["role"] == "student" and f["student_id"] != user["id"]:
            raise ApiError(403, "You do not have access to this file.")
    else:
        raise ApiError(404, "Unknown file type.")
    path = os.path.join(UPLOAD_DIR, f["stored_name"])
    if not os.path.isfile(path):
        raise ApiError(404, "File is missing on the server.")
    inline = ctx["query"].get("inline") == "1"
    ctx["handler"].send_file(path, f["filename"], f["mime"], inline)
    return None


# ---- student --------------------------------------------------------------- #
def attach_files(conn, assignments):
    if not assignments:
        return assignments
    ids = [a["id"] for a in assignments]
    marks = ",".join("?" * len(ids))
    files = rows(conn.execute(
        f"SELECT id, assignment_id, filename, size, mime, uploaded_at FROM assignment_files WHERE assignment_id IN ({marks}) ORDER BY id",
        ids,
    ))
    by_id = {a["id"]: a for a in assignments}
    for a in assignments:
        a["files"] = []
    for f in files:
        by_id[f["assignment_id"]]["files"].append(f)
    return assignments


def student_assignment_query(user, extra_where="", extra_args=()):
    sql = """
        SELECT a.id, a.title, a.subject, a.description, a.target_group, a.due_at, a.max_marks,
               a.allow_late, a.accept_submissions, a.created_at, a.updated_at,
               s.id AS submission_id, s.text_answer, s.submitted_at, s.is_late, s.grade, s.feedback, s.graded_at
        FROM assignments a
        LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
        WHERE a.status = 'published' AND (a.target_group = '' OR a.target_group = ?)
    """ + extra_where + " ORDER BY a.due_at ASC"
    return sql, (user["id"], user["group_name"], *extra_args)


def decorate_student_assignment(conn, a):
    a["overdue"] = is_past(a["due_at"])
    if a["grade"] is not None:
        a["state"] = "graded"
    elif a["submission_id"]:
        a["state"] = "submitted"
    elif a["overdue"]:
        a["state"] = "overdue"
    else:
        a["state"] = "pending"
    a["can_submit"] = bool(a["accept_submissions"]) and a["grade"] is None and (not a["overdue"] or bool(a["allow_late"]))
    if a["submission_id"]:
        a["submission_files"] = rows(conn.execute(
            "SELECT id, filename, size, mime FROM submission_files WHERE submission_id = ? ORDER BY id", (a["submission_id"],)
        ))
    else:
        a["submission_files"] = []
    return a


def api_student_assignments(ctx):
    conn, user = ctx["conn"], ctx["user"]
    sql, args = student_assignment_query(user)
    items = attach_files(conn, rows(conn.execute(sql, args)))
    for a in items:
        decorate_student_assignment(conn, a)
    return {"assignments": items}


def api_student_assignment(ctx):
    conn, user = ctx["conn"], ctx["user"]
    sql, args = student_assignment_query(user, " AND a.id = ?", (int(ctx["params"]["id"]),))
    items = attach_files(conn, rows(conn.execute(sql, args)))
    if not items:
        raise ApiError(404, "Assignment not found.")
    return {"assignment": decorate_student_assignment(conn, items[0])}


def api_student_submit(ctx):
    if ctx.get("preview"):
        raise ApiError(403, "You are previewing the portal as a student. Submissions are disabled in preview.")
    conn, user, body = ctx["conn"], ctx["user"], ctx["body"]
    aid = int(ctx["params"]["id"])
    sql, args = student_assignment_query(user, " AND a.id = ?", (aid,))
    a = conn.execute(sql, args).fetchone()
    if a is None:
        raise ApiError(404, "Assignment not found.")
    a = decorate_student_assignment(conn, row_to_dict(a))
    if not a["can_submit"]:
        if a["grade"] is not None:
            raise ApiError(403, "This submission has already been graded and is locked.")
        if not a["accept_submissions"]:
            raise ApiError(403, "The teacher has closed submissions for this assignment.")
        raise ApiError(403, "The deadline has passed and late submissions are not allowed.")
    text = (body.get("text_answer") or "").strip()
    files = body.get("files") or []
    if not isinstance(files, list) or len(files) > 10:
        raise ApiError(400, "You can attach up to 10 files.")
    if not text and not files:
        raise ApiError(400, "Write an answer or attach at least one file.")

    old = conn.execute("SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ?", (aid, user["id"])).fetchone()
    if old:
        for f in conn.execute("SELECT stored_name FROM submission_files WHERE submission_id = ?", (old["id"],)):
            delete_stored(f["stored_name"])
        conn.execute("DELETE FROM submissions WHERE id = ?", (old["id"],))
    cur = conn.execute(
        "INSERT INTO submissions (assignment_id, student_id, text_answer, submitted_at, is_late) VALUES (?,?,?,?,?)",
        (aid, user["id"], text, now_iso(), 1 if a["overdue"] else 0),
    )
    sid = cur.lastrowid
    for f in files:
        name = safe_filename(f.get("name"))
        stored, size, mime = store_file(f.get("data") or "", name)
        conn.execute(
            "INSERT INTO submission_files (submission_id, filename, stored_name, size, mime) VALUES (?,?,?,?,?)",
            (sid, name, stored, size, mime),
        )
    conn.commit()
    return api_student_assignment(ctx)


# ---- teacher --------------------------------------------------------------- #
def teacher_assignment_rows(conn, where="", args=()):
    sql = f"""
        SELECT a.*, u.name AS created_by_name,
               (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submission_count,
               (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.grade IS NULL) AS ungraded_count,
               (SELECT COUNT(*) FROM users st WHERE st.role = 'student' AND (a.target_group = '' OR st.group_name = a.target_group)) AS student_count
        FROM assignments a LEFT JOIN users u ON u.id = a.created_by
        {where}
        ORDER BY a.status DESC, a.due_at ASC
    """
    items = attach_files(conn, rows(conn.execute(sql, args)))
    for a in items:
        a["overdue"] = is_past(a["due_at"])
    return items


def api_teacher_overview(ctx):
    conn = ctx["conn"]
    q = lambda sql, *a: conn.execute(sql, a).fetchone()[0]
    stats = {
        "assignments": q("SELECT COUNT(*) FROM assignments"),
        "published": q("SELECT COUNT(*) FROM assignments WHERE status = 'published'"),
        "students": q("SELECT COUNT(*) FROM users WHERE role = 'student' AND status = 'active'"),
        "pending_students": q("SELECT COUNT(*) FROM users WHERE role = 'student' AND status = 'pending'"),
        "teachers": q("SELECT COUNT(*) FROM users WHERE role = 'teacher'"),
        "submissions": q("SELECT COUNT(*) FROM submissions"),
        "ungraded": q("SELECT COUNT(*) FROM submissions WHERE grade IS NULL"),
    }
    recent = rows(conn.execute(
        """SELECT s.id, s.submitted_at, s.is_late, s.grade, a.id AS assignment_id, a.title, a.max_marks,
                  u.name AS student_name, u.roll_no, u.group_name
           FROM submissions s JOIN assignments a ON a.id = s.assignment_id JOIN users u ON u.id = s.student_id
           ORDER BY s.submitted_at DESC LIMIT 8"""
    ))
    upcoming = teacher_assignment_rows(conn, "WHERE a.status = 'published' AND a.due_at >= ?", (now_iso(),))[:5]
    return {"stats": stats, "recent_submissions": recent, "upcoming": upcoming}


def api_teacher_assignments(ctx):
    return {"assignments": teacher_assignment_rows(ctx["conn"])}


def api_teacher_assignment(ctx):
    items = teacher_assignment_rows(ctx["conn"], "WHERE a.id = ?", (int(ctx["params"]["id"]),))
    if not items:
        raise ApiError(404, "Assignment not found.")
    return {"assignment": items[0]}


def parse_assignment_body(body):
    require(body, "title", "due_at")
    try:
        datetime.fromisoformat(body["due_at"])
    except ValueError:
        raise ApiError(400, "Due date is not valid.")
    try:
        max_marks = float(body.get("max_marks") or 100)
    except (TypeError, ValueError):
        raise ApiError(400, "Max marks must be a number.")
    if max_marks <= 0:
        raise ApiError(400, "Max marks must be greater than zero.")
    status = body.get("status") or "draft"
    if status not in ("draft", "published"):
        raise ApiError(400, "Status must be draft or published.")
    return {
        "title": body["title"].strip()[:200],
        "subject": (body.get("subject") or "").strip()[:100],
        "description": (body.get("description") or "").strip(),
        "target_group": (body.get("target_group") or "").strip().upper()[:50],
        "due_at": body["due_at"][:16],
        "max_marks": max_marks,
        "status": status,
        "allow_late": 1 if body.get("allow_late") else 0,
        "accept_submissions": 0 if body.get("accept_submissions") is False else 1,
    }


def save_new_files(conn, assignment_id, files):
    if not isinstance(files, list) or len(files) > 10:
        raise ApiError(400, "You can attach up to 10 files per request.")
    for f in files:
        name = safe_filename(f.get("name"))
        stored, size, mime = store_file(f.get("data") or "", name)
        conn.execute(
            "INSERT INTO assignment_files (assignment_id, filename, stored_name, size, mime, uploaded_at) VALUES (?,?,?,?,?,?)",
            (assignment_id, name, stored, size, mime, now_iso()),
        )


def api_teacher_create_assignment(ctx):
    conn, body = ctx["conn"], ctx["body"]
    data = parse_assignment_body(body)
    ts = now_iso()
    cur = conn.execute(
        """INSERT INTO assignments (title, subject, description, target_group, due_at, max_marks, status, allow_late,
           accept_submissions, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (data["title"], data["subject"], data["description"], data["target_group"], data["due_at"], data["max_marks"],
         data["status"], data["allow_late"], data["accept_submissions"], ctx["user"]["id"], ts, ts),
    )
    save_new_files(conn, cur.lastrowid, body.get("files") or [])
    conn.commit()
    ctx["params"]["id"] = cur.lastrowid
    return api_teacher_assignment(ctx)


def api_teacher_update_assignment(ctx):
    conn, body = ctx["conn"], ctx["body"]
    aid = int(ctx["params"]["id"])
    existing = conn.execute("SELECT * FROM assignments WHERE id = ?", (aid,)).fetchone()
    if existing is None:
        raise ApiError(404, "Assignment not found.")
    merged = {**row_to_dict(existing), **{k: v for k, v in body.items() if k not in ("files", "remove_file_ids")}}
    if "accept_submissions" in body:
        merged["accept_submissions"] = bool(body["accept_submissions"])
    else:
        merged["accept_submissions"] = bool(existing["accept_submissions"])
    data = parse_assignment_body(merged)
    conn.execute(
        """UPDATE assignments SET title=?, subject=?, description=?, target_group=?, due_at=?, max_marks=?, status=?,
           allow_late=?, accept_submissions=?, updated_at=? WHERE id=?""",
        (data["title"], data["subject"], data["description"], data["target_group"], data["due_at"], data["max_marks"],
         data["status"], data["allow_late"], data["accept_submissions"], now_iso(), aid),
    )
    for fid in body.get("remove_file_ids") or []:
        f = conn.execute("SELECT stored_name FROM assignment_files WHERE id = ? AND assignment_id = ?", (int(fid), aid)).fetchone()
        if f:
            delete_stored(f["stored_name"])
            conn.execute("DELETE FROM assignment_files WHERE id = ?", (int(fid),))
    save_new_files(conn, aid, body.get("files") or [])
    conn.commit()
    return api_teacher_assignment(ctx)


def api_teacher_delete_assignment(ctx):
    conn = ctx["conn"]
    aid = int(ctx["params"]["id"])
    if conn.execute("SELECT 1 FROM assignments WHERE id = ?", (aid,)).fetchone() is None:
        raise ApiError(404, "Assignment not found.")
    for f in conn.execute("SELECT stored_name FROM assignment_files WHERE assignment_id = ?", (aid,)):
        delete_stored(f["stored_name"])
    for f in conn.execute(
        "SELECT sf.stored_name FROM submission_files sf JOIN submissions s ON s.id = sf.submission_id WHERE s.assignment_id = ?", (aid,)
    ):
        delete_stored(f["stored_name"])
    conn.execute("DELETE FROM assignments WHERE id = ?", (aid,))
    conn.commit()
    return {"ok": True}


def submissions_for_assignment(conn, aid):
    a = conn.execute("SELECT * FROM assignments WHERE id = ?", (aid,)).fetchone()
    if a is None:
        raise ApiError(404, "Assignment not found.")
    a = row_to_dict(a)
    students = rows(conn.execute(
        """SELECT u.id AS student_id, u.name, u.roll_no, u.email, u.group_name,
                  s.id AS submission_id, s.text_answer, s.submitted_at, s.is_late, s.grade, s.feedback, s.graded_at
           FROM users u LEFT JOIN submissions s ON s.student_id = u.id AND s.assignment_id = ?
           WHERE u.role = 'student' AND u.status = 'active' AND (? = '' OR u.group_name = ?)
           ORDER BY u.group_name, u.roll_no, u.name""",
        (aid, a["target_group"], a["target_group"]),
    ))
    sub_ids = [s["submission_id"] for s in students if s["submission_id"]]
    files_by_sub = {}
    if sub_ids:
        marks = ",".join("?" * len(sub_ids))
        for f in rows(conn.execute(f"SELECT id, submission_id, filename, size, mime FROM submission_files WHERE submission_id IN ({marks}) ORDER BY id", sub_ids)):
            files_by_sub.setdefault(f["submission_id"], []).append(f)
    for s in students:
        s["files"] = files_by_sub.get(s["submission_id"], [])
        s["state"] = "graded" if s["grade"] is not None else ("submitted" if s["submission_id"] else "missing")
    return a, students


def api_teacher_submissions(ctx):
    a, students = submissions_for_assignment(ctx["conn"], int(ctx["params"]["id"]))
    return {"assignment": a, "students": students}


def api_teacher_export(ctx):
    a, students = submissions_for_assignment(ctx["conn"], int(ctx["params"]["id"]))
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Roll No", "Name", "Group", "Email", "Status", "Submitted At", "Late", "Grade", f"Max Marks ({a['max_marks']:g})", "Feedback"])
    for s in students:
        w.writerow([s["roll_no"] or "", s["name"], s["group_name"], s["email"], s["state"], s["submitted_at"] or "",
                    "yes" if s["is_late"] else "", "" if s["grade"] is None else f"{s['grade']:g}", f"{a['max_marks']:g}", s["feedback"] or ""])
    fname = safe_filename(f"{a['title']}-marks.csv")
    ctx["handler"].send_bytes(buf.getvalue().encode("utf-8-sig"), "text/csv; charset=utf-8", fname)
    return None


def api_teacher_grade(ctx):
    conn, body = ctx["conn"], ctx["body"]
    sid = int(ctx["params"]["id"])
    s = conn.execute("SELECT s.*, a.max_marks FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.id = ?", (sid,)).fetchone()
    if s is None:
        raise ApiError(404, "Submission not found.")
    grade = body.get("grade")
    if grade in (None, ""):
        grade_val = None
    else:
        try:
            grade_val = float(grade)
        except (TypeError, ValueError):
            raise ApiError(400, "Grade must be a number.")
        if grade_val < 0 or grade_val > s["max_marks"]:
            raise ApiError(400, f"Grade must be between 0 and {s['max_marks']:g}.")
    feedback = (body.get("feedback") or "").strip()
    conn.execute(
        "UPDATE submissions SET grade = ?, feedback = ?, graded_at = ?, graded_by = ? WHERE id = ?",
        (grade_val, feedback, now_iso() if grade_val is not None else None, ctx["user"]["id"] if grade_val is not None else None, sid),
    )
    conn.commit()
    return {"ok": True}


def api_teacher_delete_submission(ctx):
    conn = ctx["conn"]
    sid = int(ctx["params"]["id"])
    for f in conn.execute("SELECT stored_name FROM submission_files WHERE submission_id = ?", (sid,)):
        delete_stored(f["stored_name"])
    conn.execute("DELETE FROM submissions WHERE id = ?", (sid,))
    conn.commit()
    return {"ok": True}


def api_teacher_users(ctx):
    role = ctx["query"].get("role", "student")
    if role not in ROLES:
        raise ApiError(400, "Invalid role.")
    conn = ctx["conn"]
    users = rows(conn.execute(
        """SELECT u.id, u.role, u.name, u.email, u.roll_no, u.group_name, u.created_at, u.status,
                  (SELECT COUNT(*) FROM submissions s WHERE s.student_id = u.id) AS submission_count
           FROM users u WHERE u.role = ? ORDER BY (u.status = 'pending') DESC, u.group_name, u.roll_no, u.name""",
        (role,),
    ))
    groups = [r[0] for r in conn.execute("SELECT DISTINCT group_name FROM users WHERE role = 'student' AND group_name <> '' ORDER BY group_name")]
    return {"users": users, "groups": groups}


def api_teacher_approve_user(ctx):
    """Approve a pending student request, filling in the details the teacher knows."""
    conn, body = ctx["conn"], ctx["body"]
    uid = int(ctx["params"]["id"])
    u = conn.execute("SELECT * FROM users WHERE id = ? AND role = 'student'", (uid,)).fetchone()
    if u is None:
        raise ApiError(404, "Student not found.")
    require(body, "name", "roll_no", "group_name")
    conn.execute("UPDATE users SET name=?, roll_no=?, group_name=?, status='active' WHERE id=?",
                 (body["name"].strip(), body["roll_no"].strip().upper(), body["group_name"].strip().upper(), uid))
    conn.commit()
    return {"user": public_user(conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone())}


def api_teacher_settings(ctx):
    return {"settings": settings_payload(ctx["conn"])}


def api_teacher_update_settings(ctx):
    conn, body = ctx["conn"], ctx["body"]
    if "student_signup" in body:
        set_setting(conn, "student_signup", "1" if body["student_signup"] else "0")
    if "allowed_email_domains" in body:
        raw = body["allowed_email_domains"]
        items = raw if isinstance(raw, list) else str(raw).split(",")
        clean = []
        for d in items:
            d = d.strip().lower().lstrip("@")
            if not d:
                continue
            if not re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", d):
                raise ApiError(400, f"'{d}' is not a valid email domain.")
            clean.append(d)
        set_setting(conn, "allowed_email_domains", ",".join(clean))
    conn.commit()
    return {"settings": settings_payload(conn)}


def api_teacher_groups(ctx):
    conn = ctx["conn"]
    groups = [r[0] for r in conn.execute(
        "SELECT DISTINCT group_name FROM users WHERE role = 'student' AND group_name <> '' "
        "UNION SELECT DISTINCT target_group FROM assignments WHERE target_group <> '' ORDER BY 1"
    )]
    return {"groups": groups}


def api_teacher_create_user(ctx):
    conn, body = ctx["conn"], ctx["body"]
    role = body.get("role")
    if role not in ROLES:
        raise ApiError(400, "Invalid role.")
    require(body, "name", "email", "password")
    if role == "student":
        require(body, "roll_no", "group_name")
    validate_email(body["email"].strip())
    validate_password(body["password"])
    try:
        cur = conn.execute(
            "INSERT INTO users (role, name, email, roll_no, group_name, password_hash, created_at) VALUES (?,?,?,?,?,?,?)",
            (role, body["name"].strip(), body["email"].strip().lower(),
             (body.get("roll_no") or "").strip().upper() or None,
             (body.get("group_name") or "").strip().upper(), hash_password(body["password"]), now_iso()),
        )
    except sqlite3.IntegrityError:
        raise ApiError(409, "An account with that email already exists.")
    conn.commit()
    return {"user": public_user(conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone())}


def api_teacher_update_user(ctx):
    conn, body = ctx["conn"], ctx["body"]
    uid = int(ctx["params"]["id"])
    u = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if u is None:
        raise ApiError(404, "User not found.")
    name = (body.get("name") or u["name"]).strip()
    email = (body.get("email") or u["email"]).strip().lower()
    validate_email(email)
    roll = (body.get("roll_no") if "roll_no" in body else u["roll_no"]) or None
    group = (body.get("group_name") if "group_name" in body else u["group_name"]) or ""
    try:
        conn.execute("UPDATE users SET name=?, email=?, roll_no=?, group_name=? WHERE id=?",
                     (name, email, roll.strip().upper() if roll else None, group.strip().upper(), uid))
    except sqlite3.IntegrityError:
        raise ApiError(409, "Another account already uses that email.")
    if body.get("new_password"):
        validate_password(body["new_password"])
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(body["new_password"]), uid))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
    conn.commit()
    return {"user": public_user(conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone())}


def api_teacher_delete_user(ctx):
    conn = ctx["conn"]
    uid = int(ctx["params"]["id"])
    if uid == ctx["user"]["id"]:
        raise ApiError(400, "You cannot delete your own account.")
    u = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if u is None:
        raise ApiError(404, "User not found.")
    if u["role"] == "teacher" and conn.execute("SELECT COUNT(*) FROM users WHERE role = 'teacher'").fetchone()[0] <= 1:
        raise ApiError(400, "At least one teacher account must remain.")
    for f in conn.execute(
        "SELECT sf.stored_name FROM submission_files sf JOIN submissions s ON s.id = sf.submission_id WHERE s.student_id = ?", (uid,)
    ):
        delete_stored(f["stored_name"])
    conn.execute("DELETE FROM users WHERE id = ?", (uid,))
    conn.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Routing table: (method, pattern, handler, required_role)
#   required_role: None = public, "any" = any logged-in user, or a specific role
# --------------------------------------------------------------------------- #
ROUTES = [
    ("GET",    r"/api/config",                                   api_config,                      None),
    ("POST",   r"/api/auth/login",                               api_login,                       None),
    ("POST",   r"/api/auth/register",                            api_register,                    None),
    ("POST",   r"/api/auth/logout",                              api_logout,                      None),
    ("GET",    r"/api/me",                                       api_me,                          "any"),
    ("POST",   r"/api/me/password",                              api_change_password,             "any"),
    ("POST",   r"/api/preview",                                  api_preview_start,               "teacher"),
    ("DELETE", r"/api/preview",                                  api_preview_stop,                "teacher"),
    ("GET",    r"/api/files/(?P<kind>assignment|submission)/(?P<id>\d+)", api_download,            "any"),

    ("GET",    r"/api/student/assignments",                      api_student_assignments,         "student"),
    ("GET",    r"/api/student/assignments/(?P<id>\d+)",          api_student_assignment,          "student"),
    ("POST",   r"/api/student/assignments/(?P<id>\d+)/submit",   api_student_submit,              "student"),

    ("GET",    r"/api/teacher/overview",                         api_teacher_overview,            "teacher"),
    ("GET",    r"/api/teacher/groups",                           api_teacher_groups,              "teacher"),
    ("GET",    r"/api/teacher/assignments",                      api_teacher_assignments,         "teacher"),
    ("POST",   r"/api/teacher/assignments",                      api_teacher_create_assignment,   "teacher"),
    ("GET",    r"/api/teacher/assignments/(?P<id>\d+)",          api_teacher_assignment,          "teacher"),
    ("PUT",    r"/api/teacher/assignments/(?P<id>\d+)",          api_teacher_update_assignment,   "teacher"),
    ("DELETE", r"/api/teacher/assignments/(?P<id>\d+)",          api_teacher_delete_assignment,   "teacher"),
    ("GET",    r"/api/teacher/assignments/(?P<id>\d+)/submissions", api_teacher_submissions,      "teacher"),
    ("GET",    r"/api/teacher/assignments/(?P<id>\d+)/export\.csv", api_teacher_export,           "teacher"),
    ("PUT",    r"/api/teacher/submissions/(?P<id>\d+)/grade",    api_teacher_grade,               "teacher"),
    ("DELETE", r"/api/teacher/submissions/(?P<id>\d+)",          api_teacher_delete_submission,   "teacher"),
    ("GET",    r"/api/teacher/users",                            api_teacher_users,               "teacher"),
    ("POST",   r"/api/teacher/users",                            api_teacher_create_user,         "teacher"),
    ("PUT",    r"/api/teacher/users/(?P<id>\d+)",                api_teacher_update_user,         "teacher"),
    ("PUT",    r"/api/teacher/users/(?P<id>\d+)/approve",        api_teacher_approve_user,        "teacher"),
    ("GET",    r"/api/teacher/settings",                         api_teacher_settings,            "teacher"),
    ("PUT",    r"/api/teacher/settings",                         api_teacher_update_settings,     "teacher"),
    ("DELETE", r"/api/teacher/users/(?P<id>\d+)",                api_teacher_delete_user,         "teacher"),
]
COMPILED_ROUTES = [(m, re.compile("^" + p + "$"), h, r) for m, p, h, r in ROUTES]

# Clean URLs for the front-end pages
PAGES = {
    "/": "index.html",
    "/student": "student/index.html",
    "/student/": "student/index.html",
    "/student/login": "student/login.html",
    "/teacher": "teacher/index.html",
    "/teacher/": "teacher/index.html",
    "/teacher/login": "teacher/login.html",
}


class DocWallHandler(BaseHTTPRequestHandler):
    server_version = "DocWall/1.0"
    protocol_version = "HTTP/1.1"

    @property
    def portal(self):
        """'student', 'teacher' or 'both' - which portal this listening socket serves."""
        return getattr(self.server, "portal", "both")

    # ---- logging ---------------------------------------------------------- #
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt % args))

    # ---- cookies ---------------------------------------------------------- #
    def session_token(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookie.get(COOKIE_NAME)
        return morsel.value if morsel else None

    def set_session_cookie(self, token):
        attrs = f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_DAYS * 86400}"
        if SECURE_COOKIE:
            attrs += "; Secure"
        self._extra_headers.append(("Set-Cookie", attrs))

    def clear_session_cookie(self):
        self._extra_headers.append(("Set-Cookie", f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"))

    # ---- responses -------------------------------------------------------- #
    def _send(self, status, body: bytes, content_type: str, extra=()):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        for k, v in list(extra) + self._extra_headers:
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        self._sent = True

    def redirect(self, target):
        self._send(HTTPStatus.FOUND, b"", "text/plain", [("Location", target), ("Cache-Control", "no-store")])

    def send_json(self, status, obj):
        self._send(status, json.dumps(obj).encode(), "application/json; charset=utf-8", [("Cache-Control", "no-store")])

    def send_bytes(self, data: bytes, content_type: str, filename: str, inline=False):
        disp = "inline" if inline else "attachment"
        self._send(HTTPStatus.OK, data, content_type, [
            ("Content-Disposition", f"{disp}; filename*=UTF-8''{quote(filename)}"),
            ("Cache-Control", "private, no-store"),
        ])

    def send_file(self, path, filename, mime, inline=False):
        with open(path, "rb") as fh:
            data = fh.read()
        if inline and mime.startswith(("text/html", "image/svg")):
            mime = "text/plain"  # never render uploaded HTML/SVG inline
        self.send_bytes(data, mime, filename, inline)

    # ---- request body ----------------------------------------------------- #
    def read_json_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES * 1.4 + 1024:  # base64 overhead
            raise ApiError(413, f"Request too large. Max upload is {MAX_BODY_BYTES // (1024 * 1024)} MB.")
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        ctype = self.headers.get("Content-Type", "")
        if "application/json" not in ctype:
            raise ApiError(415, "Expected application/json.")
        try:
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ApiError(400, "Request body is not valid JSON.")
        if not isinstance(body, dict):
            raise ApiError(400, "Request body must be a JSON object.")
        return body

    # ---- dispatch --------------------------------------------------------- #
    def do_GET(self):
        self.dispatch("GET")

    def do_HEAD(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def dispatch(self, method):
        self._extra_headers = []
        self._sent = False
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path.startswith("/api/"):
            self.handle_api(method, path, parsed.query)
        elif method == "GET":
            self.serve_static(path)
        else:
            self._send(HTTPStatus.METHOD_NOT_ALLOWED, b"Method not allowed", "text/plain")

    def handle_api(self, method, path, query_string):
        conn = None
        try:
            if self.portal == "student" and path.startswith("/api/teacher/"):
                raise ApiError(404, "Unknown API endpoint.")
            for route_method, pattern, handler, required_role in COMPILED_ROUTES:
                m = pattern.match(path)
                if not m:
                    continue
                if route_method != method:
                    continue
                conn = db()
                user = None
                view_as = None   # student a teacher is previewing as, if any
                preview = False  # True when this request runs *as* that student
                token = self.session_token()
                if token:
                    user = conn.execute(
                        "SELECT u.*, s.view_as AS _view_as FROM sessions s JOIN users u ON u.id = s.user_id "
                        "WHERE s.token = ? AND s.expires_at > ?",
                        (token, now_iso()),
                    ).fetchone()
                    if user is not None and user["role"] == "teacher" and user["_view_as"] is not None:
                        view_as = conn.execute("SELECT * FROM users WHERE id = ? AND role = 'student'", (user["_view_as"],)).fetchone()
                if required_role is not None:
                    if user is None:
                        raise ApiError(401, "Please log in.")
                    if required_role == "student" and user["role"] == "teacher" and view_as is not None:
                        user, preview = view_as, True   # teacher looking through a student's eyes
                    elif required_role != "any" and user["role"] != required_role:
                        raise ApiError(403, f"This action requires a {required_role} account.")
                body = self.read_json_body() if method in ("POST", "PUT") else {}
                query = {k: v[0] for k, v in parse_qs(query_string).items()}
                ctx = {"conn": conn, "user": user, "view_as": view_as, "preview": preview, "body": body,
                       "params": m.groupdict(), "query": query, "handler": self}
                result = handler(ctx)
                if not self._sent:
                    self.send_json(HTTPStatus.OK, result if result is not None else {"ok": True})
                return
            # path matched nothing (or wrong method)
            if any(p.match(path) for _, p, _, _ in COMPILED_ROUTES):
                raise ApiError(405, "Method not allowed.")
            raise ApiError(404, "Unknown API endpoint.")
        except ApiError as e:
            if not self._sent:
                self.send_json(e.status, {"error": e.message})
        except Exception as e:  # pragma: no cover - defensive
            self.log_message("Unhandled error: %r", e)
            if not self._sent:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Internal server error."})
        finally:
            if conn is not None:
                conn.close()

    def serve_static(self, path):
        portal = self.portal
        if path == "/" and portal != "both":
            self.redirect(f"/{portal}")
            return
        if portal == "student" and (path.startswith("/teacher") or path in ("/js/teacher.js", "/index.html")):
            self._send(HTTPStatus.NOT_FOUND, b"<h1>404 - Not found</h1><p><a href='/'>Back to DocWall</a></p>", "text/html; charset=utf-8")
            return
        rel = PAGES.get(path)
        if rel is None:
            rel = path.lstrip("/")
            if not os.path.splitext(rel)[1]:
                rel = rel + ".html"
        full = os.path.normpath(os.path.join(PUBLIC_DIR, rel))
        if not full.startswith(PUBLIC_DIR + os.sep) or not os.path.isfile(full):
            self._send(HTTPStatus.NOT_FOUND, b"<h1>404 - Not found</h1><p><a href='/'>Back to DocWall</a></p>", "text/html; charset=utf-8")
            return
        mime = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if mime.startswith("text/") or mime in ("application/javascript", "application/json"):
            mime += "; charset=utf-8"
        with open(full, "rb") as fh:
            data = fh.read()
        self._send(HTTPStatus.OK, data, mime, [("Cache-Control", "no-cache")])


class PortalServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, portal):
        self.portal = portal
        super().__init__(addr, DocWallHandler)


def main():
    init_db()
    shown_host = "localhost" if HOST in ("0.0.0.0", "::", "") else HOST
    try:
        if STUDENT_PORT == TEACHER_PORT:
            servers = [PortalServer((HOST, STUDENT_PORT), "both")]
        else:
            servers = [PortalServer((HOST, STUDENT_PORT), "student"), PortalServer((HOST, TEACHER_PORT), "teacher")]
    except OSError as e:
        sys.exit(f"Could not open a port ({e}). Is another DocWall already running? "
                 f"Change DOCWALL_STUDENT_PORT / DOCWALL_TEACHER_PORT if needed.")
    if STUDENT_PORT == TEACHER_PORT:
        print(f"DocWall (combined portal) running on http://{shown_host}:{STUDENT_PORT}  (data dir: {DATA_DIR})")
        print(f"  Student login : http://{shown_host}:{STUDENT_PORT}/student/login")
        print(f"  Teacher login : http://{shown_host}:{STUDENT_PORT}/teacher/login")
    else:
        print(f"DocWall running (data dir: {DATA_DIR})")
        print(f"  Student portal : http://{shown_host}:{STUDENT_PORT}   (students only; no teacher login here)")
        print(f"  Teacher portal : http://{shown_host}:{TEACHER_PORT}   (teacher login, student login, student preview)")
    threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in servers]
    for t in threads:
        t.start()
    try:
        while any(t.is_alive() for t in threads):
            for t in threads:
                t.join(0.5)
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        for s in servers:
            s.shutdown()
            s.server_close()


if __name__ == "__main__":
    main()
