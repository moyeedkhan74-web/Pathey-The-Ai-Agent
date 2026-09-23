// assets/js/rag-explorer.js - RAG Memory Search Controller

(function () {
  let debounceTimer = null;
  let currentRequestId = 0;

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const terms = query.split(/\s+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (terms.length === 0) return escaped;
    const pattern = new RegExp(`(${terms.join('|')})`, 'gi');
    return escaped.replace(pattern, '<mark style="background:rgba(90,215,255,0.25);color:var(--text);padding:0 1px;border-radius:2px;">$1</mark>');
  }

  function renderResults(results, query) {
    const container = document.getElementById('memory-list');
    if (!container) return;

    if (!results || results.length === 0) {
      container.innerHTML = '<div class="empty-state">No indexed memory found.</div>';
      return;
    }

    container.innerHTML = '';
    results.forEach(r => {
      const card = document.createElement('div');
      card.className = 'rag-result-card';

      const source = document.createElement('div');
      source.className = 'rag-result-source';
      source.innerHTML = `<span>${escapeHtml(r.documentName || 'Unknown')}</span><span class="rag-result-score">score: ${typeof r.score === 'number' ? r.score.toFixed(2) : '—'}</span>`;

      const snippet = document.createElement('div');
      snippet.className = 'rag-result-snippet';
      snippet.innerHTML = highlightText(r.chunkText, query);

      card.appendChild(source);
      card.appendChild(snippet);
      container.appendChild(card);
    });
  }

  async function search(query) {
    const container = document.getElementById('memory-list');
    if (!container) return;

    if (!query || !query.trim()) {
      container.innerHTML = '<div id="memory-empty">Say "remember that..." to teach me</div>';
      return;
    }

    if (!window.pathey || !window.pathey.rag) {
      container.innerHTML = '<div class="error-state">RAG memory unavailable.</div>';
      return;
    }

    container.innerHTML = '<div class="loading-state">Searching memory...</div>';
    const requestId = ++currentRequestId;

    try {
      const data = await window.pathey.rag.search(query, 5);
      if (requestId !== currentRequestId) return;
      renderResults(data.results, query);
    } catch (err) {
      if (requestId !== currentRequestId) return;
      container.innerHTML = '<div class="error-state">Search failed. Please try again.</div>';
    }
  }

  function onSearchInput() {
    const input = document.getElementById('rag-search-input');
    if (!input) return;
    const query = input.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(query), 300);
  }

  function initRag() {
    const input = document.getElementById('rag-search-input');
    if (input) {
      input.addEventListener('input', onSearchInput);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          input.value = '';
          document.getElementById('memory-list').innerHTML = '<div id="memory-empty">Say "remember that..." to teach me</div>';
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRag);
  } else {
    initRag();
  }
})();
