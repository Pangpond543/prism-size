@echo off
cd /d "%~dp0"
if not exist node_modules\electron (
  echo Installing dependencies...
  call npm install
)
start "" /b cmd /c "npx electron app"
