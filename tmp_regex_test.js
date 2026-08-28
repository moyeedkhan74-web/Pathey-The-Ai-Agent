const { extractYouTubeVideoIdFromHtml } = require('./browser_utils');
const html = '<script>var ytInitialData = {"contents":{"sectionListRenderer":{"contents":[{"videoRenderer":{"videoId":"dQw4w9WgXcQ"}}]}}};</script>';
console.log(extractYouTubeVideoIdFromHtml(html));
