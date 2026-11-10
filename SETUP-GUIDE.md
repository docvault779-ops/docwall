# DocVault – Setup Guide for Tanav

DocVault is our college assignment portal. Students see and submit assignments on one site,
teachers manage everything on another. The code lives in a private GitHub repository:

    https://github.com/docvault779-ops/docwall

This guide has three parts. Do them in order.

---

## Part 1 – Join the GitHub repository (one time, on your phone or laptop)

The invitation was sent to your GitHub account **Tanavram**. GitHub only lets you accept it once
your email address is verified, which is why the link showed a 404 error.

1. Open a browser (Chrome or Safari, not the GitHub app) and go to https://github.com/login.
   Sign in as **Tanavram**.
2. Go to https://github.com/settings/emails.
3. If your email says **Unverified**, tap **Resend verification email**. Open that email and tap
   **Verify email address**. Check the spam folder if it does not arrive in a minute.
4. In the same browser, open https://github.com/docvault779-ops/docwall/invitations and tap
   **Accept invitation**.
5. Done. The repository now shows in the GitHub app under Repositories.

If step 4 still shows 404, make sure the avatar in the top-right corner of the page is Tanavram
and not another account, then try again.

---

## Part 2 – Get the code and run it on your laptop

You need two programs: **Git** and **Python 3** (version 3.10 or newer). Nothing else.

* Windows: install Git from https://git-scm.com and Python from https://www.python.org/downloads
  (tick "Add Python to PATH" during install).
* Mac: Python 3 and Git are usually already there. Check with `python3 --version` and
  `git --version` in Terminal.
* Linux: `sudo apt install git python3`.

Then open a terminal (Command Prompt / PowerShell on Windows, Terminal on Mac) and run:

    git clone https://github.com/docvault779-ops/docwall.git
    cd docwall
    python3 server.py

(On Windows the last line is `py server.py`.) Git asks for your GitHub username and a
**personal access token** instead of a password the first time. Create one at
https://github.com/settings/tokens → Generate new token (classic) → tick `repo` → copy it.

The server prints two addresses:

    Student portal : http://localhost:8080
    Teacher portal : http://localhost:8081

Open the teacher one, sign in with the default teacher account printed in the terminal (also
listed in README.md), change its password under **Profile**, and look around. The portal starts
empty: create an assignment, then open **Student view** to see it the way a student would.

Stop the server with Ctrl+C.

---

## Part 3 – Deploy on the college server

Ask the IT department for: SSH access to a Linux server, whether you have `sudo`, that
`python3 --version` is 3.10 or newer, and two hostnames (or an IP) for the student and teacher
portals. Then:

1. Copy the code to the server:

       sudo git clone https://github.com/docvault779-ops/docwall.git /opt/docwall

2. Create the data folder (this is the only thing that needs backing up):

       sudo mkdir -p /var/lib/docwall && sudo chown www-data:www-data /var/lib/docwall

3. Open `/opt/docwall/deploy/docwall.service` and change the two `DOCWALL_ADMIN_*` lines to the
   HOD's or your email and a strong password. Then install and start it:

       sudo cp /opt/docwall/deploy/docwall.service /etc/systemd/system/
       sudo systemctl daemon-reload
       sudo systemctl enable --now docwall
       sudo systemctl status docwall

   Students can now use `http://<server-ip>:8080`, teachers `http://<server-ip>:8081`.

4. Optional, recommended: give each portal a proper address with Nginx. Edit the two
   `server_name` lines in `/opt/docwall/deploy/nginx-docwall.conf`, then:

       sudo cp /opt/docwall/deploy/nginx-docwall.conf /etc/nginx/sites-available/docwall
       sudo ln -s /etc/nginx/sites-available/docwall /etc/nginx/sites-enabled/
       sudo nginx -t && sudo systemctl reload nginx

   For HTTPS run `sudo certbot --nginx` and set `DOCWALL_SECURE_COOKIE=1` in the service file.

5. First login: open the teacher address, sign in with the admin account, change the password,
   set the accepted email domain under **Settings**, and share the student address with students.

Updating later, after either of us pushes a change:

    cd /opt/docwall && sudo git pull && sudo systemctl restart docwall

No sudo? Run `python3 server.py` inside `tmux` or `screen` with `DOCWALL_DATA` pointing to a
folder you own. Windows server? Install Python and run `py server.py`.

---

## How people join DocVault

* **Students**: open the student portal → **Request a student account** → enter a Gmail address,
  their student ID / roll number and a password. A teacher approves the request (checking the
  ID and adding the name and class). Until then the
  student cannot sign in.
* **Teachers**: open the teacher portal → **Request teacher access** → enter a Gmail address and a
  password. An existing teacher approves it under **Teachers**.
* While a teacher is signed in, new requests pop up as an invite card with an **Approve** button.
* Teachers can close sign-ups or change the accepted email domain under **Settings**.

Full details, every setting and the API are in `README.md` in the repository.
