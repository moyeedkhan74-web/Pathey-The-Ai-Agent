const test = require('node:test');
const assert = require('node:assert/strict');
const { extractToolCall, normalizeUrl, shouldStopAfterToolCall, isYouTubeWatchUrl, isGenericYouTubeUrl, extractYouTubeVideoIdFromHtml } = require('../browser_utils');

test('extractToolCall handles raw JSON tool responses', () => {
  const result = extractToolCall('{"tool":"open_url","args":{"url":"https://www.instagram.com"}}');
  assert.deepEqual(result, {
    tool: 'open_url',
    args: { url: 'https://www.instagram.com' }
  });
});

test('extractToolCall handles wrapped text and code fences', () => {
  const result = extractToolCall('Sure — here is the action:\n```json\n{"tool":"open_url","args":{"url":"https://www.facebook.com"}}\n```');
  assert.deepEqual(result, {
    tool: 'open_url',
    args: { url: 'https://www.facebook.com' }
  });
});

test('normalizeUrl adds https for bare hostnames', () => {
  assert.equal(normalizeUrl('instagram.com'), 'https://instagram.com');
  assert.equal(normalizeUrl('https://www.instagram.com'), 'https://www.instagram.com');
});

test('shouldStopAfterToolCall stops after browser-opening actions', () => {
  assert.equal(shouldStopAfterToolCall({ tool: 'open_url' }), true);
  assert.equal(shouldStopAfterToolCall({ tool: 'open_app' }), true);
  assert.equal(shouldStopAfterToolCall({ tool: 'read_file' }), false);
});

test('YouTube URL helpers distinguish watch URLs from generic search URLs', () => {
  assert.equal(isYouTubeWatchUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.equal(isYouTubeWatchUrl('https://www.youtube.com/results?search_query=hello'), false);
  assert.equal(isGenericYouTubeUrl('https://www.youtube.com/results?search_query=hello'), true);
  assert.equal(isGenericYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), false);
});

test('extractYouTubeVideoIdFromHtml extracts a video ID from search page markup', () => {
  const html = '<script>var ytInitialData = {"contents":{"sectionListRenderer":{"contents":[{"videoRenderer":{"videoId":"dQw4w9WgXcQ"}}]}}};</script>';
  assert.equal(extractYouTubeVideoIdFromHtml(html), 'dQw4w9WgXcQ');
});

test('scoreYouTubeCandidate prioritizes most views, then official, then fallback', () => {
  const { scoreYouTubeCandidate, parseViewCount } = require('../browser_utils');
  assert.equal(parseViewCount('12M views'), 12000000);
  assert.equal(parseViewCount('850K views'), 850000);

  const candidateMostViews = { videoId: 'v1', title: 'Song Fan Upload', channel: 'User1', viewsText: '100M views', isOfficial: false, index: 0 };
  const candidateOfficialLessViews = { videoId: 'v2', title: 'Song Official Video', channel: 'Vevo', viewsText: '5M views', isOfficial: true, index: 1 };
  const candidateLowViews = { videoId: 'v3', title: 'Song Cover', channel: 'CoverChan', viewsText: '10K views', isOfficial: false, index: 2 };

  const score1 = scoreYouTubeCandidate(candidateMostViews, 'Song');
  const score2 = scoreYouTubeCandidate(candidateOfficialLessViews, 'Song');
  const score3 = scoreYouTubeCandidate(candidateLowViews, 'Song');

  // Priority 1: Most views (100M views) scores higher than lower views
  assert.ok(score1 > score2, `Expected 100M views (${score1}) > 5M views official (${score2})`);
  assert.ok(score2 > score3, `Expected 5M views official (${score2}) > 10K views (${score3})`);
});
