@echo off
rem Starts the API and the web app in two windows, then opens the browser.
rem Does not rely on the terminal's PATH, so it works even right after installing Node.js.
set "ROOT=%~dp0..\"
set "PATH=C:\Program Files\nodejs;%PATH%"

start "Trade Guard API" /D "%ROOT%backend" cmd /k ""%ROOT%backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --reload"
start "Trade Guard Web" /D "%ROOT%frontend" cmd /k "npm run dev"

timeout /t 6 /nobreak >nul
start http://localhost:5173
