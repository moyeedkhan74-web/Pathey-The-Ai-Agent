@echo off
cd /d "%~dp0"
title Pathey Whisper Server
echo.
echo   ============================================
echo     PATHEY LOCAL WHISPER TRANSCRIPTION SERVER
echo   ============================================
echo.
echo   Installing dependencies (first run only)...
python -m pip install --upgrade pip
python -m pip install faster-whisper flask
echo.
echo   Starting Whisper server on port 5005...
echo   Model: small.en (English). Set WHISPER_MODEL to override.
echo   Keep this window open while using Pathey voice mode.
echo.
python scripts\whisper_server.py
pause
