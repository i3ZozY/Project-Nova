import json
import os
import shutil
import sys
import threading
import webbrowser
import subprocess
import base64
import tempfile
import zipfile

from typing import Any

import Millennium  # type: ignore
import PluginUtils  # type: ignore

from api_manifest import (
    fetch_free_apis_now as api_fetch_free_apis_now,
    get_api_list as api_get_api_list,
    get_init_apis_message as api_get_init_message,
    init_apis as api_init_apis,
    store_last_message,
)
from auto_update import (
    apply_pending_update_if_any,
    check_for_updates_now as auto_check_for_updates_now,
    restart_steam as auto_restart_steam,
    start_auto_update_background_check,
)
from config import WEBKIT_DIR_NAME, WEB_UI_ICON_FILE, WEB_UI_JS_FILE
from downloads import (
    cancel_add_via_projectnova,
    delete_projectnova_for_app,
    dismiss_loaded_apps,
    get_add_status,
    get_icon_data_url,
    get_installed_lua_scripts,
    has_projectnova_for_app,
    get_games_database,
    init_applist,
    read_loaded_apps,
    start_add_via_projectnova,
    _process_and_install_lua,
    _append_loaded_app,
    _log_appid_event,
    _fetch_app_name,
)
from fixes import (
    apply_game_fix,
    cancel_apply_fix,
    check_for_fixes,
    get_apply_fix_status,
    get_installed_fixes,
    get_unfix_status,
    unfix_game,
)
from utils import ensure_temp_download_dir
from http_client import close_http_client, ensure_http_client
from logger import logger as shared_logger
from paths import get_plugin_dir, frontend_path
from settings.manager import (
    apply_settings_changes,
    get_settings_payload,
    init_settings,
)
from steam_utils import detect_steam_install_path, get_game_install_path_response, open_game_folder

logger = shared_logger


# ========================== Manifest Updater State & Functions ==========================
MANIFEST_UPDATER_STATE = {
    "status": "idle",  # idle, running, done, error
    "output": "",
    "error": None,
    "appid": None
}
MANIFEST_UPDATER_LOCK = threading.Lock()


def run_manifest_updater_interactive(appid=None, mode="github", morrenusKey="", manifesthubKey="", hideWindow=True, **kwargs):
    if appid is None and kwargs.get('args'):
        args = kwargs['args']
        if isinstance(args, dict):
            appid = args.get('appid')
            mode = args.get('mode', 'github')
            morrenusKey = args.get('morrenusKey', '')
            manifesthubKey = args.get('manifesthubKey', '')

    if not appid or not str(appid).isdigit():
        logger.error(f"Invalid AppID: {appid}")
        return json.dumps({"success": False, "error": "Valid numeric App ID required"})

    with MANIFEST_UPDATER_LOCK:
        MANIFEST_UPDATER_STATE["status"] = "running"
        MANIFEST_UPDATER_STATE["output"] = ""
        MANIFEST_UPDATER_STATE["error"] = None
        MANIFEST_UPDATER_STATE["appid"] = appid

    def run_update():
        try:
            from manifests import run_manifest_update  # noqa: F401  # pylance: ignore
            import io
            from contextlib import redirect_stdout

            f = io.StringIO()
            with redirect_stdout(f):
                result = manifests.run_manifest_update(str(appid), mode, morrenusKey, manifesthubKey)
            output = f.getvalue()
            logger.log(f"Manifest updater output:\n{output}")

            with MANIFEST_UPDATER_LOCK:
                MANIFEST_UPDATER_STATE["output"] = output
                if result.get("success"):
                    MANIFEST_UPDATER_STATE["status"] = "done"
                else:
                    MANIFEST_UPDATER_STATE["status"] = "error"
                    MANIFEST_UPDATER_STATE["error"] = result.get("error", "Update failed.")
        except Exception as e:
            logger.error(f"Manifest updater exception: {e}")
            import traceback
            logger.error(traceback.format_exc())
            with MANIFEST_UPDATER_LOCK:
                MANIFEST_UPDATER_STATE["status"] = "error"
                MANIFEST_UPDATER_STATE["error"] = str(e)

    threading.Thread(target=run_update, daemon=True).start()
    return json.dumps({"success": True, "message": "Manifest updater started"})


def get_manifest_updater_status(**kwargs):
    with MANIFEST_UPDATER_LOCK:
        return json.dumps({
            "success": True,
            "status": MANIFEST_UPDATER_STATE["status"],
            "output": MANIFEST_UPDATER_STATE["output"],
            "error": MANIFEST_UPDATER_STATE["error"],
            "appid": MANIFEST_UPDATER_STATE["appid"]
        })


# ========================== Original Backend Functions ==========================
def GetPluginDir() -> str:
    return get_plugin_dir()


class Logger:
    @staticmethod
    def log(message: str) -> str:
        shared_logger.log(f"[Frontend] {message}")
        return json.dumps({"success": True})

    @staticmethod
    def warn(message: str) -> str:
        shared_logger.warn(f"[Frontend] {message}")
        return json.dumps({"success": True})

    @staticmethod
    def error(message: str) -> str:
        shared_logger.error(f"[Frontend] {message}")
        return json.dumps({"success": True})


def _steam_ui_path() -> str:
    return os.path.join(Millennium.steam_path(), "steamui", WEBKIT_DIR_NAME)


def _copy_webkit_files() -> None:
    plugin_dir = get_plugin_dir()
    steam_ui_path = _steam_ui_path()
    os.makedirs(steam_ui_path, exist_ok=True)

    js_src = frontend_path(WEB_UI_JS_FILE)
    js_dst = os.path.join(steam_ui_path, WEB_UI_JS_FILE)
    logger.log(f"Copying Project Nova web UI from {js_src} to {js_dst}")
    try:
        shutil.copy(js_src, js_dst)
    except Exception as exc:
        logger.error(f"Failed to copy Project Nova web UI: {exc}")

    # Icon is now inside frontend/icons/
    icon_src = os.path.join(plugin_dir, "frontend", "icons", WEB_UI_ICON_FILE)
    icon_dst = os.path.join(steam_ui_path, WEB_UI_ICON_FILE)
    if os.path.exists(icon_src):
        try:
            shutil.copy(icon_src, icon_dst)
            logger.log(f"Copied Project Nova icon to {icon_dst}")
        except Exception as exc:
            logger.error(f"Failed to copy Project Nova icon: {exc}")
    else:
        logger.warn(f"Project Nova icon not found at {icon_src}")

    # Copy theme CSS files
    themes_src = os.path.join(plugin_dir, "frontend", "themes")
    themes_dst = os.path.join(steam_ui_path, "themes")
    if os.path.exists(themes_src):
        try:
            os.makedirs(themes_dst, exist_ok=True)
            for filename in os.listdir(themes_src):
                if filename.endswith(".css"):
                    theme_src = os.path.join(themes_src, filename)
                    theme_dst = os.path.join(themes_dst, filename)
                    shutil.copy(theme_src, theme_dst)
                    logger.log(f"Copied theme file {filename} to {theme_dst}")
        except Exception as exc:
            logger.warn(f"Failed to copy theme files: {exc}")


def _inject_webkit_files() -> None:
    js_path = os.path.join(WEBKIT_DIR_NAME, WEB_UI_JS_FILE)
    Millennium.add_browser_js(js_path)
    logger.log(f"Project Nova injected web UI: {js_path}")


def InitApis(contentScriptQuery: str = "") -> str:
    return api_init_apis(contentScriptQuery)


def GetInitApisMessage(contentScriptQuery: str = "") -> str:
    return api_get_init_message(contentScriptQuery)


def FetchFreeApisNow(contentScriptQuery: str = "") -> str:
    return api_fetch_free_apis_now(contentScriptQuery)


def CheckForUpdatesNow(contentScriptQuery: str = "") -> str:
    result = auto_check_for_updates_now()
    return json.dumps(result)


def RestartSteam(contentScriptQuery: str = "") -> str:
    success = auto_restart_steam()
    if success:
        return json.dumps({"success": True})
    return json.dumps({"success": False, "error": "Failed to restart Steam"})


def HasProjectNovaForApp(appid: int, contentScriptQuery: str = "") -> str:
    return has_projectnova_for_app(appid)


def StartAddViaProjectNova(appid: int, contentScriptQuery: str = "") -> str:
    return start_add_via_projectnova(appid)


def GetAddViaProjectNovaStatus(appid: int, contentScriptQuery: str = "") -> str:
    return get_add_status(appid)


def GetApiList(contentScriptQuery: str = "") -> str:
    return api_get_api_list(contentScriptQuery)


def CancelAddViaProjectNova(appid: int, contentScriptQuery: str = "") -> str:
    return cancel_add_via_projectnova(appid)


def GetIconDataUrl(contentScriptQuery: str = "") -> str:
    return get_icon_data_url()


def GetGamesDatabase(contentScriptQuery: str = "") -> str:
    return get_games_database()


def ReadLoadedApps(contentScriptQuery: str = "") -> str:
    return read_loaded_apps()


def DismissLoadedApps(contentScriptQuery: str = "") -> str:
    return dismiss_loaded_apps()


def DeleteProjectNovaForApp(appid: int, contentScriptQuery: str = "") -> str:
    return delete_projectnova_for_app(appid)


def CheckForFixes(appid: int, contentScriptQuery: str = "") -> str:
    return check_for_fixes(appid)


def ApplyGameFix(appid: int, downloadUrl: str, installPath: str, fixType: str = "", gameName: str = "", contentScriptQuery: str = "") -> str:
    return apply_game_fix(appid, downloadUrl, installPath, fixType, gameName)


def GetApplyFixStatus(appid: int, contentScriptQuery: str = "") -> str:
    return get_apply_fix_status(appid)


def CancelApplyFix(appid: int, contentScriptQuery: str = "") -> str:
    return cancel_apply_fix(appid)


def UnFixGame(appid: int, installPath: str = "", fixDate: str = "", contentScriptQuery: str = "") -> str:
    return unfix_game(appid, installPath, fixDate)


def GetUnfixStatus(appid: int, contentScriptQuery: str = "") -> str:
    return get_unfix_status(appid)


def GetInstalledFixes(contentScriptQuery: str = "") -> str:
    return get_installed_fixes()


def GetInstalledLuaScripts(contentScriptQuery: str = "") -> str:
    return get_installed_lua_scripts()


def GetGameInstallPath(appid: int, contentScriptQuery: str = "") -> str:
    result = get_game_install_path_response(appid)
    return json.dumps(result)


def OpenGameFolder(path: str, contentScriptQuery: str = "") -> str:
    success = open_game_folder(path)
    if success:
        return json.dumps({"success": True})
    return json.dumps({"success": False, "error": "Failed to open path"})


def OpenExternalUrl(url: str, contentScriptQuery: str = "") -> str:
    try:
        value = str(url or "").strip()
        if not (value.startswith("http://") or value.startswith("https://")):
            return json.dumps({"success": False, "error": "Invalid URL"})
        if sys.platform.startswith("win"):
            try:
                os.startfile(value)  # type: ignore[attr-defined]
            except Exception:
                webbrowser.open(value)
        else:
            webbrowser.open(value)
        return json.dumps({"success": True})
    except Exception as exc:
        logger.warn(f"Project Nova: OpenExternalUrl failed: {exc}")
        return json.dumps({"success": False, "error": str(exc)})


def GetSettingsConfig(contentScriptQuery: str = "") -> str:
    try:
        payload = get_settings_payload()
        response = {
            "success": True,
            "schemaVersion": payload.get("version"),
            "schema": payload.get("schema", []),
            "values": payload.get("values", {}),
        }
        return json.dumps(response)
    except Exception as exc:
        logger.warn(f"Project Nova: GetSettingsConfig failed: {exc}")
        return json.dumps({"success": False, "error": str(exc)})


def GetThemes(contentScriptQuery: str = "") -> str:
    try:
        themes_path = os.path.join(get_plugin_dir(), 'frontend', 'themes', 'themes.json')
        if os.path.exists(themes_path):
            try:
                with open(themes_path, 'r', encoding='utf-8') as fh:
                    data = json.load(fh)
                    return json.dumps({"success": True, "themes": data})
            except Exception as exc:
                logger.warn(f"Project Nova: Failed to read themes.json: {exc}")
                return json.dumps({"success": False, "error": "Failed to read themes.json"})
        else:
            return json.dumps({"success": True, "themes": []})
    except Exception as exc:
        logger.warn(f"Project Nova: GetThemes failed: {exc}")
        return json.dumps({"success": False, "error": str(exc)})


def ApplySettingsChanges(
    _contentScriptQuery: str = "", changes: Any = None, **kwargs: Any
) -> str:
    try:
        if "changes" in kwargs and changes is None:
            changes = kwargs["changes"]
        if changes is None:
            changes = kwargs

        payload: Any = None

        if isinstance(changes, str) and changes:
            try:
                payload = json.loads(changes)
            except Exception:
                logger.warn("Project Nova: Failed to parse changes string payload")
                return json.dumps({"success": False, "error": "Invalid JSON payload"})
            else:
                if isinstance(payload, dict) and "changes" in payload:
                    payload = payload.get("changes")
                elif isinstance(payload, dict) and "changesJson" in payload and isinstance(payload["changesJson"], str):
                    try:
                        payload = json.loads(payload["changesJson"])
                    except Exception:
                        logger.warn("Project Nova: Failed to parse changesJson string inside payload")
                        return json.dumps({"success": False, "error": "Invalid JSON payload"})
        elif isinstance(changes, dict) and changes:
            if "changesJson" in changes and isinstance(changes["changesJson"], str):
                try:
                    payload = json.loads(changes["changesJson"])
                except Exception:
                    logger.warn("Project Nova: Failed to parse changesJson payload from dict")
                    return json.dumps({"success": False, "error": "Invalid JSON payload"})
            elif "changes" in changes:
                payload = changes.get("changes")
            else:
                payload = changes
        else:
            changes_json = kwargs.get("changesJson")
            if isinstance(changes_json, dict):
                payload = changes_json
            elif isinstance(changes_json, str) and changes_json:
                try:
                    payload = json.loads(changes_json)
                except Exception:
                    logger.warn("Project Nova: Failed to parse changesJson payload")
                    return json.dumps({"success": False, "error": "Invalid JSON payload"})
            else:
                payload = changes

        if payload is None:
            payload = {}
        elif not isinstance(payload, dict):
            logger.warn(f"Project Nova: Parsed payload is not a dict: {payload!r}")
            return json.dumps({"success": False, "error": "Invalid payload format"})

        result = apply_settings_changes(payload)
        response = json.dumps(result)
        return response
    except Exception as exc:
        logger.warn(f"Project Nova: ApplySettingsChanges failed: {exc}")
        return json.dumps({"success": False, "error": str(exc)})


# ========================== Import Game Files (Drag & Drop) ==========================
def ImportGameFile(content: str, filename: str, contentScriptQuery: str = "") -> str:
    """
    Receives a base64-encoded .lua or .zip file from the frontend,
    validates it, and installs it into the stplug-in folder.
    """
    try:
        file_data = base64.b64decode(content)
    except Exception as e:
        logger.error(f"ImportGameFile base64 decode failed: {e}")
        return json.dumps({"success": False, "error": "Invalid file data (base64 decode failed)"})

    is_lua = filename.lower().endswith(".lua")
    is_zip = filename.lower().endswith(".zip")

    if not (is_lua or is_zip):
        return json.dumps({"success": False, "error": "Only .lua or .zip files are supported"})

    suffix = os.path.splitext(filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_data)
        tmp_path = tmp.name

    try:
        if is_lua:
            base = os.path.basename(filename)
            appid_str = os.path.splitext(base)[0]
            if not appid_str.isdigit():
                return json.dumps({"success": False, "error": "Lua filename must be numeric (e.g., 730.lua)"})
            appid = int(appid_str)

            base_path = detect_steam_install_path() or Millennium.steam_path()
            target_dir = os.path.join(base_path, "config", "stplug-in")
            os.makedirs(target_dir, exist_ok=True)
            dest = os.path.join(target_dir, f"{appid}.lua")
            shutil.copy(tmp_path, dest)
            logger.log(f"Imported lua file -> {dest}")

            name = _fetch_app_name(appid) or f"UNKNOWN ({appid})"
            _append_loaded_app(appid, name)
            _log_appid_event("IMPORTED (LUA)", appid, name)
            return json.dumps({"success": True, "appid": appid, "name": name})

        elif is_zip:
            with zipfile.ZipFile(tmp_path, 'r') as zf:
                lua_candidates = [
                    name for name in zf.namelist()
                    if name.lower().endswith('.lua') and os.path.basename(name).split('.')[0].isdigit()
                ]
                if not lua_candidates:
                    return json.dumps({"success": False, "error": "No valid numeric .lua file found inside the ZIP"})

                lua_name = lua_candidates[0]
                appid = int(os.path.basename(lua_name).split('.')[0])

                temp_lua = tempfile.NamedTemporaryFile(delete=False, suffix=".lua")
                temp_lua.write(zf.read(lua_name))
                temp_lua.close()

                _process_and_install_lua(appid, temp_lua.name)
                os.unlink(temp_lua.name)

            name = _fetch_app_name(appid) or f"UNKNOWN ({appid})"
            _append_loaded_app(appid, name)
            _log_appid_event("IMPORTED (ZIP)", appid, name)
            return json.dumps({"success": True, "appid": appid, "name": name})

    except Exception as e:
        logger.error(f"ImportGameFile error: {e}")
        return json.dumps({"success": False, "error": str(e)})
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


# ========================== Plugin Lifecycle ==========================
class Plugin:
    def _front_end_loaded(self):
        _copy_webkit_files()

    def _load(self):
        logger.log(f"bootstrapping Project Nova plugin, millennium {Millennium.version()}")

        try:
            detect_steam_install_path()
        except Exception as exc:
            logger.warn(f"Project Nova: steam path detection failed: {exc}")

        ensure_http_client("InitApis")
        ensure_temp_download_dir()

        try:
            init_settings()
        except Exception as exc:
            logger.warn(f"Project Nova: settings initialization failed: {exc}")

        try:
            message = apply_pending_update_if_any()
            if message:
                store_last_message(message)
        except Exception as exc:
            logger.warn(f"AutoUpdate: apply pending failed: {exc}")

        try:
            init_applist()
        except Exception as exc:
            logger.warn(f"Project Nova: Applist initialization failed: {exc}")

        _copy_webkit_files()
        _inject_webkit_files()

        try:
            result = InitApis("boot")
            logger.log(f"InitApis (boot) return: {result}")
        except Exception as exc:
            logger.error(f"InitApis (boot) failed: {exc}")

        try:
            start_auto_update_background_check()
        except Exception as exc:
            logger.warn(f"AutoUpdate: start background check failed: {exc}")

        Millennium.ready()

    def _unload(self):
        logger.log("unloading")
        close_http_client("InitApis")


plugin = Plugin()