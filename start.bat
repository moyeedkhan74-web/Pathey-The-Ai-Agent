@echo off
cd /d "%~dp0"
title Pathey AI — Standalone JARVIS Companion
echo.
echo   ╔═══════════════════════════════════════════════╗
echo   ║  PATHEY AI — Standalone Fullscreen HUD        ║
echo   ║  Launching Desktop Companion...               ║
echo   ╚═══════════════════════════════════════════════╝
echo.
start "" "node_modules\electron\dist\electron.exe" .
