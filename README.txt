==============================================================================
                              PATHEY AI AGENT
       Autonomous Desktop AI Assistant & Futuristic JARVIS HUD Companion
                   (Optional: USB Portable / Plug & Play)
==============================================================================

Overview
--------
Pathey is an advanced, autonomous desktop AI Agent and interactive JARVIS-style HUD 
companion designed for direct terminal launch and high-performance daily AI tasks. 
Equipped with multi-modal intelligence, real-time voice interaction, long-term memory 
persistence, document analysis, dynamic charts, and web capabilities, Pathey serves 
as a primary desktop AI companion.

Additionally, Pathey is fully portable—it can be stored on and executed directly from 
a USB drive on any Windows PC with zero system modification.


Instant Terminal Commands for Other Users
------------------------------------------
Users can download, install, or launch Pathey directly from their terminal using 
a single command:

1. One-Line PowerShell Quick Download & Launch (Windows):
   iwr -useb https://raw.githubusercontent.com/moyeedkhan74-web/Pathey-The-Ai-Agent/main/install.ps1 | iex

2. Direct Binary Executable Download (Single Command):
   Invoke-WebRequest -Uri "https://github.com/moyeedkhan74-web/Pathey-The-Ai-Agent/releases/latest/download/Pathey.exe" -OutFile "Pathey.exe"; Start-Process ".\Pathey.exe"

3. One-Line Git Clone & Run (For Developers / Terminal Users):
   git clone https://github.com/moyeedkhan74-web/Pathey-The-Ai-Agent.git && cd Pathey-The-Ai-Agent && npm install && npm start


Key Features
------------
1. Major Autonomous Desktop AI Agent:
   - Powered by `@google/genai` (Google Gemini API) with multi-key automatic failover.
   - Handles complex instructions, conversation context, automated task execution, 
     and browser/web utility integrations.

2. Futuristic Desktop HUD Interface:
   - High-tech JARVIS-inspired UI built on Electron with sound effects, 
     dynamic animations, audio visualizer, and HUD dashboard controls.

3. Real-Time Voice & Speech Engine:
   - High-fidelity text-to-speech powered by `msedge-tts` with voice selection.
   - Offline voice recognition support via local Vosk Python pipeline ([vosk_recognition.py](cci:7://file:///e:/pathey/vosk_recognition.py:0:0-0:0)).

4. Memory Persistence & Intelligence Core:
   - Long-term conversation memory and knowledge base using local SQLite (`Better-SQLite3`).
   - PDF document parsing using `pdf-parse`.
   - On-the-fly chart generation using `chart.js`.

5. Portable & Self-Contained Architecture (Secondary Capability):
   - Fully zero-install capable. All configuration, SQLite databases, voice cache, 
     and temporary data are kept strictly inside the project root (`./data`, `./temp`), 
     making it perfect for USB drive portability.
...
