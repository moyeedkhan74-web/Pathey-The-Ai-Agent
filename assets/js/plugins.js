// assets/js/plugins.js - Plugins Panel Controller

(function () {
  let plugins = [];
  let loading = false;

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

  function render() {
    const container = document.getElementById('plugins-list');
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

  function initPlugins() {
    loadPlugins();
    setInterval(loadPlugins, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlugins);
  } else {
    initPlugins();
  }
})();
