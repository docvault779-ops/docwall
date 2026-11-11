@echo off
title DocVault server
cd /d "%~dp0"
echo Starting DocVault ... keep this window open while the portals are in use.
echo.
py -3 -c "import sys" >nul 2>nul && (py -3 server.py & goto end)
python -c "import sys" >nul 2>nul && (python server.py & goto end)
echo Python 3 was not found on this computer.
echo Install it from https://www.python.org/downloads and tick
echo "Add python.exe to PATH" during the install, then open this file again.
:end
echo.
pause
