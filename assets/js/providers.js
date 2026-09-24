// assets/js/providers.js - AI Provider Widget Controller

(function () {
  let activeProvider = 'gemini';
  let switching = false;

  async function updateProviderHealth() {
    if (!window.pathey || !window.pathey.providers) return;
    try {
      const status = await window.pathey.providers.getStatus();
      renderProviderStatus(status);
    } catch (err) {
      console.warn('[Providers] Failed to fetch provider status:', err.message);
    }
  }

  async function updateMcpStatus() {
    if (!window.pathey || !window.pathey.mcp) return;
    try {
      const status = await window.pathey.mcp.getStatus();
      renderMcpStatus(status);
    } catch (err) {
      console.warn('[MCP] Failed to fetch status:', err.message);
    }
  }

  function renderProviderStatus(statusMap) {
    const dot = document.getElementById('provider-status-dot');
    const label = document.getElementById('provider-status-text');
    if (!dot || !label) return;

    const current = (statusMap && statusMap[activeProvider]) || { status: 'offline' };
    dot.className = `provider-dot ${current.status || 'offline'}`;

    let statusText = `${activeProvider.toUpperCase()}: `;
    switch (current.status) {
      case 'connected':
        statusText += 'Connected';
        break;
      case 'degraded':
        statusText += 'Degraded';
        break;
      case 'switching':
        statusText += 'Switching...';
        break;
      default:
        statusText += 'Offline';
    }
    label.textContent = statusText;
    label.setAttribute('aria-live', 'polite');
  }

  function renderMcpStatus(status) {
    const dot = document.getElementById('mcp-dot');
    const label = document.getElementById('mcp-status-text');
    if (!dot || !label) return;

    const connected = status.connected || 0;
    const total = status.total || 0;

    if (connected > 0) {
      dot.className = 'dot-status connected';
      label.textContent = `MCP: ${connected}/${total} CONNECTED`;
    } else if (status.servers && status.servers.some(s => s.connecting)) {
      dot.className = 'dot-status connecting';
      label.textContent = 'MCP: CONNECTING...';
    } else {
      dot.className = 'dot-status disconnected';
      label.textContent = `MCP: DISCONNECTED (${total} configured)`;
    }
    label.setAttribute('aria-live', 'polite');
  }

  async function switchProvider(selected) {
    if (switching) return;
    switching = true;
    const previous = activeProvider;
    activeProvider = selected;
    renderProviderStatus({ [selected]: { status: 'switching' } });

    try {
      if (window.pathey && window.pathey.providers) {
        const result = await window.pathey.providers.setActive(selected);
        if (result && result.ok) {
          await updateProviderHealth();
        } else {
          activeProvider = previous;
          renderProviderStatus({ [previous]: { status: 'offline' } });
          const label = document.getElementById('provider-status-text');
          if (label) label.textContent = `FAILED: ${result?.error || 'unknown'}`;
        }
      }
    } catch (err) {
      activeProvider = previous;
      renderProviderStatus({ [previous]: { status: 'offline' } });
      const label = document.getElementById('provider-status-text');
      if (label) label.textContent = `ERROR: ${err.message}`;
    } finally {
      switching = false;
    }
  }

  function initProviders() {
    const dropdown = document.getElementById('model-select');
    if (dropdown) {
      dropdown.addEventListener('change', async (e) => {
        const selected = e.target.value;
        if (selected === activeProvider) return;
        dropdown.disabled = true;
        await switchProvider(selected);
        dropdown.disabled = false;
      });
    }

    updateProviderHealth();
    updateMcpStatus();
    setInterval(updateProviderHealth, 30000);
    setInterval(updateMcpStatus, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProviders);
  } else {
    initProviders();
  }
})();
