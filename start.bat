@echo off
cd /d "%~dp0"
echo ==================================================
echo   Khmer Finance AI Automation (Telegram + Gemini)
echo ==================================================
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
)
echo Starting server on http://localhost:3000 ...
start "" http://localhost:3000
node src/server.js
pause
