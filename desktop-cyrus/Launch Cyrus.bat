@echo off
cd /d "%~dp0"
where pyw >nul 2>nul
if %errorlevel%==0 (
  start "" pyw -3 "%~dp0cyrus_companion.py"
  exit /b
)
where pythonw >nul 2>nul
if %errorlevel%==0 (
  start "" pythonw "%~dp0cyrus_companion.py"
  exit /b
)
echo Python for Windows was not found. Install Python 3 and try again.
pause
