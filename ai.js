// ai.js — Gemini-only AI integration for Pathey
let GoogleGenAI = null;
try {
  ({ GoogleGenAI } = require('@google/genai'));
} catch (err) {
  console.warn('[Pathey AI] @google/genai unavailable, using offline fallback:', err.message);
}
const conversationHistory = [];
const MAX_HISTORY = 20;
let activeGeminiKeyIndex = 0;
function getGeminiApiKeys() {
  const keys = [];
  const cleanKey = (k) => (k ? k.trim().replace(/^['\"]|['\"]$/g, '') : '');
  const mainKey = process.env.GEMINI_API_KEY;
  if (mainKey && mainKey !== 'your_key_here') {
    const splitKeys = mainKey.split(',').map(cleanKey).filter((k) => k && k !== 'your_key_here');
    keys.push(...splitKeys);
  }
  let idx = 1;
  while (process.env[`GEMINI_API_KEY_${idx}`]) {
    const k = cleanKey(process.env[`GEMINI_API_KEY_${idx}`]);
    if (k && k !== 'your_key_here' && !keys.includes(k)) {
      keys.push(k);
    }
    idx += 1;
  }
  return keys;
}
function buildSystemPrompt(memoryContext) {
  let prompt = `You are a custom local AI assistant running on the user's PC. Your persona is a 20-year-old, brilliant, energetic, and highly tech-savvy Indian guy — think of a witty, modern Indian version of Peter Parker.

CRITICAL AUDIO-READY INSTRUCTIONS (To make Edge TTS sound 100% human):

1. SPEECH-OPTIMIZED PHRASING: Write exactly how young people talk, not how textbooks are written. Use natural, human conversational transitions at the start of sentences (e.g., "Oh, wait...", "Alright, let's see...", "Hey,", "Got it,", "Yeah,").
2. SHORT & FAST BREAKS: Keep sentences short (under 12 words when possible). Break long ideas into multiple tiny sentences. This mimics natural breathing and keeps the fast-paced "Peter Parker" energy when the TTS reads it out.
3. INDIAN ENGLISH NUANCES: Use fluent, modern Indian English (en-IN). Avoid sounding like an old-school corporate helpline or an American teenager. Talk like a smart tech student from Bangalore or Mumbai.
4. NO TTS GLITCHES: Never use heavy markdown, headers, bullet points, asterisks (*), hashtags, or emojis. The Text-to-Speech engine will glitch or read them aloud awkwardly. Use clean, plain text paragraphs.
5. CASUAL BUT SMART: You are an incredibly smart peer sitting next to the user. You are excited about tech, helpful with PC tasks, and quick with your answers.

You are named Pathey. You live on the user's USB drive and can help with code, files, searches, and everyday tasks. Respond to the user now in this perfect human-like conversational flow.

When the user asks you to do something, immediately run the appropriate tool by outputting ONLY the tool JSON call. Do not explain your steps beforehand.

Available tools and their syntax:
- list_directory: {"tool":"list_directory","args":{"path":"<path>"}}
- read_file: {"tool":"read_file","args":{"path":"<path>"}}
- git_status: {"tool":"git_status","args":{"path":"<path>"}}
- run_command: {"tool":"run_command","args":{"cmd":"<cmd>"}}
- write_file: {"tool":"write_file","args":{"path":"<path>","content":"<content>"}}
- open_url: {"tool":"open_url","args":{"url":"<url>","browser":"<optional_browser_name>","clipboard":"<optional_text>"}}
- open_app: {"tool":"open_app","args":{"name":"<app_executable>"}}

Automation rules for Web and YouTube search queries:
1. YouTube / Videos: When the user asks to play a song or video on YouTube:
   - ALWAYS use a YouTube SEARCH URL with a well-crafted query. Format: https://www.youtube.com/results?search_query=<query>
   - Build the query as: "{song/video name} {artist name} official audio" or "{song/video name} {artist name} official video"
   - If you do not know the artist, use: "{song/video name} original official"
    - NEVER guess or fabricate a YouTube video ID (watch?v=...). You do not have access to YouTube's database.
    - The app automatically picks the best video: most views first, then official channel as tiebreaker.
    - If the user wraps a name in double quotes (e.g. "Atif Aslam"), include that exact quoted name in the search query — it forces playback from that specific channel only.
    - NEVER ask the user to choose; the app resolves it automatically.
   - Example: user says "play Ishq Murshid drama on YouTube"
     Output: {"tool":"open_url","args":{"url":"https://www.youtube.com/results?search_query=Ishq+Murshid+drama+official","searchQuery":"Ishq Murshid drama official"}}
   - Example: user says "play Tera Naam by Atif Aslam"
     Output: {"tool":"open_url","args":{"url":"https://www.youtube.com/results?search_query=Tera+Naam+Atif+Aslam+official+audio","searchQuery":"Tera Naam Atif Aslam official audio"}}
2. Web Search / Surfing: DO NOT generate open_url tool calls for Google searches, Google AI Mode, or any search engine. Web searches, research questions, and information lookups are handled automatically by Pathey's built-in research system. Simply reply with a brief acknowledgment like "Let me research that for you" and the system handles the rest internally.
3. Asking AI engines (ChatGPT, Claude, Gemini, etc.): If the user asks to open ChatGPT, Gemini, or Claude and ask/prompt a question (e.g. "open chatgpt and ask 'who am i'", "open gemini prompt write a recipe", "ask claude explain quantum physics"), use the open_url tool with the 'clipboard' argument to set their clipboard and open the site in one step.
   - For ChatGPT: url = "https://chatgpt.com"
   - For Gemini: url = "https://gemini.google.com"
   - For Claude: url = "https://claude.ai"
   - Example 1: user says "open chatgpt and ask who am i"
     Output: {"tool":"open_url","args":{"url":"https://chatgpt.com","clipboard":"who am i"}}
   - Example 2: user says "open gemini prompt this write a python script"
     Output: {"tool":"open_url","args":{"url":"https://gemini.google.com","clipboard":"write a python script"}}
   - Example 3: user says "ask claude explain async await"
     Output: {"tool":"open_url","args":{"url":"https://claude.ai","clipboard":"explain async await"}}
   - In your final response, inform the user that you are opening the AI interface, pasting the prompt, and submitting it for them automatically.
4. Websites & Mail (ChatGPT, Gemini, Claude, Gmail, Google, etc.): If the user asks to open ChatGPT, Gemini, Claude, check mail/email, or open a specific website, directly open its standard URL using 'open_url'.
   - Example: if they say "open chatgpt", use: {"tool":"open_url","args":{"url":"https://chatgpt.com"}}
   - Example: if they say "open gemini", use: {"tool":"open_url","args":{"url":"https://gemini.google.com"}}
   - Example: if they say "open claude", use: {"tool":"open_url","args":{"url":"https://claude.ai"}}
   - Example: if they say "check mail" or "open gmail", use: {"tool":"open_url","args":{"url":"https://mail.google.com"}}
   - Example: if they say "open outlook", use: {"tool":"open_url","args":{"url":"https://outlook.live.com"}}
   - Example: if they say "open google", use: {"tool":"open_url","args":{"url":"https://www.google.com"}}
5. Applications: If the user asks to open an app (e.g. calculator, notepad, visual studio), use the 'open_app' tool with standard executable filenames.
   - Example: for notepad use {"tool":"open_app","args":{"name":"notepad.exe"}}
   - Example: for calculator use {"tool":"open_app","args":{"name":"calc.exe"}}
6. Custom Browsers / Non-default Browsers: If the user requests to open a website, search, or AI portal in a specific browser (e.g. "open instagram in chrome", "open google on brave", "open chatgpt in edge"), use the 'open_url' tool and pass the browser name (e.g. "chrome", "brave", "msedge", "firefox", "opera") in the 'browser' argument. Never run command-line tools like 'run_command' or commands starting with 'start' for this.
7. Project links from memory: If the user asks to open a specific project (e.g. "open my SilenX repo"), look under the "## Projects" section in the memory context provided below. If that exact project name appears there with a URL, use that exact URL in an open_url tool call. DO NOT construct or guess any URL — use ONLY the exact URL stored.
8. Single-action browser requests: For simple requests like "play one song", "open one link", or "open one app", use a single open_url/open_app tool call and stop. Do not chain multiple browser-opening actions for the same request.
9. YouTube Video Selection Priority: When the user asks to play a video or song on YouTube, pass the query to open_url. The automated YouTube resolver will evaluate candidates using this strict priority hierarchy:
   - Priority 1: Highest View Count (More Views - video with top view count is selected first)
   - Priority 2: Official Video / Official Channel (boost for official releases when view counts are comparable)
   - Priority 3: Fallback Tie-breaker (search result relevance and position)

CRITICAL RULE — NEVER INVENT URLS:
You must NEVER invent, guess, or fabricate a URL, GitHub link, or repo path.
- If the user asks to open a specific named project/repo and that exact project appears under "## Projects" in the memory context provided, use that exact URL in an open_url tool call.
- If it does NOT appear there, do NOT attempt a URL at all. Reply in plain text asking the user for the exact link, and mention they can say "remember my <project> repo is <url>" so it is saved for next time.
- This rule overrides all other automation rules for named project links.

CRITICAL RULE — NEVER CLAIM TO HAVE SEARCHED OR OPENED THE WEB:
You must NEVER tell the user you have "opened Google", "searched the web", "browsed the internet", "looked up", "checked online", "found on the internet", or performed any web search action. You do NOT have the ability to browse the web or perform searches. If you don't know the answer to something, say so honestly: "I don't have that information — you can use the research feature by asking me to research it." Do NOT fabricate claims about current events, news, or recent information as if you verified them online. If asked about something you don't know, be honest about the limits of your knowledge.

Format rule:
- Output ONLY the JSON object. Do not wrap JSON in markdown block/code fences (do not write \`\`\`json).
- If the request is conversational and does not concern a tool action, reply directly in plain text.
`;
  if (memoryContext && memoryContext.trim()) {
    prompt += `\nWhat you know about this user:\n${memoryContext}\n\nUse that context when useful.\n`;
  }
  return prompt;
}

function buildPlannerPrompt(userMessage, memoryContext) {
  let sys = `You are Pathey's task planner — a friendly, energetic AI with a Peter Parker vibe. Given a user request, decompose it into a step-by-step plan.

Return ONLY a JSON object with this structure (no markdown, no extra text):
{"plan": [
  {"step": 1, "tool": "<tool_name>", "args": {<args>}, "parallel_group": "A"},
  {"step": 2, "tool": "<tool_name>", "args": {<args>}, "parallel_group": "A"},
  {"step": 3, "tool": "<tool_name>", "args": {<args>}, "parallel_group": "B"}
]}

Available tools: list_directory, read_file, git_status, run_command, write_file, open_url, open_app

YouTube rule: If the user asks to play a song/video, the open_url step MUST use a YouTube search URL ("https://www.youtube.com/results?search_query=<query>") and MAY include a "searchQuery" arg with the raw query. NEVER guess or fabricate a watch?v=<id> URL.

DO NOT include open_url steps for Google searches, Google AI Mode, Gemini, or any search engine queries. Web searches and research questions are handled internally by the research system — not by opening a browser.

Grouping rules:
- Steps that are independent and read-only (list_directory, read_file, git_status) CAN share the same parallel_group letter and will run concurrently.
- Steps that depend on earlier results, or are state-changing (run_command, write_file, open_url, open_app), MUST get a new parallel_group letter.
- Max 8 steps total. If task is simple and only needs 1 step, return a plan with just that step.
- If the request can be handled as a single conversational reply (no tools needed), return: {"plan": []}`;

  if (memoryContext && memoryContext.trim()) {
    sys += `\n\nUser context:\n${memoryContext}`;
  }
  return { system: sys, user: userMessage };
}

async function getRawPlanFromAI(userMessage, memoryContext) {
  const { system, user } = buildPlannerPrompt(userMessage, memoryContext);
  const keys = getGeminiApiKeys();
  if (keys.length === 0) return null;
  const apiKey = keys[activeGeminiKeyIndex % keys.length];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }]
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text.trim();
    }
  } catch (err) {
    console.warn('[Pathey Planner] Plan fetch failed:', err.message);
  }
  return null;
}
async function tryGemini(message, systemInstruction, history = []) {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) return null;
  let attempts = 0;
  while (attempts < keys.length) {
    const currentIdx = (activeGeminiKeyIndex + attempts) % keys.length;
    const apiKey = keys[currentIdx];
    try {
      const contents = [];
      const recentHistory = history.length ? history : conversationHistory.slice(-MAX_HISTORY);
      for (const entry of recentHistory) {
        const role = entry.role === 'assistant' ? 'model' : 'user';
        if (entry.content) {
          contents.push({ role, parts: [{ text: entry.content }] });
        }
      }
      contents.push({ role: 'user', parts: [{ text: message }] });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents
        }),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim()) {
          activeGeminiKeyIndex = currentIdx;
          return text.trim();
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        console.warn(`[Pathey Gemini] Key #${currentIdx + 1} HTTP ${res.status}:`, errData?.error?.message || res.statusText);
        if (res.status === 401 || res.status === 403) {
          // Permanently shift past invalid key
          activeGeminiKeyIndex = (currentIdx + 1) % keys.length;
        }
      }
    } catch (err) {
      console.warn(`[Pathey Gemini] Key #${currentIdx + 1} failed: ${err.message}`);
    }
    attempts += 1;
  }
  return null;
}

async function tryMistral(message, systemInstruction) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: message }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (text && text.trim()) return text.trim();
  } catch (err) {
    console.warn('[Pathey Mistral] Failed:', err.message);
  }
  return null;
}

async function tryNvidia(message, systemInstruction) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'meta/llama-3.1-8b-instruct',
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: message }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (text && text.trim()) return text.trim();
  } catch (err) {
    console.warn('[Pathey NVIDIA] Failed:', err.message);
  }
  return null;
}

async function getAIResponse(message, memoryContext, preferredModel, history = []) {
  const systemInstruction = buildSystemPrompt(memoryContext);

  // 1. Try preferred or Gemini
  if (preferredModel === 'mistral') {
    const mReply = await tryMistral(message, systemInstruction);
    if (mReply) return mReply;
  }
  if (preferredModel === 'nvidia') {
    const nReply = await tryNvidia(message, systemInstruction);
    if (nReply) return nReply;
  }

  // 2. Cascade: Gemini -> Mistral -> NVIDIA
  try {
    const geminiReply = await tryGemini(message, systemInstruction, history);
    if (geminiReply) {
      conversationHistory.push({ role: 'user', content: message });
      conversationHistory.push({ role: 'assistant', content: geminiReply });
      while (conversationHistory.length > MAX_HISTORY * 2) conversationHistory.splice(0, 2);
      return geminiReply;
    }
  } catch (err) {
    console.warn('[Pathey AI] Gemini request failed:', err.message);
  }

  // Fallback to Mistral
  const mistralReply = await tryMistral(message, systemInstruction);
  if (mistralReply) {
    conversationHistory.push({ role: 'user', content: message });
    conversationHistory.push({ role: 'assistant', content: mistralReply });
    while (conversationHistory.length > MAX_HISTORY * 2) conversationHistory.splice(0, 2);
    return mistralReply;
  }

  // Fallback to NVIDIA
  const nvidiaReply = await tryNvidia(message, systemInstruction);
  if (nvidiaReply) {
    conversationHistory.push({ role: 'user', content: message });
    conversationHistory.push({ role: 'assistant', content: nvidiaReply });
    while (conversationHistory.length > MAX_HISTORY * 2) conversationHistory.splice(0, 2);
    return nvidiaReply;
  }

  return 'Sorry, all AI providers (Gemini, Mistral, NVIDIA) are currently unavailable. Please check your API keys in .env.';
}
function clearHistory() {
  conversationHistory.length = 0;
}

async function groundedFetchWithRetry(apiKey, query) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: query }] }],
          tools: [{ googleSearch: {} }]
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return res;
    const errData = await res.json().catch(() => ({}));
    if (res.status === 429 && attempt === 0) {
      console.warn('[Pathey Research] Grounded call HTTP 429 — response body:', JSON.stringify(errData));
      console.warn('[Pathey Research] Rate limited, retrying once in 5 seconds...');
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    console.warn(`[Pathey Research] Grounded call HTTP ${res.status}${res.status === 429 ? ' (retry also rate-limited)' : ''} — response body:`, JSON.stringify(errData));
    if (res.status === 401 || res.status === 403) {
      const authErr = new Error('AUTH_FAILED');
      authErr.status = res.status;
      throw authErr;
    }
    return null;
  }
  return null;
}

function tryParseStructure(text) {
  try {
    const cleaned = text.replace(/```(?:json)?/gi, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && parsed.summary && Array.isArray(parsed.bullets)) {
      return {
        summary: String(parsed.summary),
        bullets: parsed.bullets.map((b) => String(b)).slice(0, 10),
        chartData: parsed.chartData || null
      };
    }
  } catch (_) {}
  return null;
}

async function tryFallbackResearch(query) {
  const fallbackPrompt = `You are a research assistant. Based on your training knowledge, provide a comprehensive answer to this research question. Return ONLY raw JSON — no markdown, no code fences — in this exact shape:
{"summary": "2-3 sentence overview", "bullets": ["point 1", "point 2", "point 3", "..."], "chartData": null}
Maximum 10 bullets, each under 150 characters. Only populate chartData if the content naturally contains comparable numeric data; otherwise set it to null. Do NOT invent sources or URLs.

Research question: ${query}`;

  const fallbackSystem = 'You are a research assistant. Answer questions comprehensively and concisely. Do not fabricate URLs or citations.';

  const mistralReply = await tryMistral(fallbackPrompt, fallbackSystem);
  if (mistralReply) {
    const parsed = tryParseStructure(mistralReply);
    if (parsed) {
      console.log('[Pathey Research] Fallback path: Mistral (no grounding)');
      return { ...parsed, provider: 'mistral' };
    }
  }

  const nvidiaReply = await tryNvidia(fallbackPrompt, fallbackSystem);
  if (nvidiaReply) {
    const parsed = tryParseStructure(nvidiaReply);
    if (parsed) {
      console.log('[Pathey Research] Fallback path: NVIDIA (no grounding)');
      return { ...parsed, provider: 'nvidia' };
    }
  }

  return null;
}

async function researchWithGoogle(query) {
  const keys = getGeminiApiKeys();

  let groundedText = '';
  let sources = [];
  let geminiAuthFailed = false;

  if (keys.length > 0) {
    for (let attempts = 0; attempts < keys.length; attempts++) {
      const currentIdx = (activeGeminiKeyIndex + attempts) % keys.length;
      const apiKey = keys[currentIdx];
      try {
        const res = await groundedFetchWithRetry(apiKey, query);
        if (!res) continue;
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text || !text.trim()) continue;
        groundedText = text.trim();
        const metadata = data?.candidates?.[0]?.groundingMetadata;
        if (metadata && Array.isArray(metadata.groundingChunks)) {
          sources = metadata.groundingChunks
            .map((chunk) => chunk && chunk.web ? { title: chunk.web.title || '', url: chunk.web.uri || '' } : null)
            .filter((s) => s && s.url);
        }
        if (metadata && sources.length === 0) {
          console.log('[Pathey Research] No sources parsed — raw groundingMetadata:', JSON.stringify(metadata));
        }
        activeGeminiKeyIndex = currentIdx;
        break;
      } catch (err) {
        if (err.message === 'AUTH_FAILED') {
          console.warn('[Pathey Research] Gemini auth failed, will try fallback providers.');
          geminiAuthFailed = true;
          break;
        }
        console.warn(`[Pathey Research] Grounded call failed (key ${currentIdx + 1}):`, err.message);
      }
    }
  }

  if (!groundedText && geminiAuthFailed) {
    const fallback = await tryFallbackResearch(query);
    if (fallback) {
      return {
        summary: fallback.summary,
        bullets: fallback.bullets,
        chartData: fallback.chartData,
        sources: [],
        groundedFalse: true,
        provider: fallback.provider
      };
    }
    return null;
  }

  if (!groundedText) return null;

  const structurePrompt = `You are a research summarizer. Below is a web search result. Return ONLY raw JSON — no markdown, no code fences, no extra text — in exactly this shape:
{"summary": "2-3 sentence overview", "bullets": ["point 1", "point 2", "point 3", "..."], "chartData": null}
Only populate chartData if the content naturally contains comparable numeric data (e.g. statistics, rankings, trends over time). If so use: {"type": "bar", "labels": [...], "values": [...]}. Otherwise set chartData to null — do not force a chart onto non-numeric content.
Maximum 10 bullets. Keep each bullet under 150 characters.

Web search result:
${groundedText}`;

  let structured = null;
  for (let attempts = 0; attempts < keys.length; attempts++) {
    const currentIdx = (activeGeminiKeyIndex + attempts) % keys.length;
    const apiKey = keys[currentIdx];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: structurePrompt }] }],
          generationConfig: { temperature: 0.2 }
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      const cleaned = text.replace(/```(?:json)?/gi, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed && parsed.summary && Array.isArray(parsed.bullets)) {
        structured = {
          summary: String(parsed.summary),
          bullets: parsed.bullets.map((b) => String(b)).slice(0, 10),
          chartData: parsed.chartData || null
        };
        activeGeminiKeyIndex = currentIdx;
        break;
      }
    } catch (err) {
      console.warn(`[Pathey Research] Structure call failed (key ${currentIdx + 1}):`, err.message);
    }
  }

  if (!structured) {
    structured = {
      summary: groundedText.slice(0, 500),
      bullets: [],
      chartData: null
    };
  }

  return { ...structured, sources };
}

module.exports = { getAIResponse, clearHistory, getGeminiApiKeys, getRawPlanFromAI, researchWithGoogle };
