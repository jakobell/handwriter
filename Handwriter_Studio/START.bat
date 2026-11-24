@echo off
cd /d "%~dp0"
echo Handwriter Studio - http://localhost:8000
where py >nul 2>&1
if %errorlevel%==0 (
    py -3 -m http.server 8000 --bind 127.0.0.1 --directory docs
) else (
    python -m http.server 8000 --bind 127.0.0.1 --directory docs
)
pause
