// assets/js/plugins.js - Plugins Panel Controller

(function () {
  let plugins = [];
  let mcpServers = [];
  let loading = false;
  let mcpLoading = false;

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
  }

  function normalizeRisk(risk) {
    const r = (risk || 'unknown').toLowerCase();
    if (r === 'low') return 'safe';
    if (r === 'medium') return 'moderate';
    if (r === 'high') return 'dangerous';
    return 'unknown';
  }

  function normalizeMcpStatus(status) {
    const s = (status || 'unknown').toLowerCase();
    if (s === 'connected') return 'connected';
    if (s === 'connecting') return 'connecting';
    return 'disconnected';
  }

  function renderPluginCard(plugin) {
    const card = document.createElement('div');
    card.className = 'plugin-card';
    card.setAttribute('data-plugin-id', escapeHtml(plugin.name));

    const header = document.createElement('div');
    header.className = 'plugin-header';

    const nameEl = document.createElement('div');
    nameEl.className = 'plugin-name';
    nameEl.textContent = plugin.name;

    const toggle = document.createElement('div');
    toggle.className = `plugin-toggle ${plugin.enabled ? 'active' : ''}`;
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(plugin.enabled));
    toggle.setAttribute('aria-label', `Toggle ${plugin.name}`);
    toggle.tabIndex = 0;

    toggle.addEventListener('click', async () => {
      if (!window.pathey || !window.pathey.plugins) return;
      toggle.disabled = true;
      try {
        const result = await window.pathey.plugins.toggle(plugin.name);
        if (result && result.ok) {
          plugin.enabled = result.enabled;
          toggle.className = `plugin-toggle ${plugin.enabled ? 'active' : ''}`;
          toggle.setAttribute('aria-checked', String(plugin.enabled));
        }
      } catch (err) {
        console.warn('[Plugins] Toggle failed:', err.message);
      } finally {
        toggle.disabled = false;
      }
    });

    toggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle.click();
      }
    });

    header.appendChild(nameEl);
    header.appendChild(toggle);

    const desc = document.createElement('div');
    desc.className = 'plugin-desc';
    desc.textContent = plugin.description || '';

    const toolsList = document.createElement('div');
    toolsList.className = 'plugin-tools-list';

    if (plugin.tools && plugin.tools.length > 0) {
      plugin.tools.forEach(tool => {
        const item = document.createElement('div');
        item.className = 'plugin-tool-item';

        const toolName = document.createElement('span');
        toolName.textContent = tool.name;

        const riskBadge = document.createElement('span');
        riskBadge.className = `risk-badge ${normalizeRisk(tool.risk)}`;
        riskBadge.textContent = normalizeRisk(tool.risk);

        item.appendChild(toolName);
        item.appendChild(riskBadge);
        toolsList.appendChild(item);
      });
    } else {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No tools exposed';
      toolsList.appendChild(empty);
    }

    card.appendChild(header);
    card.appendChild(desc);
    card.appendChild(toolsList);
    return card;
  }

  function renderMcpServer(server) {
    const item = document.createElement('div');
    item.className = 'mcp-server-item';

    const info = document.createElement('div');
    info.className = 'mcp-server-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'mcp-server-name';
    nameEl.textContent = server.name;

    const transportEl = document.createElement('div');
    transportEl.className = 'mcp-server-transport';
    transportEl.textContent = server.transport || 'stdio';

    info.appendChild(nameEl);
    info.appendChild(transportEl);

    const statusEl = document.createElement('div');
    statusEl.className = 'mcp-server-status';
    const status = normalizeMcpStatus(server.connected ? 'connected' : 'disconnected');
    statusEl.classList.add(status);
    statusEl.textContent = status === 'connected' ? '● Connected' : (status === 'connecting' ? '◐ Connecting' : '○ Disconnected');

    const toggle = document.createElement('div');
    toggle.className = `mcp-toggle ${server.connected ? 'active' : ''}`;
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(server.connected));
    toggle.setAttribute('aria-label', `Toggle ${server.name} MCP server`);
    toggle.tabIndex = 0;

    toggle.addEventListener('click', async () => {
      if (!window.pathey || !window.pathey.mcp) return;
      const next = !server.connected;
      toggle.disabled = true;
      try {
        const result = await window.pathey.mcp.toggleServer(server.name, next);
        if (result && result.ok) {
          server.connected = next;
          toggle.className = `mcp-toggle ${server.connected ? 'active' : ''}`;
          toggle.setAttribute('aria-checked', String(server.connected));
          statusEl.className = 'mcp-server-status';
          const newStatus = normalizeMcpStatus(server.connected ? 'connected' : 'disconnected');
          statusEl.classList.add(newStatus);
          statusEl.textContent = newStatus === 'connected' ? '● Connected' : (newStatus === 'connecting' ? '◐ Connecting' : '○ Disconnected');
        }
      } catch (err) {
        console.warn('[MCP] Toggle failed:', err.message);
      } finally {
        toggle.disabled = false;
      }
    });

    toggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle.click();
      }
    });

    item.appendChild(info);
    item.appendChild(statusEl);
    item.appendChild(toggle);
    return item;
  }

  function render() {
    const container = document.getElementById('plugins-list');
    const mcpContainer = document.getElementById('mcp-servers-list');
    if (!container) return;

    if (loading) {
      container.innerHTML = '<div class="loading-state">Loading plugins...</div>';
      return;
    }

    if (plugins.length === 0) {
      container.innerHTML = '<div class="empty-state">No plugins installed</div>';
      return;
    }

    container.innerHTML = '';
    plugins.forEach(p => container.appendChild(renderPluginCard(p)));

    // Render MCP servers
    if (mcpContainer) {
      if (mcpLoading) {
        mcpContainer.innerHTML = '<div class="loading-state">Loading MCP servers...</div>';
        return;
      }

      if (mcpServers.length === 0) {
        mcpContainer.innerHTML = '<div class="empty-state">No MCP servers configured</div>';
        return;
      }

      mcpContainer.innerHTML = '';
      mcpServers.forEach(s => mcpContainer.appendChild(renderMcpServer(s)));
    }
  }

  async function loadPlugins() {
    if (!window.pathey || !window.pathey.plugins) {
      render();
      return;
    }
    loading = true;
    render();
    try {
      plugins = await window.pathey.plugins.list();
    } catch (err) {
      console.warn('[Plugins] Failed to load plugin list:', err.message);
      const container = document.getElementById('plugins-list');
      if (container) container.innerHTML = '<div class="error-state">Plugin load error</div>';
    } finally {
      loading = false;
      render();
    }
  }

  async function loadMcpServers() {
    if (!window.pathey || !window.pathey.mcp) {
      render();
      return;
    }
    mcpLoading = true;
    render();
    try {
      const servers = await window.pathey.mcp.getServers();
      // Also get status for each server
      const status = await window.pathey.mcp.getStatus();
      const statusMap = {};
      status.servers.forEach(s => { statusMap[s.name] = s; });
      mcpServers = servers.map(s => ({ ...s, ...statusMap[s.name] }));
    } catch (err) {
      console.warn('[MCP] Failed to load server list:', err.message);
      const container = document.getElementById('mcp-servers-list');
      if (container) container.innerHTML = '<div class="error-state">MCP server load error</div>';
    } finally {
      mcpLoading = false;
      render();
    }
  }

  function initPlugins() {
    loadPlugins();
    loadMcpServers();
    setInterval(loadPlugins, 30000);
    setInterval(loadMcpServers, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlugins);
  } else {
    initPlugins();
  }
})();
