"""
Steam Manifest Downloader for Project Nova (Pure Python)
Exactly replicates the working PowerShell script.
"""

import os
import re
import sys
import json
import time
import tempfile
import shutil
from typing import Optional, Set, Dict, Any, List, Tuple

# Ensure stdout is unbuffered for real‑time frontend polling
sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, "reconfigure") else None

# Import shared HTTP client
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http_client import ensure_http_client
from logger import logger

# ------------------------------------------------------------
# Output helpers – exactly like PowerShell prefixed messages
# ------------------------------------------------------------
def progress(msg: str):
    print(f"[PROGRESS] {msg}", flush=True)
    logger.log(f"[PROGRESS] {msg}")

def success(msg: str):
    print(f"[SUCCESS] {msg}", flush=True)
    logger.log(f"[SUCCESS] {msg}")

def error(msg: str):
    print(f"[ERROR] {msg}", flush=True)
    logger.error(f"[ERROR] {msg}")

def warning(msg: str):
    print(f"[WARNING] {msg}", flush=True)
    logger.warn(f"[WARNING] {msg}")


# ------------------------------------------------------------
# 1. Locate Steam installation (Windows registry)
# ------------------------------------------------------------
def get_steam_path() -> Optional[str]:
    import winreg
    reg_paths = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam", "InstallPath"),
        (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath"),
    ]
    for hkey, path, value in reg_paths:
        try:
            with winreg.OpenKey(hkey, path) as key:
                steam_path, _ = winreg.QueryValueEx(key, value)
                if steam_path and os.path.exists(steam_path):
                    return steam_path
        except Exception:
            continue
    return None


# ------------------------------------------------------------
# 2. Extract depot IDs from .lua file (matching PS regex exactly)
# ------------------------------------------------------------
def extract_depot_ids_from_lua(lua_path: str) -> List[str]:
    """
    Parses the Lua file line by line, skipping comments.
    Matches: addappid( FIRST_NUMBER , ... )
    Captures the FIRST numeric parameter (which in practice is the depot ID).
    This exactly replicates the working PowerShell regex.
    """
    depot_ids = []
    if not os.path.exists(lua_path):
        return depot_ids
    with open(lua_path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            # Skip commented lines
            if line.lstrip().startswith('--'):
                continue
            # PowerShell regex: 'addappid\s*\(\s*(\d+)\s*,\s*\d+\s*,\s*"[a-fA-F0-9]+"'
            match = re.search(r'addappid\s*\(\s*(\d+)\s*,\s*\d+\s*,\s*"[a-fA-F0-9]+"', line)
            if match:
                depot_ids.append(match.group(1))
    # Return unique depot IDs, preserving order of first appearance
    seen = set()
    unique = []
    for d in depot_ids:
        if d not in seen:
            seen.add(d)
            unique.append(d)
    return unique


# ------------------------------------------------------------
# 3. Fetch app info from SteamCMD API
# ------------------------------------------------------------
def get_app_info(appid: str) -> Optional[Dict[str, Any]]:
    client = ensure_http_client("ManifestUpdater")
    url = f"https://api.steamcmd.net/v1/info/{appid}"
    try:
        resp = client.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "success":
            warning(f"SteamCMD API returned status: {data.get('status')}")
            return None
        return data
    except Exception as e:
        error(f"Failed to fetch app info: {e}")
        return None


def get_manifest_id_for_depot(app_info: Dict[str, Any], appid: str, depot_id: str) -> Optional[str]:
    """Extract public manifest ID for a depot."""
    try:
        depots = app_info["data"][appid]["depots"]
        if depot_id in depots and "manifests" in depots[depot_id]:
            public = depots[depot_id]["manifests"].get("public")
            if public:
                return str(public.get("gid"))
    except Exception:
        pass
    return None


# ------------------------------------------------------------
# 4. Download manifest from sources (GitHub → optional API)
# ------------------------------------------------------------
def download_manifest(depot_id: str, manifest_id: str, output_dir: str,
                      mode: str, morrenus_key: str = "", manifesthub_key: str = "") -> bool:
    output_file = os.path.join(output_dir, f"{depot_id}_{manifest_id}.manifest")
    github_url = f"https://raw.githubusercontent.com/qwe213312/k25FCdfEOoEJ42S6/main/{depot_id}_{manifest_id}.manifest"

    progress(f"Downloading depot {depot_id} from GitHub...")
    client = ensure_http_client("ManifestUpdater")
    try:
        resp = client.get(github_url, timeout=120, follow_redirects=True)
        resp.raise_for_status()
        with open(output_file, 'wb') as f:
            f.write(resp.content)
        if os.path.getsize(output_file) > 0:
            progress("Success from GitHub")
            return True
    except Exception as e:
        if hasattr(e, 'response') and e.response is not None and e.response.status_code == 404:
            warning(f"Manifest not found on GitHub (404)")
        else:
            warning(f"GitHub download failed: {e}")

    # Try secondary API if mode allows
    if mode == "github+morrenus" and morrenus_key:
        progress("Not on GitHub, trying Morrenus API...")
        url = f"https://manifest.morrenus.xyz/api/v1/generate/manifest?depot_id={depot_id}&manifest_id={manifest_id}&api_key={morrenus_key}"
        try:
            resp = client.get(url, timeout=120, follow_redirects=True)
            resp.raise_for_status()
            with open(output_file, 'wb') as f:
                f.write(resp.content)
            if os.path.getsize(output_file) > 0:
                progress("Success from Morrenus")
                return True
        except Exception as e:
            warning(f"Morrenus API failed: {e}")

    if mode == "github+manifesthub" and manifesthub_key:
        progress("Not on GitHub, trying ManifestHub API...")
        url = f"https://api.manifesthub1.filegear-sg.me/manifest?apikey={manifesthub_key}&depotid={depot_id}&manifestid={manifest_id}"
        try:
            resp = client.get(url, timeout=120, follow_redirects=True)
            resp.raise_for_status()
            with open(output_file, 'wb') as f:
                f.write(resp.content)
            if os.path.getsize(output_file) > 0:
                progress("Success from ManifestHub")
                return True
        except Exception as e:
            warning(f"ManifestHub API failed: {e}")

    error(f"Failed to download manifest for depot {depot_id} from all sources")
    return False


# ------------------------------------------------------------
# 5. Main entry point – exactly like PowerShell script
# ------------------------------------------------------------
def run_manifest_update(appid: str, mode: str = "github",
                        morrenus_key: str = "", manifesthub_key: str = "") -> dict:
    try:
        progress(f"Starting manifest updater for AppID {appid}, Mode={mode}")

        steam_path = get_steam_path()
        if not steam_path:
            error("Could not find Steam installation")
            return {"success": False, "error": "Could not locate Steam installation."}
        progress(f"Steam found at {steam_path}")

        lua_path = os.path.join(steam_path, "config", "stplug-in", f"{appid}.lua")
        if not os.path.exists(lua_path):
            error(f"Lua file not found at {lua_path}")
            return {"success": False, "error": f"No Lua file found for AppID {appid}."}
        progress("Lua file found")

        depot_ids = extract_depot_ids_from_lua(lua_path)
        if not depot_ids:
            error("No depot IDs found in Lua file")
            return {"success": False, "error": "No depot IDs found in Lua file."}
        progress(f"Found {len(depot_ids)} depot(s): {', '.join(depot_ids)}")

        app_info = get_app_info(appid)
        if not app_info:
            error("Failed to fetch app info from SteamCMD API")
            return {"success": False, "error": "Could not retrieve game information from SteamCMD API."}
        progress("App info retrieved")

        depot_cache = os.path.join(steam_path, "depotcache")
        os.makedirs(depot_cache, exist_ok=True)

        success_count = 0
        failed_count = 0
        skipped_count = 0

        for depot_id in depot_ids:
            manifest_id = get_manifest_id_for_depot(app_info, appid, depot_id)
            if not manifest_id:
                warning(f"No manifest ID found for depot {depot_id} (skipping)")
                skipped_count += 1
                continue

            progress(f"Processing depot {depot_id} (manifest {manifest_id})")
            if download_manifest(depot_id, manifest_id, depot_cache, mode, morrenus_key, manifesthub_key):
                success_count += 1
            else:
                failed_count += 1
                error(f"Failed to download manifest for depot {depot_id}")

        if failed_count > 0:
            error(f"Failed to download {failed_count} manifest(s). ({success_count} succeeded, {skipped_count} skipped)")
            return {"success": False, "error": f"Failed to download {failed_count} manifest(s)."}
        elif success_count > 0:
            success(f"Successfully downloaded {success_count} manifest(s). ({skipped_count} skipped)")
            return {"success": True, "message": f"Successfully downloaded {success_count} manifest(s)."}
        else:
            success(f"No manifest updates were required (all {skipped_count} depots skipped).")
            return {"success": True, "message": "No manifest updates were required."}

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        error(f"Unexpected error: {e}\n{tb}")
        logger.error(f"Manifest updater crashed: {e}\n{tb}")
        return {"success": False, "error": str(e)}