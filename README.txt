==============================================================================
                          PATHEY AI COMPANION
           Portable AI Agent & Standalone JARVIS Desktop HUD
==============================================================================

Overview
--------
Pathey is a portable, standalone AI agent and interactive JARVIS-style HUD 
desktop companion designed to run seamlessly from a USB drive or local directory. 
Equipped with voice interaction, offline/online speech handling, memory 
persistence, document parsing, and dynamic chart generation, Pathey brings 
a futuristic AI assistant to any Windows desktop without external dependencies.


Key Features
------------
1. Portable & Self-Contained:
   - Stores configuration, databases (Better-SQLite3), voice cache, and 
     temporary data strictly inside the project directory (`./data`, `./temp`).

2. Futuristic Desktop HUD Interface:
   - Built on Electron with sound effects, dynamic animations, and 
     voice visualizer UI.

3. Advanced Voice & TTS Engine:
   - High-quality text-to-speech powered by `msedge-tts` with fallback options.
   - Offline voice recognition support via Vosk Python pipeline (`vosk_recognition.py`).

4. Gemini AI Core & Multi-Key Failover:
   - Powered by `@google/genai` (Google Gemini API).
   - Supports multiple API key failover (comma-separated or numbered keys).

5. Memory & Document Intelligence:
   - Persistent conversation memory and knowledge base using SQLite.
   - PDF document parsing using `pdf-parse`.
   - Chart generation using `chart.js`.


Quick Start Guide
-----------------

1. Prerequisites:
   - Node.js (v18 or higher recommended)
   - Windows 10/11

2. Configure Environment:
   - Copy `.env.example` to `.env`:
     `copy .env.example .env`
   - Open `.env` and add your Google Gemini API key:
     `GEMINI_API_KEY=AIzaSy...`
   - Multiple keys can be comma-separated for automatic failover:
     `GEMINI_API_KEY=key_1,key_2,key_3`

3. Install Dependencies (if running for the first time):
   - Open command prompt in the project folder and run:
     `npm install`

4. Launch Pathey:
   - Simply double-click `start.bat` (or `start_desktop.bat`), OR run in terminal:
     `npm start`


Project Directory Structure
---------------------------
  pathey/
  ├── main.js                   # Electron main process entry point
  ├── ai.js                     # Gemini AI API integration & key rotation logic
  ├── voice.js                  # Speech synthesis (Edge TTS) & audio playback
  ├── memory.js                 # Local SQLite database & memory persistence
  ├── browser_utils.js          # Web browsing & browser interaction utilities
  ├── index.html                # Main HUD desktop user interface
  ├── start.bat                 # One-click launcher script
  ├── .env                      # API keys and environment configuration
  ├── package.json              # Dependencies and script definitions
  ├── data/                     # Local SQLite database & persistence storage
  ├── scripts/                  # Helper scripts (Electron/SQLite binary verification)
  └── voices/                   # Generated audio cache directory


Troubleshooting & Tips
----------------------
- Invalid/Missing API Key:
  Ensure `.env` exists in the root folder with a valid `GEMINI_API_KEY`.

- Electron / SQLite Native Binary Issues:
  Running `npm install` automatically triggers `ensure-electron.js` and 
  `ensure-sqlite3.js` to download or build required native binaries.

- Audio / Voice Input Setup:
  Ensure standard Windows recording and playback devices are active. You can 
  run `unlock_all_onecore.ps1` via PowerShell if Windows OneCore voices are locked.


License & Info
--------------
Pathey AI Project — Portable USB AI Desktop Agent.
==============================================================================
