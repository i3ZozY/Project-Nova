from __future__ import annotations

import copy
import json
import os
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple

from logger import logger
from paths import backend_path

from .options import (
    SETTINGS_GROUPS,
    SettingOption,
    get_settings_schema,
    merge_defaults_with_values,
)

SCHEMA_VERSION = 1
SETTINGS_FILE = backend_path(os.path.join("data", "settings.json"))

_SETTINGS_LOCK = threading.Lock()
_SETTINGS_CACHE: Dict[str, Any] | None = None
_CHANGE_HOOKS: Dict[Tuple[str, str], List[Callable[[Any, Any], None]]] = {}


def _ensure_settings_dir() -> None:
    directory = os.path.dirname(SETTINGS_FILE)
    try:
        os.makedirs(directory, exist_ok=True)
    except Exception as exc:
        logger.warn(f"Project Nova: Failed to ensure settings directory: {exc}")


def _load_settings_file() -> Dict[str, Any]:
    if not os.path.exists(SETTINGS_FILE):
        return {}
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:
        logger.warn(f"Project Nova: Failed to read settings file: {exc}")
        return {}


def _write_settings_file(data: Dict[str, Any]) -> None:
    _ensure_settings_dir()
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
    except Exception as exc:
        logger.warn(f"Project Nova: Failed to persist settings file: {exc}")


def _persist_values(values: Dict[str, Any]) -> None:
    payload = {"version": SCHEMA_VERSION, "values": values}
    _write_settings_file(payload)
    global _SETTINGS_CACHE
    _SETTINGS_CACHE = copy.deepcopy(values)


def _build_option_lookup() -> Dict[Tuple[str, str], SettingOption]:
    lookup: Dict[Tuple[str, str], SettingOption] = {}
    for group in SETTINGS_GROUPS:
        for option in group.options:
            lookup[(group.key, option.key)] = option
    return lookup


_OPTION_LOOKUP = _build_option_lookup()


def _validate_option_value(option: SettingOption, value: Any) -> Tuple[bool, Any, str | None]:
    if option.option_type == "toggle":
        if isinstance(value, bool):
            return True, value, None
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"true", "1", "yes", "y"}:
                return True, True, None
            if lowered in {"false", "0", "no", "n"}:
                return True, False, None
        return False, option.default, "Value must be a boolean"

    if option.option_type == "text":
        # Accept any string value, convert non-strings to string
        if value is None:
            return True, "", None
        return True, str(value).strip(), None

    if option.option_type == "select":
        allowed = {
            str(choice.get("value"))
            for choice in option.choices or []
            if isinstance(choice, dict) and choice.get("value") is not None
        }
        if str(value) in allowed:
            return True, value, None
        return False, option.default, "Value not in list of allowed options"

    # Fallback: accept any value
    return True, value, None


def init_settings() -> None:
    """Eagerly load and cache settings."""
    with _SETTINGS_LOCK:
        _load_settings_cache()


def _load_settings_cache() -> Dict[str, Any]:
    global _SETTINGS_CACHE
    if _SETTINGS_CACHE is not None:
        return _SETTINGS_CACHE

    raw_data = _load_settings_file()
    version = raw_data.get("version", 0)
    values = raw_data.get("values")

    merged_values = merge_defaults_with_values(values)

    if version != SCHEMA_VERSION or merged_values != values:
        _write_settings_file({"version": SCHEMA_VERSION, "values": merged_values})
    _SETTINGS_CACHE = merged_values
    return merged_values


def _get_values_locked() -> Dict[str, Any]:
    values = _load_settings_cache()
    if not isinstance(values, dict):
        values = {}
    return values


def get_morrenus_api_key() -> str:
    """Get the Morrenus API key from settings."""
    with _SETTINGS_LOCK:
        values = _get_values_locked()
        general = values.get("general") or {}
        return str(general.get("morrenusApiKey") or "")


def get_settings_payload() -> Dict[str, Any]:
    with _SETTINGS_LOCK:
        values = _get_values_locked()
        values_snapshot = copy.deepcopy(values)

    schema = get_settings_schema()  # no dynamic injection needed anymore

    return {
        "version": SCHEMA_VERSION,
        "values": values_snapshot,
        "schema": schema,
    }


def apply_settings_changes(changes: Dict[str, Any]) -> Dict[str, Any]:
    """Apply a batch of settings changes."""
    if not isinstance(changes, dict):
        return {"success": False, "error": "Invalid payload"}

    with _SETTINGS_LOCK:
        current = _get_values_locked()
        updated = merge_defaults_with_values(current)

        errors: Dict[str, Dict[str, str]] = {}
        applied_changes: List[Tuple[Tuple[str, str], Any, Any]] = []

        for group_key, options_changes in changes.items():
            if not isinstance(options_changes, dict):
                errors.setdefault(group_key, {})["*"] = "Group payload must be an object"
                continue

            if group_key not in updated:
                errors.setdefault(group_key, {})["*"] = "Unknown settings group"
                continue

            for option_key, value in options_changes.items():
                option_lookup_key = (group_key, option_key)
                option = _OPTION_LOOKUP.get(option_lookup_key)
                if not option:
                    errors.setdefault(group_key, {})[option_key] = "Unknown option"
                    continue

                is_valid, normalised_value, error = _validate_option_value(option, value)
                if not is_valid:
                    errors.setdefault(group_key, {})[option_key] = error or "Invalid value"
                    continue

                previous_value = updated[group_key].get(option_key, option.default)
                if previous_value == normalised_value:
                    continue

                updated[group_key][option_key] = normalised_value
                applied_changes.append((option_lookup_key, previous_value, normalised_value))

        if errors:
            return {"success": False, "errors": errors}

        if not applied_changes:
            values_snapshot = copy.deepcopy(updated)
            return {
                "success": True,
                "values": values_snapshot,
                "message": "No-op",
            }

        _persist_values(updated)
        values_snapshot = copy.deepcopy(updated)

        # Invoke hooks
        for option_key, previous, current_value in applied_changes:
            for callback in _CHANGE_HOOKS.get(option_key, []):
                try:
                    callback(previous, current_value)
                except Exception as exc:
                    logger.warn(f"Project Nova: settings hook failed for {option_key}: {exc}")

        return {
            "success": True,
            "values": values_snapshot,
        }