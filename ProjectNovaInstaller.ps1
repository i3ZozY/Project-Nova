# Project Nova Installer
# Installs SteamTools, Millennium, and the Project Nova plugin.
# Fully silent when -Silent is used. Now with better error handling and progress.

param(
    [string]$DownloadLink,   # Override plugin download URL (direct .zip)
    [string]$PluginName,     # Override plugin folder name (default: projectnova)
    [switch]$Silent          # Run without any interactive prompts or countdowns
)

# ========================== Configuration ==========================
$script:PluginName       = if ($PluginName) { $PluginName } else { "projectnova" }
$script:PluginZipUrl     = if ($DownloadLink) { $DownloadLink } else { "https://github.com/i3ZozY/Project-Nova/releases/download/0.9/projectnova.zip" }
$script:SteamToolsUrl    = "https://luatools.vercel.app/st.ps1"
$script:MillenniumUrl    = "https://clemdotla.github.io/millennium-installer-ps1/millennium.ps1"
$script:CountdownSeconds = 5

# ========================== Helper Functions ==========================
function Write-Log {
    param(
        [ValidateSet('OK','INFO','ERR','WARN','LOG','AUX')]
        [string]$Type,
        [string]$Message,
        [switch]$NoNewline
    )

    if ($Silent -and $Type -eq "LOG") { return }

    $colors = @{
        'OK'   = 'Green'
        'INFO' = 'Cyan'
        'ERR'  = 'Red'
        'WARN' = 'Yellow'
        'LOG'  = 'Magenta'
        'AUX'  = 'DarkGray'
    }
    $fg = $colors[$Type]
    $timestamp = Get-Date -Format "HH:mm:ss"

    if ($NoNewline) {
        Write-Host "`r[$timestamp] " -ForegroundColor Cyan -NoNewline
    } else {
        Write-Host "[$timestamp] " -ForegroundColor Cyan -NoNewline
    }
    Write-Host "[$Type] $Message" -ForegroundColor $fg
}

function Get-SteamPath {
    $paths = @(
        (Get-ItemProperty "HKCU:\Software\Valve\Steam" -ErrorAction SilentlyContinue).SteamPath,
        (Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Valve\Steam" -ErrorAction SilentlyContinue).InstallPath,
        (Get-ItemProperty "HKLM:\SOFTWARE\Valve\Steam" -ErrorAction SilentlyContinue).InstallPath
    )
    foreach ($p in $paths) {
        if ($p -and (Test-Path $p)) {
            return (Resolve-Path $p).Path
        }
    }
    return $null
}

function Test-SteamToolsInstalled {
    param([string]$SteamPath)
    $files = @("dwmapi.dll", "xinput1_4.dll")
    foreach ($f in $files) {
        if (-not (Test-Path (Join-Path $SteamPath $f))) {
            return $false
        }
    }
    return $true
}

function Test-MillenniumInstalled {
    param([string]$SteamPath)
    $files = @("millennium.dll", "python311.dll")
    foreach ($f in $files) {
        if (-not (Test-Path (Join-Path $SteamPath $f))) {
            return $false
        }
    }
    return $true
}

function Stop-SteamProcess {
    $steamProc = Get-Process steam -ErrorAction SilentlyContinue
    if ($steamProc) {
        Write-Log "INFO" "Stopping Steam..."
        $steamProc | Stop-Process -Force
        Start-Sleep -Seconds 3
        # Ensure it's fully gone
        $retries = 0
        while ((Get-Process steam -ErrorAction SilentlyContinue) -and $retries -lt 5) {
            Start-Sleep -Seconds 1
            $retries++
        }
    }
}

function Invoke-Download {
    param(
        [string]$Url,
        [string]$OutFile,
        [string]$Description = "file"
    )
    try {
        Write-Log "LOG" "Downloading $Description from $Url"
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 60
        if (-not (Test-Path $OutFile) -or (Get-Item $OutFile).Length -eq 0) {
            throw "Downloaded file is empty"
        }
        return $true
    } catch {
        Write-Log "ERR" "Failed to download $Description : $_"
        return $false
    }
}

function Install-SteamTools {
    Write-Log "INFO" "Installing SteamTools..."
    $tempScript = Join-Path $env:TEMP "steamtools_install.ps1"
    if (-not (Invoke-Download -Url $SteamToolsUrl -OutFile $tempScript -Description "SteamTools installer")) {
        return $false
    }

    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        Write-Log "LOG" "SteamTools installation attempt $attempt of $maxAttempts"
        try {
            $psArgs = @("-ExecutionPolicy", "Bypass", "-File", $tempScript)
            if ($Silent) {
                & powershell.exe @psArgs *> $null
            } else {
                & powershell.exe @psArgs
            }
            Start-Sleep -Seconds 2
            Stop-SteamProcess   # Ensure Steam isn't running after installer

            if (Test-SteamToolsInstalled -SteamPath $steamPath) {
                Write-Log "OK" "SteamTools installed successfully"
                Remove-Item $tempScript -Force -ErrorAction SilentlyContinue
                return $true
            }
        } catch {
            Write-Log "WARN" "Attempt $attempt failed: $_"
        }
        Start-Sleep -Seconds 3
    }
    Remove-Item $tempScript -Force -ErrorAction SilentlyContinue
    Write-Log "ERR" "SteamTools installation failed after $maxAttempts attempts"
    return $false
}

function Install-Millennium {
    param([string]$SteamPath)
    Write-Log "INFO" "Installing Millennium..."
    $tempScript = Join-Path $env:TEMP "millennium_install.ps1"
    if (-not (Invoke-Download -Url $MillenniumUrl -OutFile $tempScript -Description "Millennium installer")) {
        return $false
    }

    try {
        $millArgs = @(
            "-ExecutionPolicy", "Bypass",
            "-File", $tempScript,
            "-NoLog",
            "-DontStart",
            "-SteamPath", $SteamPath
        )
        if ($Silent) {
            & powershell.exe @millArgs *> $null
        } else {
            & powershell.exe @millArgs
        }
        Start-Sleep -Seconds 2

        if (Test-MillenniumInstalled -SteamPath $SteamPath) {
            Write-Log "OK" "Millennium installed successfully"
            return $true
        } else {
            throw "Millennium files missing after installation"
        }
    } catch {
        Write-Log "ERR" "Millennium installation failed: $_"
        return $false
    } finally {
        Remove-Item $tempScript -Force -ErrorAction SilentlyContinue
    }
}

function Install-Plugin {
    param(
        [string]$SteamPath,
        [string]$PluginName,
        [string]$ZipUrl
    )

    $pluginsFolder = Join-Path $SteamPath "plugins"
    if (-not (Test-Path $pluginsFolder)) {
        New-Item -Path $pluginsFolder -ItemType Directory -Force | Out-Null
    }

    # Find existing plugin directory by plugin.json name
    $existingPluginDir = $null
    foreach ($dir in Get-ChildItem -Path $pluginsFolder -Directory) {
        $jsonPath = Join-Path $dir.FullName "plugin.json"
        if (Test-Path $jsonPath) {
            try {
                $json = Get-Content $jsonPath -Raw | ConvertFrom-Json
                if ($json.name -eq $PluginName) {
                    $existingPluginDir = $dir.FullName
                    break
                }
            } catch { }
        }
    }

    $pluginDir = if ($existingPluginDir) { $existingPluginDir } else { Join-Path $pluginsFolder $PluginName }

    # Remove old installation
    if (Test-Path $pluginDir) {
        Write-Log "LOG" "Removing previous installation of $PluginName"
        Remove-Item -Path $pluginDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    # Download plugin ZIP
    $tempZip = Join-Path $env:TEMP "$PluginName.zip"
    if (-not (Invoke-Download -Url $ZipUrl -OutFile $tempZip -Description "$PluginName plugin")) {
        return $false
    }

    # Validate ZIP contains plugin.json
    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($tempZip)
        $hasPluginJson = $false
        foreach ($entry in $zip.Entries) {
            if ($entry.Name -eq "plugin.json") {
                $hasPluginJson = $true
                break
            }
        }
        $zip.Dispose()
        if (-not $hasPluginJson) {
            throw "Downloaded ZIP does not contain plugin.json"
        }
    } catch {
        Write-Log "ERR" "Invalid plugin ZIP: $_"
        Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
        return $false
    }

    # Extract
    Write-Log "LOG" "Extracting $PluginName to $pluginDir"
    try {
        Expand-Archive -Path $tempZip -DestinationPath $pluginDir -Force
    } catch {
        Write-Log "WARN" "Expand-Archive failed, trying .NET extraction"
        $zip = [System.IO.Compression.ZipFile]::OpenRead($tempZip)
        foreach ($entry in $zip.Entries) {
            $dest = Join-Path $pluginDir $entry.FullName
            if ($entry.FullName -notmatch '/$') {
                $parent = Split-Path $dest -Parent
                if ($parent -and -not (Test-Path $parent)) {
                    New-Item -Path $parent -ItemType Directory -Force | Out-Null
                }
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
            }
        }
        $zip.Dispose()
    }
    Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
    Write-Log "OK" "$PluginName installed"
    return $true
}

function Enable-PluginInMillennium {
    param(
        [string]$SteamPath,
        [string]$PluginName
    )
    $configPath = Join-Path $SteamPath "ext\config.json"
    $configDir = Split-Path $configPath -Parent
    if (-not (Test-Path $configDir)) {
        New-Item -Path $configDir -ItemType Directory -Force | Out-Null
    }

    $config = @{}
    if (Test-Path $configPath) {
        try {
            $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        } catch {
            Write-Log "WARN" "Could not parse existing config.json, creating new one"
            $config = @{}
        }
    }

    if (-not $config.general) {
        $config | Add-Member -MemberType NoteProperty -Name general -Value @{ checkForMillenniumUpdates = $false } -Force
    } else {
        $config.general | Add-Member -MemberType NoteProperty -Name checkForMillenniumUpdates -Value $false -Force
    }

    if (-not $config.plugins) {
        $config | Add-Member -MemberType NoteProperty -Name plugins -Value @{ enabledPlugins = @() } -Force
    }
    if (-not $config.plugins.enabledPlugins) {
        $config.plugins.enabledPlugins = @()
    }
    if ($config.plugins.enabledPlugins -notcontains $PluginName) {
        $config.plugins.enabledPlugins += $PluginName
    }

    $config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
    Write-Log "OK" "Plugin enabled in Millennium configuration"
}

function Clear-SteamBetaAndCfg {
    param([string]$SteamPath)
    $betaPath = Join-Path $SteamPath "package\beta"
    if (Test-Path $betaPath) {
        Remove-Item $betaPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    $cfgPath = Join-Path $SteamPath "steam.cfg"
    if (Test-Path $cfgPath) {
        Remove-Item $cfgPath -Force -ErrorAction SilentlyContinue
    }
    Remove-ItemProperty -Path "HKCU:\Software\Valve\Steam" -Name "SteamCmdForceX86" -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path "HKLM:\SOFTWARE\Valve\Steam" -Name "SteamCmdForceX86" -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Valve\Steam" -Name "SteamCmdForceX86" -ErrorAction SilentlyContinue
}

# ========================== Main Execution ==========================
# Require admin rights
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "This script must be run as Administrator. Please right-click and select 'Run as Administrator'." -ForegroundColor Red
    exit 1
}

$Host.UI.RawUI.WindowTitle = "Project Nova Installer"
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { chcp 65001 > $null } catch { }
Add-Type -AssemblyName System.IO.Compression.FileSystem

Write-Log "INFO" "Project Nova Installer (Enhanced)"
Write-Log "INFO" "Plugin: $PluginName | Version: 0.9"

# Detect Steam
$steamPath = Get-SteamPath
if (-not $steamPath) {
    Write-Log "ERR" "Could not locate Steam installation. Is Steam installed?"
    exit 1
}
Write-Log "INFO" "Steam found at: $steamPath"

# Stop Steam
Stop-SteamProcess

# ---------------------------------------------------------------------
# SteamTools
# ---------------------------------------------------------------------
if (Test-SteamToolsInstalled -SteamPath $steamPath) {
    Write-Log "INFO" "SteamTools already installed"
} else {
    Write-Log "WARN" "SteamTools not found."
    if (-not $Silent) {
        Write-Host "Press any key to install SteamTools, or close the window to cancel." -ForegroundColor Yellow
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    }
    if (-not (Install-SteamTools)) {
        Write-Log "ERR" "SteamTools installation failed. Cannot continue."
        exit 1
    }
}

# ---------------------------------------------------------------------
# Millennium
# ---------------------------------------------------------------------
if (Test-MillenniumInstalled -SteamPath $steamPath) {
    Write-Log "INFO" "Millennium already installed"
} else {
    Write-Log "WARN" "Millennium not found."
    if (-not $Silent) {
        Write-Host "Millennium will be installed in $CountdownSeconds seconds. Press any key to cancel." -ForegroundColor Yellow
        $timeout = $CountdownSeconds
        while ($timeout -gt 0) {
            if ([Console]::KeyAvailable) {
                $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
                Write-Log "ERR" "Installation cancelled by user."
                exit 1
            }
            Write-Log "LOG" "Installing Millennium in $timeout second(s)... Press any key to cancel." -NoNewline
            Start-Sleep -Seconds 1
            $timeout--
        }
        Write-Host ""
    }
    if (-not (Install-Millennium -SteamPath $steamPath)) {
        Write-Log "ERR" "Millennium installation failed. Cannot continue."
        exit 1
    }
}

# ---------------------------------------------------------------------
# Project Nova Plugin
# ---------------------------------------------------------------------
if (-not (Install-Plugin -SteamPath $steamPath -PluginName $PluginName -ZipUrl $PluginZipUrl)) {
    Write-Log "ERR" "Plugin installation failed."
    exit 1
}

# Enable plugin in Millennium config
Enable-PluginInMillennium -SteamPath $steamPath -PluginName $PluginName

# Cleanup beta/cfg
Clear-SteamBetaAndCfg -SteamPath $steamPath

Write-Host ""
Write-Log "WARN" "Steam may take longer to start the first time. Please be patient."
Write-Log "INFO" "Starting Steam..."
Start-Process (Join-Path $steamPath "steam.exe") -ArgumentList "-clearbeta"

Write-Log "OK" "Setup complete! Enjoy Project Nova!"
