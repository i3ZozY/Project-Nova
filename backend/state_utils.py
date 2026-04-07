"""Centralised state management for downloads, fixes, and unfixes."""

import threading
from typing import Any, Dict

# Download (Add via Project Nova) state
DOWNLOAD_STATE: Dict[int, Dict[str, Any]] = {}
DOWNLOAD_LOCK = threading.Lock()

# Fix download state
FIX_DOWNLOAD_STATE: Dict[int, Dict[str, Any]] = {}
FIX_DOWNLOAD_LOCK = threading.Lock()

# Unfix state
UNFIX_STATE: Dict[int, Dict[str, Any]] = {}
UNFIX_LOCK = threading.Lock()


def set_download_state(appid: int, update: dict) -> None:
    with DOWNLOAD_LOCK:
        state = DOWNLOAD_STATE.get(appid) or {}
        state.update(update)
        DOWNLOAD_STATE[appid] = state


def get_download_state(appid: int) -> dict:
    with DOWNLOAD_LOCK:
        return DOWNLOAD_STATE.get(appid, {}).copy()


def set_fix_download_state(appid: int, update: dict) -> None:
    with FIX_DOWNLOAD_LOCK:
        state = FIX_DOWNLOAD_STATE.get(appid) or {}
        state.update(update)
        FIX_DOWNLOAD_STATE[appid] = state


def get_fix_download_state(appid: int) -> dict:
    with FIX_DOWNLOAD_LOCK:
        return FIX_DOWNLOAD_STATE.get(appid, {}).copy()


def set_unfix_state(appid: int, update: dict) -> None:
    with UNFIX_LOCK:
        state = UNFIX_STATE.get(appid) or {}
        state.update(update)
        UNFIX_STATE[appid] = state


def get_unfix_state(appid: int) -> dict:
    with UNFIX_LOCK:
        return UNFIX_STATE.get(appid, {}).copy()