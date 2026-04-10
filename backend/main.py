import json
import os
import shutil
import sys
import threading
import webbrowser
import subprocess

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
from paths import get_plugin_dir, public_path
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
    """
    Called from frontend to start the manifest updater.
    """
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

    def run_script():
        plugin_root = get_plugin_dir()
        script_path = os.path.join(plugin_root, "manifests.ps1")
        logger.log(f"Looking for manifest script at: {script_path}")
        if not os.path.exists(script_path):
            with MANIFEST_UPDATER_LOCK:
                MANIFEST_UPDATER_STATE["status"] = "error"
                MANIFEST_UPDATER_STATE["error"] = f"manifests.ps1 not found at {script_path}"
            return

        # Build command in correct order
        cmd = [
            "powershell.exe",
            "-ExecutionPolicy", "Bypass"
        ]
        if hideWindow:
            cmd.extend(["-WindowStyle", "Hidden"])
        cmd.extend([
            "-File", script_path,
            "-AppId", str(appid),
            "-Mode", mode
        ])
        if morrenusKey:
            cmd.extend(["-MorrenusApiKey", morrenusKey])
        if manifesthubKey:
            cmd.extend(["-ManifestHubApiKey", manifesthubKey])

        logger.log(f"Running command: {' '.join(cmd)}")

        try:
            creationflags = subprocess.CREATE_NO_WINDOW if hideWindow else 0
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True,
                creationflags=creationflags,
                cwd=plugin_root
            )
            output_lines = []
            for line in iter(process.stdout.readline, ''):
                if line:
                    output_lines.append(line)
                    with MANIFEST_UPDATER_LOCK:
                        MANIFEST_UPDATER_STATE["output"] = "".join(output_lines[-50:])
                    logger.log(f"[MANIFEST] {line.strip()}")
            process.wait()
            exit_code = process.returncode
            logger.log(f"Manifest script exited with code {exit_code}")

            if exit_code == 0:
                with MANIFEST_UPDATER_LOCK:
                    MANIFEST_UPDATER_STATE["status"] = "done"
                    MANIFEST_UPDATER_STATE["output"] = "".join(output_lines[-100:])
            else:
                with MANIFEST_UPDATER_LOCK:
                    MANIFEST_UPDATER_STATE["status"] = "error"
                    MANIFEST_UPDATER_STATE["error"] = f"Script exited with code {exit_code}. Check logs for details."
                    MANIFEST_UPDATER_STATE["output"] = "".join(output_lines[-100:])
        except Exception as e:
            logger.error(f"Manifest updater exception: {e}")
            with MANIFEST_UPDATER_LOCK:
                MANIFEST_UPDATER_STATE["status"] = "error"
                MANIFEST_UPDATER_STATE["error"] = str(e)

    threading.Thread(target=run_script, daemon=True).start()
    return json.dumps({"success": True, "message": "Manifest updater started"})


def get_manifest_updater_status(**kwargs):
    """Return current status for frontend polling."""
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

    js_src = public_path(WEB_UI_JS_FILE)
    js_dst = os.path.join(steam_ui_path, WEB_UI_JS_FILE)
    logger.log(f"Copying Project Nova web UI from {js_src} to {js_dst}")
    try:
        shutil.copy(js_src, js_dst)
    except Exception as exc:
        logger.error(f"Failed to copy Project Nova web UI: {exc}")

    icon_src = public_path(WEB_UI_ICON_FILE)
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
    themes_src = os.path.join(plugin_dir, "public", "themes")
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
        themes_path = os.path.join(get_plugin_dir(), 'public', 'themes', 'themes.json')
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