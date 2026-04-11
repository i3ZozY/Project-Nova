"""Handling of Project Nova add/download flows and related utilities."""

from __future__ import annotations

import base64
import json
import os
import re
import threading
import time
import datetime
from typing import Any, Dict

import Millennium  # type: ignore

from api_manifest import load_api_manifest
from settings.manager import get_morrenus_api_key
from config import (
    APPID_LOG_FILE,
    LOADED_APPS_FILE,
    USER_AGENT,
    WEBKIT_DIR_NAME,
    WEB_UI_ICON_FILE,
    WEB_UI_JS_FILE,
)
from http_client import ensure_http_client
import httpx  # type: ignore
from logger import logger
from paths import backend_path, public_path
from steam_utils import detect_steam_install_path, has_lua_for_app
from utils import count_apis, ensure_temp_download_dir, normalize_manifest_text, read_text, write_text
from state_utils import set_download_state, get_download_state

# Cache for app names to avoid repeated API calls
APP_NAME_CACHE: Dict[int, str] = {}
APP_NAME_CACHE_LOCK = threading.Lock()

# Rate limiting for Steam API calls
LAST_API_CALL_TIME = 0
API_CALL_MIN_INTERVAL = 0.3  # 300ms between calls to avoid 429 errors

# In-memory applist for fallback app name lookup
APPLIST_DATA: Dict[int, str] = {}
APPLIST_LOADED = False
APPLIST_LOCK = threading.Lock()
APPLIST_FILE_NAME = "all-appids.json"
APPLIST_URL = "https://applist.morrenus.xyz/"
APPLIST_DOWNLOAD_TIMEOUT = 300  # 5 minutes for large file

GAMES_DB_FILE_NAME = "games.json"
GAMES_DB_URL = "https://toolsdb.piqseu.cc/games.json"

# In-memory games database cache and lock
GAMES_DB_DATA: Dict[int, Any] = {}
GAMES_DB_LOADED = False
GAMES_DB_LOCK = threading.Lock()


def _loaded_apps_path() -> str:
    return backend_path(LOADED_APPS_FILE)


def _appid_log_path() -> str:
    return backend_path(APPID_LOG_FILE)


def _fetch_app_name(appid: int) -> str:
    """Fetch app name with rate limiting and caching."""
    global LAST_API_CALL_TIME

    with APP_NAME_CACHE_LOCK:
        if appid in APP_NAME_CACHE:
            cached = APP_NAME_CACHE[appid]
            if cached:
                return cached

    # Check applist file before making web requests
    applist_name = _get_app_name_from_applist(appid)
    if applist_name:
        with APP_NAME_CACHE_LOCK:
            APP_NAME_CACHE[appid] = applist_name
        return applist_name

    # Steam API as final resort (web request)
    with APP_NAME_CACHE_LOCK:
        time_since_last_call = time.time() - LAST_API_CALL_TIME
        sleep_time = API_CALL_MIN_INTERVAL - time_since_last_call if time_since_last_call < API_CALL_MIN_INTERVAL else 0
        LAST_API_CALL_TIME = time.time() + sleep_time

    if sleep_time > 0:
        time.sleep(sleep_time)

    client = ensure_http_client("Project Nova: _fetch_app_name")
    try:
        url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
        logger.log(f"Project Nova: Fetching app name for {appid} from Steam API")
        resp = client.get(url, follow_redirects=True, timeout=10)
        logger.log(f"Project Nova: Steam API response for {appid}: status={resp.status_code}")
        resp.raise_for_status()
        data = resp.json()
        entry = data.get(str(appid)) or {}
        if isinstance(entry, dict):
            inner = entry.get("data") or {}
            name = inner.get("name")
            if isinstance(name, str) and name.strip():
                name = name.strip()
                with APP_NAME_CACHE_LOCK:
                    APP_NAME_CACHE[appid] = name
                return name
    except Exception as exc:
        logger.warn(f"Project Nova: _fetch_app_name failed for {appid}: {exc}")

    with APP_NAME_CACHE_LOCK:
        APP_NAME_CACHE[appid] = ""
    return ""


def _append_loaded_app(appid: int, name: str) -> None:
    try:
        path = _loaded_apps_path()
        lines = []
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                lines = handle.read().splitlines()
        prefix = f"{appid}:"
        lines = [line for line in lines if not line.startswith(prefix)]
        lines.append(f"{appid}:{name}")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
    except Exception as exc:
        logger.warn(f"Project Nova: _append_loaded_app failed for {appid}: {exc}")


def _remove_loaded_app(appid: int) -> None:
    try:
        path = _loaded_apps_path()
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as handle:
            lines = handle.read().splitlines()
        prefix = f"{appid}:"
        new_lines = [line for line in lines if not line.startswith(prefix)]
        if len(new_lines) != len(lines):
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("\n".join(new_lines) + ("\n" if new_lines else ""))
    except Exception as exc:
        logger.warn(f"Project Nova: _remove_loaded_app failed for {appid}: {exc}")


def _log_appid_event(action: str, appid: int, name: str) -> None:
    try:
        stamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
        line = f"[{action}] {appid} - {name} - {stamp}\n"
        with open(_appid_log_path(), "a", encoding="utf-8") as handle:
            handle.write(line)
    except Exception as exc:
        logger.warn(f"Project Nova: _log_appid_event failed: {exc}")


def _preload_app_names_cache() -> None:
    """Pre-load all app names from loaded_apps, appidlogs, and applist files into memory cache."""
    # Load from appidlogs.txt
    try:
        log_path = _appid_log_path()
        if os.path.exists(log_path):
            with open(log_path, "r", encoding="utf-8") as handle:
                for line in handle.read().splitlines():
                    if "]" in line and " - " in line:
                        try:
                            parts = line.split("]", 1)
                            if len(parts) < 2:
                                continue
                            content = parts[1].strip()
                            content_parts = content.split(" - ", 2)
                            if len(content_parts) >= 2:
                                appid_str = content_parts[0].strip()
                                name = content_parts[1].strip()
                                appid = int(appid_str)
                                if name and not name.startswith("Unknown") and not name.startswith("UNKNOWN"):
                                    with APP_NAME_CACHE_LOCK:
                                        APP_NAME_CACHE[appid] = name
                        except (ValueError, IndexError):
                            continue
    except Exception as exc:
        logger.warn(f"Project Nova: _preload_app_names_cache from logs failed: {exc}")

    # Load from loaded_apps.txt
    try:
        path = _loaded_apps_path()
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                for line in handle.read().splitlines():
                    if ":" in line:
                        parts = line.split(":", 1)
                        try:
                            appid = int(parts[0].strip())
                            name = parts[1].strip()
                            if name:
                                with APP_NAME_CACHE_LOCK:
                                    APP_NAME_CACHE[appid] = name
                        except (ValueError, IndexError):
                            continue
    except Exception as exc:
        logger.warn(f"Project Nova: _preload_app_names_cache from loaded_apps failed: {exc}")

    # Load applist into memory
    try:
        _load_applist_into_memory()
    except Exception as exc:
        logger.warn(f"Project Nova: _preload_app_names_cache from applist failed: {exc}")


def _get_loaded_app_name(appid: int) -> str:
    """Get app name from loadedappids.txt, with applist as fallback."""
    try:
        path = _loaded_apps_path()
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                for line in handle.read().splitlines():
                    if line.startswith(f"{appid}:"):
                        name = line.split(":", 1)[1].strip()
                        if name:
                            return name
    except Exception:
        pass
    return _get_app_name_from_applist(appid)


def _applist_file_path() -> str:
    temp_dir = ensure_temp_download_dir()
    return os.path.join(temp_dir, APPLIST_FILE_NAME)


def _load_applist_into_memory() -> None:
    global APPLIST_DATA, APPLIST_LOADED
    with APPLIST_LOCK:
        if APPLIST_LOADED:
            return
        file_path = _applist_file_path()
        if not os.path.exists(file_path):
            logger.log("Project Nova: Applist file not found, skipping load")
            APPLIST_LOADED = True
            return
        try:
            logger.log("Project Nova: Loading applist into memory...")
            with open(file_path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, list):
                count = 0
                for entry in data:
                    if isinstance(entry, dict):
                        appid = entry.get("appid")
                        name = entry.get("name")
                        if appid and name and isinstance(name, str) and name.strip():
                            APPLIST_DATA[int(appid)] = name.strip()
                            count += 1
                logger.log(f"Project Nova: Loaded {count} app names from applist into memory")
            else:
                logger.warn("Project Nova: Applist file has invalid format (expected array)")
            APPLIST_LOADED = True
        except Exception as exc:
            logger.warn(f"Project Nova: Failed to load applist into memory: {exc}")
            APPLIST_LOADED = True


def _get_app_name_from_applist(appid: int) -> str:
    if not APPLIST_LOADED:
        _load_applist_into_memory()
    with APPLIST_LOCK:
        return APPLIST_DATA.get(int(appid), "")


def _ensure_applist_file() -> None:
    file_path = _applist_file_path()
    if os.path.exists(file_path):
        logger.log("Project Nova: Applist file already exists, skipping download")
        return
    logger.log("Project Nova: Applist file not found, downloading...")
    client = ensure_http_client("Project Nova: DownloadApplist")
    try:
        logger.log(f"Project Nova: Downloading applist from {APPLIST_URL}")
        resp = client.get(APPLIST_URL, follow_redirects=True, timeout=APPLIST_DOWNLOAD_TIMEOUT)
        logger.log(f"Project Nova: Applist download response: status={resp.status_code}")
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, list):
            logger.warn("Project Nova: Downloaded applist has invalid format (expected array)")
            return
        with open(file_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        logger.log(f"Project Nova: Successfully downloaded and saved applist file ({len(data)} entries)")
    except Exception as exc:
        logger.warn(f"Project Nova: Failed to download applist file: {exc}")


def init_applist() -> None:
    try:
        _ensure_applist_file()
        _load_applist_into_memory()
    except Exception as exc:
        logger.warn(f"Project Nova: Applist initialization failed: {exc}")


def _games_db_file_path() -> str:
    temp_dir = ensure_temp_download_dir()
    return os.path.join(temp_dir, GAMES_DB_FILE_NAME)


def _load_games_db_into_memory() -> None:
    global GAMES_DB_DATA, GAMES_DB_LOADED
    with GAMES_DB_LOCK:
        if GAMES_DB_LOADED:
            return
        file_path = _games_db_file_path()
        if not os.path.exists(file_path):
            logger.log("Project Nova: Games DB file not found, skipping load")
            GAMES_DB_LOADED = True
            return
        try:
            logger.log("Project Nova: Loading Games DB into memory...")
            with open(file_path, "r", encoding="utf-8") as handle:
                GAMES_DB_DATA = json.load(handle)
            logger.log(f"Project Nova: Loaded Games DB ({len(GAMES_DB_DATA)} entries)")
            GAMES_DB_LOADED = True
        except Exception as exc:
            logger.warn(f"Project Nova: Failed to load Games DB: {exc}")
            GAMES_DB_LOADED = True


GAMES_DB_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60  # 24 hours


def _is_games_db_cache_stale() -> bool:
    file_path = _games_db_file_path()
    if not os.path.exists(file_path):
        return True
    try:
        file_mtime = os.path.getmtime(file_path)
        age_seconds = time.time() - file_mtime
        return age_seconds > GAMES_DB_CACHE_MAX_AGE_SECONDS
    except Exception:
        return True


def _ensure_games_db_file() -> None:
    file_path = _games_db_file_path()
    if os.path.exists(file_path) and not _is_games_db_cache_stale():
        logger.log("Project Nova: Games DB cache is fresh, skipping download")
        return
    logger.log("Project Nova: Downloading Games DB (cache missing or stale)...")
    client = ensure_http_client("Project Nova: DownloadGamesDB")
    try:
        logger.log(f"Project Nova: Downloading Games DB from {GAMES_DB_URL}")
        resp = client.get(GAMES_DB_URL, follow_redirects=True, timeout=60)
        logger.log(f"Project Nova: Games DB download response: status={resp.status_code}")
        resp.raise_for_status()
        data = resp.json()
        with open(file_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        logger.log(f"Project Nova: Successfully downloaded Games DB")
    except Exception as exc:
        logger.warn(f"Project Nova: Failed to download Games DB: {exc}")


def init_games_db() -> None:
    try:
        _ensure_games_db_file()
        _load_games_db_into_memory()
    except Exception as exc:
        logger.warn(f"Project Nova: Games DB initialization failed: {exc}")


def get_games_database() -> str:
    if not GAMES_DB_LOADED:
        init_games_db()
    with GAMES_DB_LOCK:
        return json.dumps(GAMES_DB_DATA)


def fetch_app_name(appid: int) -> str:
    return _fetch_app_name(appid)


def _process_and_install_lua(appid: int, zip_path: str) -> None:
    """Process downloaded zip and install lua file into stplug-in directory."""
    import zipfile
    import json
    import re

    if _is_download_cancelled(appid):
        raise RuntimeError("cancelled")

    base_path = detect_steam_install_path() or Millennium.steam_path()
    target_dir = os.path.join(base_path or "", "config", "stplug-in")
    os.makedirs(target_dir, exist_ok=True)

    with zipfile.ZipFile(zip_path, "r") as archive:
        names = archive.namelist()

        # Extract .manifest files into depotcache
        try:
            depotcache_dir = os.path.join(base_path or "", "depotcache")
            os.makedirs(depotcache_dir, exist_ok=True)
            for name in names:
                try:
                    if _is_download_cancelled(appid):
                        raise RuntimeError("cancelled")
                    if name.lower().endswith(".manifest"):
                        pure = os.path.basename(name)
                        data = archive.read(name)
                        out_path = os.path.join(depotcache_dir, pure)
                        with open(out_path, "wb") as manifest_file:
                            manifest_file.write(data)
                        logger.log(f"Project Nova: Extracted manifest -> {out_path}")
                except Exception as manifest_exc:
                    logger.warn(f"Project Nova: Failed to extract manifest {name}: {manifest_exc}")
        except Exception as depot_exc:
            logger.warn(f"Project Nova: depotcache extraction failed: {depot_exc}")

        # Find the numeric .lua file inside the zip
        candidates = []
        for name in names:
            pure = os.path.basename(name)
            if re.fullmatch(r"\d+\.lua", pure):
                candidates.append(name)

        if _is_download_cancelled(appid):
            raise RuntimeError("cancelled")

        chosen = None
        preferred = f"{appid}.lua"
        for name in candidates:
            if os.path.basename(name) == preferred:
                chosen = name
                break
        if chosen is None and candidates:
            chosen = candidates[0]
        if not chosen:
            raise RuntimeError("No numeric .lua file found in zip")

        data = archive.read(chosen)
        try:
            text = data.decode("utf-8")
        except Exception:
            text = data.decode("utf-8", errors="replace")

        # ===== NEW: Parse addappid lines to collect depot info =====
        depots = {"ids": [], "lines": {}}
        processed_lines = []
        for line in text.splitlines(True):
            # Comment out setManifestid lines
            if re.match(r"^\s*setManifestid\(", line) and not re.match(r"^\s*--", line):
                line = re.sub(r"^(\s*)", r"\1--", line)
            processed_lines.append(line)

            # Extract depot IDs from addappid calls
            if re.match(r"^\s*addappid\(", line) and not re.match(r"^\s*--", line):
                match = re.search(r"addappid\s*\(\s*(\d+)", line)
                if match:
                    depot_id = match.group(1)
                    depots["ids"].append(depot_id)
                    if depot_id not in depots["lines"]:
                        depots["lines"][depot_id] = []
                    depots["lines"][depot_id].append(line)

        processed_text = "".join(processed_lines)

        set_download_state(appid, {"status": "installing"})
        dest_file = os.path.join(target_dir, f"{appid}.lua")
        if _is_download_cancelled(appid):
            raise RuntimeError("cancelled")
        with open(dest_file, "w", encoding="utf-8") as output:
            output.write(processed_text)
        logger.log(f"Project Nova: Installed lua -> {dest_file}")
        set_download_state(appid, {"installedPath": dest_file})

        # ===== NEW: Content Check (Workshop & DLC) =====
        try:
            if _is_download_cancelled(appid):
                raise RuntimeError("cancelled")

            # Fetch app info from SteamCMD API
            client = ensure_http_client("Project Nova: content check")
            url = f"https://api.steamcmd.net/v1/info/{appid}"
            resp = client.get(url, follow_redirects=True, timeout=10)
            resp.raise_for_status()
            info_data = resp.json()
            root = info_data.get("data", {}).get(str(appid), {})

            # Workshop check
            workshop_depot = str(root.get("depots", {}).get("workshopdepot", "0"))
            if workshop_depot == "0":
                workshop_result = "No workshop for the game"
            else:
                # Check if workshop depot appears in addappid lines AND includes a decryption key
                if workshop_depot in depots["ids"]:
                    # Look for a decryption key pattern in the corresponding lines
                    has_key = False
                    for line in depots["lines"].get(workshop_depot, []):
                        # Decryption key is typically a quoted string after two numbers
                        if re.search(r",\s*\d+\s*,\s*\"[a-fA-F0-9]+\"", line):
                            has_key = True
                            break
                    workshop_result = "Included" if has_key else "Missing"
                else:
                    workshop_result = "Missing"

            # DLC check
            dlc_list_str = root.get("extended", {}).get("listofdlc", "")
            dlc_result = {"included": [], "missing": []}
            if dlc_list_str:
                dlc_ids = dlc_list_str.split(",")
                for dlc_id in dlc_ids:
                    dlc_id = dlc_id.strip()
                    if dlc_id in depots["ids"]:
                        dlc_result["included"].append(int(dlc_id))
                    else:
                        dlc_result["missing"].append(int(dlc_id))

            set_download_state(appid, {
                "status": "done",
                "contentCheckResult": {
                    "workshop": workshop_result,
                    "dlc": dlc_result
                }
            })
            logger.log(f"Project Nova: Content check completed for {appid}: workshop={workshop_result}, dlc included={len(dlc_result['included'])} missing={len(dlc_result['missing'])}")

        except Exception as exc:
            logger.error(f"Project Nova: Content check failed for {appid}: {exc}")
            # Still mark as done, but without content check results
            set_download_state(appid, {"status": "done"})

    # Clean up the downloaded zip
    try:
        os.remove(zip_path)
    except Exception:
        try:
            for _ in range(3):
                time.sleep(0.2)
                try:
                    os.remove(zip_path)
                    break
                except Exception:
                    continue
        except Exception:
            pass


def _is_download_cancelled(appid: int) -> bool:
    try:
        return get_download_state(appid).get("status") == "cancelled"
    except Exception:
        return False


def _download_zip_for_app(appid: int):
    client = ensure_http_client("Project Nova: download")
    apis = load_api_manifest()
    if not apis:
        logger.warn("Project Nova: No enabled APIs in manifest")
        set_download_state(appid, {"status": "failed", "error": "No APIs available"})
        return

    dest_root = ensure_temp_download_dir()
    dest_path = os.path.join(dest_root, f"{appid}.zip")
    set_download_state(
        appid,
        {"status": "checking", "currentApi": None, "bytesRead": 0, "totalBytes": 0, "dest": dest_path, "apiErrors": {}},
    )

    morrenus_api_key = get_morrenus_api_key()

    for api in apis:
        if _is_download_cancelled(appid):
            logger.log(f"Project Nova: Download cancelled before API '{api.get('name')}'")
            return

        name = api.get("name", "Unknown")
        template = api.get("url", "")
        success_code = int(api.get("success_code", 200))
        unavailable_code = int(api.get("unavailable_code", 404))

        if "<moapikey>" in template:
            if not morrenus_api_key:
                logger.log(f"Project Nova: Skipping API '{name}' - Morrenus API key not configured")
                continue
            template = template.replace("<moapikey>", morrenus_api_key)

        url = template.replace("<appid>", str(appid))
        set_download_state(appid, {"status": "checking", "currentApi": name, "bytesRead": 0, "totalBytes": 0})
        logger.log(f"Project Nova: Trying API '{name}'")
        try:
            headers = {"User-Agent": USER_AGENT}
            if _is_download_cancelled(appid):
                logger.log(f"Project Nova: Download cancelled before contacting API '{name}'")
                return

            # Retry up to 2 times per API for timeouts
            for attempt in range(2):
                if _is_download_cancelled(appid):
                    logger.log(f"Project Nova: Download cancelled during retry loop for API '{name}'")
                    return

                try:
                    with client.stream("GET", url, headers=headers, follow_redirects=True, timeout=30) as resp:
                        code = resp.status_code
                        logger.log(f"Project Nova: API '{name}' status={code}")
                        if code == unavailable_code:
                            break  # skip this API, go to next
                        if code != success_code:
                            state = get_download_state(appid)
                            api_errors = state.get("apiErrors", {})
                            api_errors[name] = {"type": "error", "code": code}
                            set_download_state(appid, {"apiErrors": api_errors})
                            break
                        total = int(resp.headers.get("Content-Length", "0") or "0")
                        set_download_state(appid, {"status": "downloading", "bytesRead": 0, "totalBytes": total})
                        
                        # Check cancellation before writing file
                        if _is_download_cancelled(appid):
                            logger.log(f"Project Nova: Download cancelled before writing file for appid={appid}")
                            raise RuntimeError("cancelled")
                            
                        with open(dest_path, "wb") as output:
                            for chunk in resp.iter_bytes():
                                if not chunk:
                                    continue
                                if _is_download_cancelled(appid):
                                    logger.log(f"Project Nova: Download cancelled mid-stream for appid={appid}")
                                    raise RuntimeError("cancelled")
                                output.write(chunk)
                                state = get_download_state(appid)
                                read = int(state.get("bytesRead", 0)) + len(chunk)
                                set_download_state(appid, {"bytesRead": read})
                                if _is_download_cancelled(appid):
                                    logger.log(f"Project Nova: Download cancelled after writing chunk for appid={appid}")
                                    raise RuntimeError("cancelled")
                        logger.log(f"Project Nova: Download complete -> {dest_path}")

                        if _is_download_cancelled(appid):
                            logger.log(f"Project Nova: Download marked cancelled after completion for appid={appid}")
                            raise RuntimeError("cancelled")

                        # Validate zip magic
                        try:
                            with open(dest_path, "rb") as fh:
                                magic = fh.read(4)
                                if magic not in (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"):
                                    file_size = os.path.getsize(dest_path)
                                    with open(dest_path, "rb") as check_f:
                                        preview = check_f.read(512)
                                        content_preview = preview[:100].decode("utf-8", errors="ignore")
                                    logger.warn(
                                        f"Project Nova: API '{name}' returned non-zip file (magic={magic.hex()}, size={file_size}, preview={content_preview[:50]})"
                                    )
                                    try:
                                        os.remove(dest_path)
                                    except Exception:
                                        pass
                                    break
                        except FileNotFoundError:
                            logger.warn("Project Nova: Downloaded file not found after download")
                            break
                        except Exception as validation_exc:
                            logger.warn(f"Project Nova: File validation failed for API '{name}': {validation_exc}")
                            try:
                                os.remove(dest_path)
                            except Exception:
                                pass
                            break

                        try:
                            if _is_download_cancelled(appid):
                                logger.log(f"Project Nova: Processing aborted due to cancellation for appid={appid}")
                                raise RuntimeError("cancelled")
                            set_download_state(appid, {"status": "processing"})
                            _process_and_install_lua(appid, dest_path)
                            if _is_download_cancelled(appid):
                                logger.log(f"Project Nova: Installation complete but marked cancelled for appid={appid}")
                                raise RuntimeError("cancelled")
                            try:
                                fetched_name = _fetch_app_name(appid) or f"UNKNOWN ({appid})"
                                _append_loaded_app(appid, fetched_name)
                                _log_appid_event(f"ADDED - {name}", appid, fetched_name)
                            except Exception:
                                pass
                            set_download_state(appid, {"status": "done", "success": True, "api": name})
                            return
                        except Exception as install_exc:
                            if isinstance(install_exc, RuntimeError) and str(install_exc) == "cancelled":
                                try:
                                    if os.path.exists(dest_path):
                                        os.remove(dest_path)
                                except Exception:
                                    pass
                                logger.log(f"Project Nova: Cancelled download cleanup complete for appid={appid}")
                                return
                            logger.warn(f"Project Nova: Processing failed -> {install_exc}")
                            set_download_state(appid, {"status": "failed", "error": f"Processing failed: {install_exc}"})
                            try:
                                os.remove(dest_path)
                            except Exception:
                                pass
                            return
                    # If we got here, the API attempt succeeded or explicitly broke, so exit retry loop
                    break
                except (httpx.TimeoutException, httpx.ConnectTimeout, httpx.ReadTimeout) as timeout_err:
                    logger.warn(f"Project Nova: API '{name}' timeout (attempt {attempt+1}/2): {timeout_err}")
                    if attempt == 1:
                        # Track timeout error
                        state = get_download_state(appid)
                        api_errors = state.get("apiErrors", {})
                        api_errors[name] = {"type": "timeout"}
                        set_download_state(appid, {"apiErrors": api_errors})
                    else:
                        continue
                except RuntimeError as cancel_exc:
                    if str(cancel_exc) == "cancelled":
                        try:
                            if os.path.exists(dest_path):
                                os.remove(dest_path)
                        except Exception:
                            pass
                        logger.log(f"Project Nova: Download cancelled and cleaned up for appid={appid}")
                        return
                    raise
                except Exception as err:
                    logger.warn(f"Project Nova: API '{name}' failed with error: {err}")
                    error_type = "timeout" if isinstance(err, (httpx.TimeoutException, httpx.ReadTimeout, httpx.ConnectTimeout)) else "error"
                    error_code = None
                    if isinstance(err, httpx.HTTPStatusError):
                        error_code = err.response.status_code if err.response else None
                    elif hasattr(err, "response") and err.response:
                        error_code = err.response.status_code
                    state = get_download_state(appid)
                    api_errors = state.get("apiErrors", {})
                    if error_type == "timeout":
                        api_errors[name] = {"type": "timeout"}
                    else:
                        api_errors[name] = {"type": "error", "code": error_code}
                    set_download_state(appid, {"apiErrors": api_errors})
                    break  # No retry for non-timeout errors, skip to next API
        except RuntimeError as cancel_exc:
            if str(cancel_exc) == "cancelled":
                try:
                    if os.path.exists(dest_path):
                        os.remove(dest_path)
                except Exception:
                    pass
                logger.log(f"Project Nova: Download cancelled and cleaned up for appid={appid}")
                return
            logger.warn(f"Project Nova: Runtime error during download for appid={appid}: {cancel_exc}")
            set_download_state(appid, {"status": "failed", "error": str(cancel_exc)})
            return
        except Exception as err:
            continue

    set_download_state(appid, {"status": "failed", "error": "Not available on any API"})

def start_add_via_projectnova(appid: int) -> str:
    try:
        appid = int(appid)
    except Exception:
        return json.dumps({"success": False, "error": "Invalid appid"})

    logger.log(f"Project Nova: StartAddViaProjectNova appid={appid}")
    set_download_state(appid, {"status": "queued", "bytesRead": 0, "totalBytes": 0})
    thread = threading.Thread(target=_download_zip_for_app, args=(appid,), daemon=True)
    thread.start()
    return json.dumps({"success": True})


def get_add_status(appid: int) -> str:
    try:
        appid = int(appid)
    except Exception:
        return json.dumps({"success": False, "error": "Invalid appid"})
    state = get_download_state(appid)
    return json.dumps({"success": True, "state": state})


def read_loaded_apps() -> str:
    try:
        path = _loaded_apps_path()
        entries = []
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                for line in handle.read().splitlines():
                    if ":" in line:
                        appid_str, name = line.split(":", 1)
                        appid_str = appid_str.strip()
                        name = name.strip()
                        if appid_str.isdigit() and name:
                            entries.append({"appid": int(appid_str), "name": name})
        return json.dumps({"success": True, "apps": entries})
    except Exception as exc:
        return json.dumps({"success": False, "error": str(exc)})


def dismiss_loaded_apps() -> str:
    try:
        path = _loaded_apps_path()
        if os.path.exists(path):
            os.remove(path)
        return json.dumps({"success": True})
    except Exception as exc:
        return json.dumps({"success": False, "error": str(exc)})


def delete_projectnova_for_app(appid: int) -> str:
    try:
        appid = int(appid)
    except Exception:
        return json.dumps({"success": False, "error": "Invalid appid"})

    base = detect_steam_install_path() or Millennium.steam_path()
    target_dir = os.path.join(base or "", "config", "stplug-in")
    paths = [
        os.path.join(target_dir, f"{appid}.lua"),
        os.path.join(target_dir, f"{appid}.lua.disabled"),
    ]
    deleted = []
    for path in paths:
        try:
            if os.path.exists(path):
                os.remove(path)
                deleted.append(path)
        except Exception as exc:
            logger.warn(f"Project Nova: Failed to delete {path}: {exc}")
    try:
        name = _get_loaded_app_name(appid) or _fetch_app_name(appid) or f"UNKNOWN ({appid})"
        _remove_loaded_app(appid)
        if deleted:
            _log_appid_event("REMOVED", appid, name)
    except Exception:
        pass
    return json.dumps({"success": True, "deleted": deleted, "count": len(deleted)})


def get_icon_data_url() -> str:
    try:
        steam_ui_path = os.path.join(Millennium.steam_path(), "steamui", WEBKIT_DIR_NAME)
        icon_path = os.path.join(steam_ui_path, WEB_UI_ICON_FILE)
        if not os.path.exists(icon_path):
            icon_path = public_path(WEB_UI_ICON_FILE)
        with open(icon_path, "rb") as handle:
            data = handle.read()
        b64 = base64.b64encode(data).decode("ascii")
        return json.dumps({"success": True, "dataUrl": f"data:image/png;base64,{b64}"})
    except Exception as exc:
        logger.warn(f"Project Nova: GetIconDataUrl failed: {exc}")
        return json.dumps({"success": False, "error": str(exc)})


def has_projectnova_for_app(appid: int) -> str:
    try:
        appid = int(appid)
    except Exception:
        return json.dumps({"success": False, "error": "Invalid appid"})
    exists = has_lua_for_app(appid)
    return json.dumps({"success": True, "exists": exists})


def cancel_add_via_projectnova(appid: int) -> str:
    try:
        appid = int(appid)
    except Exception:
        return json.dumps({"success": False, "error": "Invalid appid"})

    state = get_download_state(appid)
    if not state or state.get("status") in {"done", "failed"}:
        return json.dumps({"success": True, "message": "Nothing to cancel"})

    set_download_state(appid, {"status": "cancelled", "error": "Cancelled by user"})
    logger.log(f"Project Nova: Cancellation requested for appid={appid}")
    return json.dumps({"success": True})


def get_installed_lua_scripts() -> str:
    try:
        _preload_app_names_cache()

        base_path = detect_steam_install_path() or Millennium.steam_path()
        if not base_path:
            return json.dumps({"success": False, "error": "Could not find Steam installation path"})

        target_dir = os.path.join(base_path, "config", "stplug-in")
        if not os.path.exists(target_dir):
            return json.dumps({"success": True, "scripts": []})

        installed_scripts = []

        try:
            for filename in os.listdir(target_dir):
                if filename.endswith(".lua") or filename.endswith(".lua.disabled"):
                    try:
                        appid_str = filename.replace(".lua.disabled", "").replace(".lua", "")
                        appid = int(appid_str)
                        is_disabled = filename.endswith(".lua.disabled")
                        game_name = ""
                        with APP_NAME_CACHE_LOCK:
                            game_name = APP_NAME_CACHE.get(appid, "")
                        if not game_name:
                            game_name = _get_loaded_app_name(appid)
                        if not game_name:
                            game_name = f"Unknown Game ({appid})"
                        file_path = os.path.join(target_dir, filename)
                        file_stat = os.stat(file_path)
                        file_size = file_stat.st_size
                        modified_time = datetime.datetime.fromtimestamp(file_stat.st_mtime)
                        formatted_date = modified_time.strftime("%Y-%m-%d %H:%M:%S")
                        script_info = {
                            "appid": appid,
                            "gameName": game_name,
                            "filename": filename,
                            "isDisabled": is_disabled,
                            "fileSize": file_size,
                            "modifiedDate": formatted_date,
                            "path": file_path
                        }
                        installed_scripts.append(script_info)
                    except ValueError:
                        continue
                    except Exception as exc:
                        logger.warn(f"Project Nova: Failed to process Lua file {filename}: {exc}")
                        continue
        except Exception as exc:
            logger.warn(f"Project Nova: Failed to scan stplug-in directory: {exc}")
            return json.dumps({"success": False, "error": f"Failed to scan directory: {str(exc)}"})

        installed_scripts.sort(key=lambda x: x["appid"])
        return json.dumps({"success": True, "scripts": installed_scripts})
    except Exception as exc:
        logger.warn(f"Project Nova: Failed to get installed Lua scripts: {exc}")
        return json.dumps({"success": False, "error": str(exc)})


__all__ = [
    "cancel_add_via_projectnova",
    "delete_projectnova_for_app",
    "dismiss_loaded_apps",
    "fetch_app_name",
    "get_add_status",
    "get_games_database",
    "get_icon_data_url",
    "get_installed_lua_scripts",
    "has_projectnova_for_app",
    "init_applist",
    "init_games_db",
    "read_loaded_apps",
    "start_add_via_projectnova",
]