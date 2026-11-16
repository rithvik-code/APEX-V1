@echo off
cd /d "%~dp0"
where pythonw.exe >nul 2>nul
if errorlevel 1 (
  echo Python for Windows is required to run Cyrus.
  pause
  exit /b 1
)
start "" pythonw.exe "%~dp0cyrus_companion.py"
