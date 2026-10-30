@echo off
rem Stops the API and web app, including the helper processes that uvicorn --reload and Vite leave behind.
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'uvicorn app.main:app|multiprocessing.spawn|vite' -and $_.Name -match 'python|node|cmd' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-NetTCPConnection -State Listen -LocalPort 5173,8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
echo Stopped.
