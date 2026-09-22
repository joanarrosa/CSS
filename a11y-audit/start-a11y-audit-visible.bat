@echo off
REM Fallback for "Start a11y-audit.vbs" in case your machine blocks VBScript
REM (some workplace security policies do). This one shows a normal cmd
REM window — leave it open while you use a11y-audit, close it when you're
REM done (that's the only way to stop the server with this version).
cd /d "%~dp0"
start "" http://localhost:4174/
call npm run serve
