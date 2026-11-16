"""Small hidden Windows hotkey listener that can start or reveal Cyrus."""
from __future__ import annotations

import ctypes
import subprocess
import sys
import time
from ctypes import wintypes
from pathlib import Path


HOTKEY_ID = 1
MOD_NOREPEAT = 0x4000
MOD_CONTROL = 0x0002
MOD_ALT = 0x0001
MOD_SHIFT = 0x0004
VK_C = 0x43
COMPANION = Path(__file__).with_name("cyrus_companion.py")

user32 = ctypes.WinDLL("user32", use_last_error=True)


def find_cyrus_window():
    found = []
    enum_callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def visit(hwnd, _):
        length = user32.GetWindowTextLengthW(hwnd)
        if length:
            title = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, title, length + 1)
            if title.value == "CYRUS Desktop Companion":
                found.append(hwnd)
                return False
        return True

    user32.EnumWindows(enum_callback(visit), 0)
    return found[0] if found else None


def show_or_start():
    hwnd = find_cyrus_window()
    if hwnd:
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.SetForegroundWindow(hwnd)
        return
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    subprocess.Popen(
        [str(pythonw), str(COMPANION)],
        cwd=str(COMPANION.parent),
        close_fds=True,
    )


def main():
    modifiers = MOD_NOREPEAT | MOD_CONTROL | MOD_ALT | MOD_SHIFT
    if not user32.RegisterHotKey(None, HOTKEY_ID, modifiers, VK_C):
        return
    message = wintypes.MSG()
    pending_until = 0.0
    while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
        if message.message == 0x0312 and message.wParam == HOTKEY_ID:
            now = time.monotonic()
            if now >= pending_until:
                show_or_start()
                pending_until = now + 3.0
    user32.UnregisterHotKey(None, HOTKEY_ID)


if __name__ == "__main__":
    main()
