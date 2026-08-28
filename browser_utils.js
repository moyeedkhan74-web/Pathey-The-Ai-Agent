// browser_utils.js — Browser & YouTube helper utilities for Pathey

const YT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9'
};

/**
 * Normalizes URL string by adding https:// if protocol is missing.
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/**
 * Extracts structured tool call { tool, args } from model output or JSON text.
 */
function extractToolCall(text) {
  if (!text || typeof text !== 'string') return null;

  // Try direct JSON parse first
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && parsed.tool) {
      return { tool: parsed.tool, args: parsed.args || {} };
    }
  } catch (_) {}

  // Strip markdown code fences if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && typeof parsed === 'object' && parsed.tool) {
        return { tool: parsed.tool, args: parsed.args || {} };
      }
    } catch (_) {}
  }

  // Regex fallback to find JSON object containing "tool"
  const jsonMatch = trimmed.match(/\{[\s\S]*?"tool"\s*:\s*"[^"]+"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === 'object' && parsed.tool) {
        return { tool: parsed.tool, args: parsed.args || {} };
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Returns true if action is browser/app launcher that should terminate agent loop.
 */
function shouldStopAfterToolCall(toolCall) {
  if (!toolCall || !toolCall.tool) return false;
  const t = toolCall.tool.toLowerCase();
  return t === 'open_url' || t === 'open_app';
}

/**
 * Checks if URL is a direct YouTube watch or short URL.
 */
function isYouTubeWatchUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /(?:youtube\.com\/watch\?v=|youtu\.be\/)/i.test(url);
}

/**
 * Checks if URL is a general YouTube page (results, homepage, channel) but not watch.
 */
function isGenericYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /youtube\.com|youtu\.be/i.test(url) && !isYouTubeWatchUrl(url);
}

/**
 * Parses view count string (e.g. "12M views", "1.5M views", "850K views", "1,234,567 views") into numeric value.
 */
function parseViewCount(viewsText) {
  if (!viewsText || typeof viewsText !== 'string') return 0;
  const clean = viewsText.replace(/,/g, '').trim();
  const match = clean.match(/([\d.]+)\s*([kmbKMB])?\s*views?/i);
  if (!match) return 0;
  let val = parseFloat(match[1]);
  if (isNaN(val)) return 0;
  const unit = (match[2] || '').toUpperCase();
  if (unit === 'K') val *= 1000;
  else if (unit === 'M') val *= 1000000;
  else if (unit === 'B') val *= 1000000000;
  return val;
}

/**
 * Extracts first YouTube video ID from HTML markup.
 */
function extractYouTubeVideoIdFromHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const match = html.match(/"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/);
  return match ? match[1] : null;
}

/**
 * Extracts multiple video candidates with view counts, channel names, and official badges from YouTube search HTML.
 */
function extractYouTubeVideoIdsFromHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const candidates = [];
  const seen = new Set();

  const parts = html.split(/"videoRenderer"\s*:\s*\{/);

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i].slice(0, 1500);
    const idMatch = block.match(/"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/);
    if (!idMatch) continue;

    const videoId = idMatch[1];
    if (seen.has(videoId)) continue;
    seen.add(videoId);

    // Extract Title
    let title = '';
    const titleMatch = block.match(/"title"\s*:\s*\{[^}]*?"text"\s*:\s*"([^"]+)"/) ||
                       block.match(/"title"\s*:\s*\{[^}]*?"simpleText"\s*:\s*"([^"]+)"/);
    if (titleMatch) title = titleMatch[1];

    // Extract Channel Name
    let channel = '';
    const channelMatch = block.match(/"ownerText"\s*:\s*\{[^}]*?"text"\s*:\s*"([^"]+)"/) ||
                         block.match(/"longBylineText"\s*:\s*\{[^}]*?"text"\s*:\s*"([^"]+)"/);
    if (channelMatch) channel = channelMatch[1];

    // Extract Views Text
    let viewsText = '';
    const viewsMatch = block.match(/"viewCountText"\s*:\s*\{[^}]*?"simpleText"\s*:\s*"([^"]+)"/) ||
                       block.match(/"viewCountText"\s*:\s*\{[^}]*?"text"\s*:\s*"([^"]+)"/);
    if (viewsMatch) viewsText = viewsMatch[1];

    const viewsNumeric = parseViewCount(viewsText);

    // Check if Official (Official Video, Official Audio, Official Channel badge)
    const combinedText = `${title} ${channel}`.toLowerCase();
    const isOfficial = /\bofficial\b|vevo|\b(official music video|official video|official audio|official hd|official 4k)\b/i.test(combinedText) ||
                       block.includes('BADGE_STYLE_TYPE_VERIFIED') ||
                       block.includes('OFFICIAL_ARTIST_BADGE');

    candidates.push({
      videoId,
      title,
      channel,
      viewsText,
      viewsNumeric,
      isOfficial,
      index: candidates.length
    });
  }

  // Fallback if videoRenderer chunking yielded 0 candidates
  if (candidates.length === 0) {
    const fallbackRegex = /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/g;
    let match;
    while ((match = fallbackRegex.exec(html)) !== null) {
      const videoId = match[1];
      if (!seen.has(videoId)) {
        seen.add(videoId);
        candidates.push({
          videoId,
          title: '',
          channel: '',
          viewsText: '',
          viewsNumeric: 0,
          isOfficial: false,
          index: candidates.length
        });
      }
    }
  }

  return candidates;
}

/**
 * Searches YouTube for query and returns list of video candidates.
 */
async function searchYouTubeVideos(query) {
  if (!query || typeof query !== 'string') return [];
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`;
    const res = await fetch(searchUrl, { headers: YT_HEADERS });
    if (!res.ok) return [];
    const html = await res.text();
    return extractYouTubeVideoIdsFromHtml(html);
  } catch (err) {
    console.error('[browser_utils] searchYouTubeVideos error:', err.message);
    return [];
  }
}

/**
 * Scores a YouTube candidate based on user priority rules:
 * Priority 1: Highest View Count (More Views)
 * Priority 2: Official Release / Channel
 * Priority 3: Last Option (Relevance / Position Tie-breaker)
 */
function scoreYouTubeCandidate(candidate, query, channelFilter = '') {
  if (!candidate || !candidate.videoId) return -1;
  let score = 0;

  // Priority 1: Highest View Count (More Views) - Primary Factor
  const views = candidate.viewsNumeric || parseViewCount(candidate.viewsText);
  if (views > 0) {
    score += Math.log10(views + 1) * 1000;
  }

  // Priority 2: Official Video / Official Channel (+300 pts boost)
  if (candidate.isOfficial) {
    score += 300;
  }

  // Priority 3: Search query relevance match & channel filter
  const qLower = (query || '').toLowerCase();
  const titleLower = (candidate.title || '').toLowerCase();
  const channelLower = (candidate.channel || '').toLowerCase();
  const filterLower = (channelFilter || '').toLowerCase().trim();

  if (filterLower && channelLower.includes(filterLower)) {
    score += 500;
  }

  if (qLower && titleLower.includes(qLower)) {
    score += 50;
  }

  // Fallback tie-breaker position (earlier search results get slight edge if equal)
  score += Math.max(0, 10 - (candidate.index || 0));

  return score;
}

/**
 * Extracts quoted phrases from text.
 */
function extractQuotedPhrases(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(/"([^"]+)"|'([^']+)'/g);
  if (!matches) return [];
  return matches.map(m => m.slice(1, -1).trim()).filter(Boolean);
}

/**
 * Checks if HTML indicates video is unavailable.
 */
function isYouTubeVideoUnavailableHtml(html) {
  if (!html || typeof html !== 'string') return true;
  return /video is unavailable|video has been removed|private video|unavailable-message/i.test(html);
}

/**
 * Checks if user message is a research request.
 */
function isResearchRequest(text) {
  if (!text || typeof text !== 'string') return false;
  if (text.trim().split(/\s+/).filter(Boolean).length < 5) return false;
  const researchPatterns = [
    /\b(?:research|search|find out|look up|investigate)\b/i,
    /\b(?:who is|what is|tell me about|explain)\b/i,
    /\b(?:current|latest|recent|today|now)\b.*\b(?:affairs|news|events|updates|status|situation)\b/i,
    /\b(?:news|updates|headlines|events)\b.*\b(?:in|of|about|from)\b/i,
    /\b(?:what(?:'s| is) (?:happening|going on|the (?:current|latest|recent)))\b/i,
    /\b(?:weather|stock|price|rate|score)\b.*\b(?:today|now|current|latest)\b/i,
    /\b(?:happened|occur(?:red|s)|taking place)\b/i,
    /\b(?:score|result|outcome)\b.*\b(?:of|in|for)\b/i,
    /\bhow (?:many|much|do|does|can|would|should)\b/i,
    /\b(?:compare|difference between|versus|vs)\b/i,
    /\b(?:best|top|worst|cheapest|fastest|largest|smallest)\b/i,
    /\b(?:history|origin|background|biography)\b.*\b(?:of|about)\b/i,
    /\b(?:statistics|data|facts|information)\b.*\b(?:on|about|for)\b/i
  ];
  let matchCount = 0;
  for (const re of researchPatterns) {
    if (re.test(text)) {
      matchCount += 1;
      if (matchCount >= 2) return true;
    }
  }
  return false;
}

module.exports = {
  normalizeUrl,
  extractToolCall,
  shouldStopAfterToolCall,
  isYouTubeWatchUrl,
  isGenericYouTubeUrl,
  parseViewCount,
  extractYouTubeVideoIdFromHtml,
  extractYouTubeVideoIdsFromHtml,
  searchYouTubeVideos,
  scoreYouTubeCandidate,
  extractQuotedPhrases,
  isYouTubeVideoUnavailableHtml,
  isResearchRequest
};
