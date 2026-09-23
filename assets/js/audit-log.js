// assets/js/audit-log.js - Audit/Activity Log Controller

(function () {
  let loading = false;

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderEntry(entry) {
    const el = document.createElement('div');
    el.className = 'audit-entry';

    const header = document.createElement('div');
    header.className = 'audit-entry-header';

    const action = document.createElement('span');
    action.className = 'audit-action';
    action.textContent = entry.action || 'unknown';

    const time = document.createElement('span');
    time.className = 'audit-time';
    time.textContent = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';

    header.appendChild(action);
    header.appendChild(time);

    if (entry.details) {
      const details = document.createElement('div');
      details.className = 'audit-details';
      details.textContent = entry.details;
      el.appendChild(details);
    }

    const status = document.createElement('span');
    status.className = `audit-status ${entry.status || 'completed'}`;
    status.textContent = entry.status || 'completed';

    el.appendChild(header);
    el.appendChild(status);
    return el;
  }

  async function loadAuditLog() {
    const container = document.getElementById('audit-list');
    if (!container) return;

    if (!window.pathey || !window.pathey.audit) {
      container.innerHTML = '<div class="empty-state">Activity log unavailable.</div>';
      return;
    }

    loading = true;
    container.innerHTML = '<div class="loading-state">Loading activity...</div>';

    try {
      const entries = await window.pathey.audit.getLog(50);
      if (!entries || entries.length === 0) {
        container.innerHTML = '<div class="empty-state">No activity recorded yet.</div>';
        return;
      }
      container.innerHTML = '';
      entries.forEach(e => container.appendChild(renderEntry(e)));
    } catch (err) {
      container.innerHTML = '<div class="error-state">Failed to load activity log.</div>';
    } finally {
      loading = false;
    }
  }

  function initAudit() {
    loadAuditLog();
    setInterval(loadAuditLog, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAudit);
  } else {
    initAudit();
  }
})();
