@echo off
title DocVault installer
echo This installs DocVault on this computer:
echo   - checks for Python 3 and installs it silently if it is missing
echo   - downloads DocVault from GitHub
echo   - puts a DocVault shortcut on the desktop and starts the portals
echo No administrator password is needed. Please wait ...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; Invoke-Expression (Invoke-RestMethod 'https://raw.githubusercontent.com/docvault779-ops/docwall/main/install/Install-DocVault.ps1')"
echo.
pause
