<#
.SYNOPSIS
    Steam Manifest Downloader - Non‑interactive mode for Project Nova.
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$AppId,
    [string]$Mode = "github",
    [string]$MorrenusApiKey = "",
    [string]$ManifestHubApiKey = ""
)

# Set console encoding to UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-ProgressMsg {
    param([string]$Message)
    Write-Host "[PROGRESS] $Message"
}

function Write-ErrorMsg {
    param([string]$Message)
    Write-Host "[ERROR] $Message"
}

function Write-SuccessMsg {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message"
}

function Get-SteamPath {
    $registryPaths = @(
        "HKLM:\SOFTWARE\WOW6432Node\Valve\Steam",
        "HKLM:\SOFTWARE\Valve\Steam",
        "HKCU:\SOFTWARE\Valve\Steam"
    )
    foreach ($path in $registryPaths) {
        try {
            $steamPath = (Get-ItemProperty -Path $path -ErrorAction SilentlyContinue).InstallPath
            if ($steamPath -and (Test-Path $steamPath)) {
                return $steamPath
            }
        } catch {}
    }
    return $null
}

function Get-DepotIdsFromLua {
    param([string]$LuaPath)
    $depots = @()
    $content = Get-Content -Path $LuaPath -ErrorAction Stop
    foreach ($line in $content) {
        if ($line -match 'addappid\s*\(\s*(\d+)\s*,\s*\d+\s*,\s*"[a-fA-F0-9]+"') {
            $depots += $matches[1]
        }
    }
    return $depots | Select-Object -Unique
}

function Get-AppInfo {
    param([string]$AppId)
    $url = "https://api.steamcmd.net/v1/info/$AppId"
    try {
        $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 30
        return $response
    } catch {
        return $null
    }
}

function Get-ManifestIdForDepot {
    param([object]$AppInfo, [string]$AppId, [string]$DepotId)
    try {
        $depots = $AppInfo.data.$AppId.depots
        if ($depots.$DepotId -and $depots.$DepotId.manifests -and $depots.$DepotId.manifests.public) {
            return $depots.$DepotId.manifests.public.gid
        }
    } catch {}
    return $null
}

function Download-Manifest {
    param([string]$DepotId, [string]$ManifestId, [string]$OutputPath, [string]$Mode, [string]$ApiKey)
    $outputFile = Join-Path $OutputPath "${DepotId}_${ManifestId}.manifest"
    $githubUrl = "https://raw.githubusercontent.com/qwe213312/k25FCdfEOoEJ42S6/main/${DepotId}_${ManifestId}.manifest"
    Write-ProgressMsg "Downloading $DepotId from GitHub..."
    try {
        Invoke-WebRequest -Uri $githubUrl -Method Get -TimeoutSec 120 -OutFile $outputFile -ErrorAction Stop
        if ((Get-Item $outputFile).Length -gt 0) {
            Write-ProgressMsg "Success from GitHub"
            return $true
        }
    } catch {
        if ($_.Exception.Response.StatusCode -eq 404 -and $Mode -ne "github") {
            Write-ProgressMsg "Not on GitHub, trying secondary API..."
            if ($Mode -eq "github+morrenus") {
                $secondaryUrl = "https://manifest.morrenus.xyz/api/v1/generate/manifest?depot_id=${DepotId}&manifest_id=${ManifestId}&api_key=${ApiKey}"
            } else {
                $secondaryUrl = "https://api.manifesthub1.filegear-sg.me/manifest?apikey=${ApiKey}&depotid=${DepotId}&manifestid=${ManifestId}"
            }
            try {
                Invoke-WebRequest -Uri $secondaryUrl -Method Get -TimeoutSec 120 -OutFile $outputFile -ErrorAction Stop
                if ((Get-Item $outputFile).Length -gt 0) {
                    Write-ProgressMsg "Success from secondary API"
                    return $true
                }
            } catch {
                Write-ErrorMsg "Secondary API failed: $($_.Exception.Message)"
                return $false
            }
        } else {
            Write-ErrorMsg "GitHub download failed: $($_.Exception.Message)"
            return $false
        }
    }
    return $false
}

# ==================== MAIN ====================
try {
    Write-ProgressMsg "Starting manifest updater for AppID $AppId, Mode=$Mode"

    $steamPath = Get-SteamPath
    if (-not $steamPath) {
        Write-ErrorMsg "Could not find Steam installation"
        exit 1
    }
    Write-ProgressMsg "Steam found at $steamPath"

    $luaPath = Join-Path $steamPath "config\stplug-in\$AppId.lua"
    if (-not (Test-Path $luaPath)) {
        Write-ErrorMsg "Lua file not found at $luaPath"
        exit 1
    }
    Write-ProgressMsg "Lua file found"

    $depotIds = Get-DepotIdsFromLua -LuaPath $luaPath
    if ($depotIds.Count -eq 0) {
        Write-ErrorMsg "No depot IDs found in Lua file"
        exit 1
    }
    Write-ProgressMsg "Found $($depotIds.Count) depot(s): $($depotIds -join ', ')"

    $appInfo = Get-AppInfo -AppId $AppId
    if (-not $appInfo -or $appInfo.status -ne "success") {
        Write-ErrorMsg "Failed to fetch app info from SteamCMD API"
        exit 1
    }
    Write-ProgressMsg "App info retrieved"

    $depotCachePath = Join-Path $steamPath "depotcache"
    if (-not (Test-Path $depotCachePath)) {
        New-Item -ItemType Directory -Path $depotCachePath -Force | Out-Null
    }

    $successCount = 0
    foreach ($depotId in $depotIds) {
        $manifestId = Get-ManifestIdForDepot -AppInfo $appInfo -AppId $AppId -DepotId $depotId
        if (-not $manifestId) {
            Write-ErrorMsg "No manifest ID found for depot $depotId"
            continue
        }
        Write-ProgressMsg "Processing depot $depotId (manifest $manifestId)"
        if (Download-Manifest -DepotId $depotId -ManifestId $manifestId -OutputPath $depotCachePath -Mode $Mode -ApiKey ($MorrenusApiKey + $ManifestHubApiKey)) {
            $successCount++
        } else {
            Write-ErrorMsg "Failed to download manifest for depot $depotId"
        }
    }

    if ($successCount -eq $depotIds.Count) {
        Write-SuccessMsg "All manifests downloaded successfully"
        exit 0
    } else {
        Write-ErrorMsg "Only $successCount of $($depotIds.Count) manifests downloaded"
        exit 1
    }
} catch {
    Write-ErrorMsg "Unexpected error: $($_.Exception.Message)"
    exit 1
}