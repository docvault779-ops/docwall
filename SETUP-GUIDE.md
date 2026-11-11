# DocVault – Setup Guide for Tanav

DocVault is our college assignment portal. Students see and submit assignments on one site,
teachers manage everything on another. The code lives in a public GitHub repository, so no
GitHub account or invitation is needed to use it:

    https://github.com/docvault779-ops/docwall

This guide has three parts. Do them in order.

---

## Part 1 – Get the code (one time)

Open https://github.com/docvault779-ops/docwall in any browser.

* **Easiest:** click the green **Code** button, then **Download ZIP**, and unzip it. You get a
  `docwall` folder containing `server.py`, `Start DocVault.bat` and the `public` folder.
* **With Git** (lets you pull updates later): `git clone https://github.com/docvault779-ops/docwall.git`

---

## Part 2 – Run it on your laptop

**Windows (one click, no Part 1 needed):** download
[Install-DocVault.bat](https://github.com/docvault779-ops/docwall/releases/latest/download/Install-DocVault.bat) and double-click it.
A black window shows the progress: it checks for Python 3 and installs it silently if missing,
downloads DocVault, puts a **DocVault** icon on the desktop and opens the teacher portal.

* If a blue "Windows protected your PC" box appears, click **More info**, then **Run anyway**.
  It appears because the file was downloaded from the internet, not because anything is wrong.
* If Windows asks whether to allow Python through the firewall, click **Allow**, otherwise
  other laptops cannot reach the portals.
* From then on, double-click the **DocVault** icon on the desktop to start it. A black window
  stays open while the portals run; close it to stop.
* Run the installer again any time to update to the latest code. Assignments and accounts are kept.

**Mac / Linux:** you need Python 3.10 or newer (Mac: usually already there, check with
`python3 --version`; Linux: `sudo apt install python3`). Then open Terminal and run:

    cd docwall
    python3 server.py

The server prints two addresses:

    Student portal : http://localhost:8080
    Teacher portal : http://localhost:8081

The terminal also prints the **teacher access code**, which is `DV-TEACHER-2026` on a fresh
install. Open the teacher portal, choose **Create a teacher account**, enter your email, that code
and a password, and you are in. Change the code under **Settings** before students hear of it. The portal starts empty: create an assignment, then open **Student view** to see
it the way a student would.

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

3. Optionally open `/opt/docwall/deploy/docwall.service` and set `DOCWALL_TEACHER_CODE` to a
   code of your choice (otherwise the default `DV-TEACHER-2026` is used). Then install and start it:

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

5. First login: open the teacher address, choose **Create a teacher account** and use the
   teacher access code (`DV-TEACHER-2026` unless you changed it in the service file; it is also
   printed by `sudo journalctl -u docwall | grep "access code"`). Then change the code and set the
   accepted email domain under **Settings**, share the new code with the other teachers, and share
   the student address with students.

Updating later, after either of us pushes a change:

    cd /opt/docwall && sudo git pull && sudo systemctl restart docwall

No sudo? Run `python3 server.py` inside `tmux` or `screen` with `DOCWALL_DATA` pointing to a
folder you own. Windows server? Install Python and double-click `Start DocVault.bat`.

---

## How people join DocVault

* **Students**: open the student portal → **Request a student account** → enter a Gmail address,
  their student ID / roll number and a password. A teacher approves the request (checking the
  ID and adding the name and class). Until then the
  student cannot sign in.
* **Teachers**: open the teacher portal → **Create a teacher account** → enter a Gmail address,
  the teacher access code and a password. The account works immediately; nobody approves it.
* While a teacher is signed in, new student requests pop up as an invite card with an **Approve** button.
* Teachers can see or change the access code, close sign-ups or change the accepted email
  domain under **Settings**.

Full details, every setting and the API are in `README.md` in the repository.
