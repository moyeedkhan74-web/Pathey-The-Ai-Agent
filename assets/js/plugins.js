// assets/js/plugins.js - Plugins Panel Controller

(function () {
  let plugins = [];
  let mcpServers = [];
  let loading = false;
  let mcpLoading = false;

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

    const actions = document.createElement('div');
    actions.className = 'mcp-server-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'mcp-action-btn';
    editBtn.setAttribute('title', 'Edit server');
    editBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M9 15l7-7"/></svg>';
    editBtn.addEventListener('click', () => {
      if (!window.pathey || !window.pathey.mcp) return;
      editMcpServer(server.name);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'mcp-action-btn delete';
    deleteBtn.setAttribute('title', 'Delete server');
    deleteBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    deleteBtn.addEventListener('click', () => {
      if (!window.pathey || !window.pathey.mcp) return;
showConfirm(
        'Delete MCP Server',
        'Are you sure you want to delete the MCP server "' + server.name + '"? This action cannot be undone.',
        async () => {
          try {
            const result = await window.pathey.mcp.removeServer(server.name);
            if (result && result.ok) {
              mcpServers = mcpServers.filter(s => s.name !== server.name);
              render();
            }
          } catch (err) {
            console.warn('[MCP] Delete failed:', err.message);
          }
        }
      );
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(info);
    item.appendChild(statusEl);
    item.appendChild(toggle);
    item.appendChild(actions);

    const toolsAccordion = document.createElement('div');
    toolsAccordion.className = 'mcp-tools-accordion';

    const toolsHeader = document.createElement('div');
    toolsHeader.className = 'mcp-tools-header';
    const toolsCount = (server.tools && server.tools.length) || 0;
    toolsHeader.innerHTML = '<span>Tools (' + toolsCount + ')</span>' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="collapse-icon"><polyline points="18 15 12 9 6 15"/></svg>';

    const toolsList = document.createElement('div');
    toolsList.className = 'mcp-tools-list';

    if (server.tools && server.tools.length > 0) {
      server.tools.forEach(tool => {
        const toolItem = document.createElement('div');
        toolItem.className = 'mcp-tool-item';

        const toolName = document.createElement('div');
        toolName.className = 'mcp-tool-item-name';
        toolName.textContent = tool.name;

        const toolDesc = document.createElement('div');
        toolDesc.className = 'mcp-tool-item-desc';
        toolDesc.textContent = tool.description || '';

        toolItem.appendChild(toolName);
        toolItem.appendChild(toolDesc);
        toolsList.appendChild(toolItem);
      });
    }

    toolsAccordion.appendChild(toolsHeader);
    toolsAccordion.appendChild(toolsList);

    toolsHeader.addEventListener('click', () => {
      toolsList.classList.toggle('visible');
      toolsHeader.classList.toggle('collapsed');
    });

    item.appendChild(toolsAccordion);
    return item;
  }

  function render() {
    const container = document.getElementById('plugins-list');
    const mcpContainer = document.getElementById('mcp-servers-list');
    const mcpCountEl = document.getElementById('mcp-count');

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

    if (mcpCountEl) {
      mcpCountEl.textContent = `${mcpServers.length} ${mcpServers.length === 1 ? 'server' : 'servers'}`;
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

  // Modal and UI handlers
  function showConfirm(title, message, onConfirm) {
    const overlay = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const allowBtn = document.getElementById('confirm-allow');

    if (overlay && titleEl && messageEl && allowBtn) {
      titleEl.textContent = title;
      messageEl.textContent = message;
      overlay.style.display = 'flex';

      const onConfirmClick = () => {
        onConfirm();
        overlay.style.display = 'none';
        allowBtn.removeEventListener('click', onConfirmClick);
      };
      allowBtn.addEventListener('click', onConfirmClick);

      const denyBtn = document.getElementById('confirm-deny');
      const denyClick = () => {
        overlay.style.display = 'none';
        denyBtn.removeEventListener('click', denyClick);
        allowBtn.removeEventListener('click', onConfirmClick);
      };
      denyBtn.addEventListener('click', denyClick);

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.style.display = 'none';
          denyBtn.removeEventListener('click', denyClick);
          allowBtn.removeEventListener('click', onConfirmClick);
        }
      });
    }
  }

  function editMcpServer(name) {
    if (!window.pathey || !window.pathey.mcp) return;
    window.pathey.mcp.getServers().then(servers => {
      const server = servers.find(s => s.name === name);
      if (!server) return;

      // Populate modal with server data
      document.getElementById('mcp-modal-title').textContent = 'Edit MCP Server';
      document.getElementById('mcp-name').value = server.name || '';
      document.getElementById('mcp-name').disabled = true;
      document.getElementById('mcp-transport').value = server.transport || 'stdio';
      document.getElementById('mcp-command').value = server.command || '';
      document.getElementById('mcp-args').value = server.args ? server.args.join(' ') : '';
      document.getElementById('mcp-env').value = server.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join(', ') : '';

      // Show modal
      const modal = document.getElementById('mcp-modal');
      if (modal) {
        modal.style.display = 'flex';
        // Focus first input
        setTimeout(() => document.getElementById('mcp-command')?.focus(), 100);
      }
    });
  }

  function openMcpModal() {
    document.getElementById('mcp-modal-title').textContent = 'Add MCP Server';
    const inputs = ['mcp-name', 'mcp-transport', 'mcp-command', 'mcp-args', 'mcp-env'];
    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('mcp-name').disabled = false;

    const modal = document.getElementById('mcp-modal');
    if (modal) {
      modal.style.display = 'flex';
      setTimeout(() => document.getElementById('mcp-name')?.focus(), 100);
    }
  }

  function closeMcpModal() {
    const modal = document.getElementById('mcp-modal');
    if (modal) modal.style.display = 'none';
  }

  function saveMcpServer() {
    if (!window.pathey || !window.pathey.mcp) return;

    const serverName = document.getElementById('mcp-name').value.trim();
    const transport = document.getElementById('mcp-transport').value;
    const command = document.getElementById('mcp-command').value.trim();
    const argsText = document.getElementById('mcp-args').value.trim();
    const envText = document.getElementById('mcp-env').value.trim();

    if (!serverName) {
      alert('Server name is required');
      return;
    }
    if (!command) {
      alert('Command is required');
      return;
    }

    const serverConfig = {
      name: serverName,
      transport,
      command,
      args: argsText ? argsText.split(' ').filter(Boolean) : [],
      env: {},
      enabled: true
    };

    if (envText) {
      try {
        envText.split(',')
          .map(pair => pair.trim())
          .filter(pair => pair.includes('='))
          .forEach(pair => {
            const [key, ...values] = pair.split('=');
            serverConfig.env[key.trim()] = values.join('=').trim();
          });
      } catch (err) {
        console.warn('[MCP] Failed to parse env vars:', err.message);
      }
    }

    window.pathey.mcp.addServer(serverConfig).then(result => {
      if (result && result.ok) {
        loadMcpServers();
        closeMcpModal();
      } else {
        console.error('[MCP] Failed to add server:', result?.error);
      }
    }).catch(err => {
      console.error('[MCP] Error adding server:', err);
    });
  }

  function renderPresets(presets) {
    const listEl = document.getElementById('mcp-presets-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    if (presets && presets.length > 0) {
      presets.forEach(preset => {
        const chip = document.createElement('button');
        chip.className = 'mcp-preset-chip';
        chip.textContent = preset.name;
        chip.addEventListener('click', () => {
          if (!window.pathey || !window.pathey.mcp) return;

          window.pathey.mcp.getServers().then(servers => {
            const exists = servers.some(s => s.name === preset.name);
            if (exists) {
              // If already exists, toggle it instead of adding
              const server = servers.find(s => s.name === preset.name);
              const nextState = !(server && server.connected);
              window.pathey.mcp.toggleServer(preset.name, nextState).then(result => {
                if (result && result.ok) {
                  loadMcpServers();
                }
              });
            } else {
              // Add preset
              window.pathey.mcp.addPreset(preset.name).then(result => {
                if (result && result.ok) {
                  loadMcpServers();
                }
              });
            }
          });
        });
        listEl.appendChild(chip);
      });
    } else {
      const empty = document.createElement('div');
      empty.textContent = 'No presets available';
      empty.style.padding = '8px';
      empty.style.color = 'var(--text-dim);';
      listEl.appendChild(empty);
    }
  }

  // Initialization
  function initPlugins() {
    // Modal event listeners
    const addBtn = document.getElementById('mcp-add-btn');
    const closeBtn = document.getElementById('mcp-modal-close');
    const cancelBtn = document.getElementById('mcp-cancel');
    const saveBtn = document.getElementById('mcp-save');
    const modal = document.getElementById('mcp-modal');

    if (addBtn) {
      addBtn.addEventListener('click', openMcpModal);
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', closeMcpModal);
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', closeMcpModal);
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', saveMcpServer);
    }
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeMcpModal();
      });
    }

    // Presets dropdown
    const presetsBtn = document.getElementById('mcp-presets-btn');
    if (presetsBtn) {
      presetsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const list = document.getElementById('mcp-presets-list');
        if (list) list.style.display = list.style.display === 'block' ? 'none' : 'block';
      });
    }

    // Load presets
    if (window.pathey && window.pathey.mcp) {
      window.pathey.mcp.getStatus().then(status => {
        if (status.servers && status.servers.length > 0) {
          const presetNames = status.servers.map(s => s.name);
          const defaultPresets = ['Filesystem', 'Fetch & Web', 'Memory Graph', 'SQLite', 'GitHub'];
          const available = defaultPresets.filter(p => presetNames.includes(p));
          renderPresets(available);
        }
      }).catch(err => {
        console.warn('[MCP] Failed to load presets:', err.message);
        renderPresets([]);
      });
    }

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

