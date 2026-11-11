# Install-DocVault.ps1 - one-click DocVault installer for Windows.
#
# Run by Install-DocVault.bat (which fetches this file from GitHub). It:
#   1. checks for Python 3.10+ and installs Python silently if it is missing,
#   2. downloads the latest DocVault code from GitHub into %LOCALAPPDATA%\DocVault
#      (keeping the data folder of an earlier install),
#   3. puts a "DocVault" shortcut on the desktop,
#   4. starts the server and opens the teacher portal in the browser.
# Nothing here needs administrator rights.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo   = 'docvault779-ops/docwall'
$ZipUrl = "https://github.com/$Repo/archive/refs/heads/main.zip"
$PyVer  = '3.12.10'
$PyUrl  = "https://www.python.org/ftp/python/$PyVer/python-$PyVer-amd64.exe"
$Dest   = Join-Path $env:LOCALAPPDATA 'DocVault'
$Tmp    = Join-Path $env:TEMP ('docvault-' + [guid]::NewGuid().ToString('N'))

function Say($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

function Find-Python {
    # Returns @{Exe=...; Args=...} for a working Python 3.10+, or $null.
    # The Microsoft Store "python.exe" stub fails the version check, so it is skipped.
    $candidates = @(
        @{ Exe = 'py';      Args = @('-3') },
        @{ Exe = 'python';  Args = @() },
        @{ Exe = 'python3'; Args = @() }
    )
    foreach ($c in $candidates) {
        if (-not (Get-Command $c.Exe -ErrorAction SilentlyContinue)) { continue }
        try {
            $allArgs = @($c.Args) + @('-c', "import sys; print('%d.%d' % sys.version_info[:2])")
            $out = & $c.Exe @allArgs 2>$null
            if ($LASTEXITCODE -eq 0 -and "$out" -match '^(\d+)\.(\d+)$') {
                $major = [int]$Matches[1]; $minor = [int]$Matches[2]
                if ($major -gt 3 -or ($major -eq 3 -and $minor -ge 10)) { return $c }
            }
        } catch { }
    }
    return $null
}

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Install-Python {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Say "Installing Python with winget (this takes a minute or two)..."
        try {
            & winget install --id Python.Python.3.12 --exact --silent `
                --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
        } catch { }
        Refresh-Path
        if (Find-Python) { return }
    }
    Say "Downloading Python $PyVer from python.org (about 25 MB)..."
    $installer = Join-Path $Tmp 'python-installer.exe'
    Invoke-WebRequest -Uri $PyUrl -OutFile $installer -UseBasicParsing
    Say "Installing Python for the current user (no window will appear)..."
    $p = Start-Process -FilePath $installer -Wait -PassThru -ArgumentList `
        '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=1', 'Include_test=0'
    if ($p.ExitCode -ne 0) { throw "The Python installer failed (exit code $($p.ExitCode))." }
    Refresh-Path
    if (-not (Find-Python)) {
        throw "Python was installed but cannot be found yet. Log out and in again, then run the installer once more."
    }
}

try {
    New-Item -ItemType Directory -Path $Tmp -Force | Out-Null

    # 1. Python
    $py = Find-Python
    if ($py) {
        Say "Python 3 is already installed."
    } else {
        Say "Python 3 was not found - installing it."
        Install-Python
        $py = Find-Python
        Say "Python is ready."
    }

    # 2. DocVault code
    Say "Downloading DocVault from GitHub..."
    $zip = Join-Path $Tmp 'docwall.zip'
    Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $Tmp -Force
    $src = Get-ChildItem -Path $Tmp -Directory | Where-Object { $_.Name -like 'docwall-*' } | Select-Object -First 1
    if (-not $src) { throw "The downloaded archive did not contain the DocVault folder." }

    if (Test-Path $Dest) {
        Say "Updating the existing install in $Dest (assignments and accounts are kept)."
        Get-ChildItem -Path $Dest -Force | Where-Object { $_.Name -ne 'data' } | Remove-Item -Recurse -Force
    } else {
        Say "Installing into $Dest"
        New-Item -ItemType Directory -Path $Dest -Force | Out-Null
    }
    Get-ChildItem -Path $src.FullName -Force | Copy-Item -Destination $Dest -Recurse -Force

    # 3. Desktop shortcut
    $shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DocVault.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($shortcut)
    $lnk.TargetPath = Join-Path $Dest 'Start DocVault.bat'
    $lnk.WorkingDirectory = $Dest
    $lnk.Description = 'Start the DocVault portals'
    $lnk.IconLocation = '%SystemRoot%\System32\shell32.dll,21'
    $lnk.Save()
    Say "Added a DocVault shortcut to the desktop."

    # 4. Start it
    Say "Starting DocVault..."
    Start-Process -FilePath (Join-Path $Dest 'Start DocVault.bat') -WorkingDirectory $Dest
    Start-Sleep -Seconds 3
    Start-Process 'http://localhost:8081'

    Write-Host ""
    Write-Host "DocVault is installed and running." -ForegroundColor Green
    Write-Host "  Teacher portal : http://localhost:8081"
    Write-Host "  Student portal : http://localhost:8080"
    Write-Host "  Teacher access code : DV-TEACHER-2026  (change it under Settings)"
    Write-Host ""
    Write-Host "If Windows asks whether to allow Python through the firewall, click Allow."
    Write-Host "Next time, double-click the DocVault icon on the desktop to start it."
}
catch {
    Write-Host ""
    Write-Host "Installation failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "You can still install by hand: https://github.com/$Repo (see the README)."
    exit 1
}
finally {
    Remove-Item -Path $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
