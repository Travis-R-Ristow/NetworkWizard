class NetworkWizardPanel {
  constructor() {
    this.isRecording = true;
    this.calls = new Map();
    this.overrides = new Map();
    this.expandedCall = null;
    this.expandedTables = new Set();
    this.activeTab = 'headers';
    this.filters = { search: '', type: 'all', methods: new Set(), status: 'all' };
    this.knownMethods = new Set(['GET', 'POST', 'PUT', 'DELETE']);
    this.events = [];
    this.maxEvents = 5;
    this.tabId = chrome.devtools.inspectedWindow.tabId;
    this.debuggerAttached = false;
    this.drawerExpanded = false;
    this.elements = {
      clearBtn: document.getElementById('clearBtn'),
      recordToggle: document.getElementById('recordToggle'),
      searchInput: document.getElementById('searchInput'),
      filterBar: document.querySelector('.filter-bar'),
      statusText: document.getElementById('statusText'),
      statusDrawer: document.getElementById('statusDrawer'),
      statusDrawerToggle: document.getElementById('statusDrawerToggle'),
      eventList: document.getElementById('eventList'),
      networkBody: document.getElementById('networkBody'),
      emptyState: document.getElementById('emptyState'),
      methodFilter: document.getElementById('methodFilter')
    };
    this.bindEvents();
    this.renderMethodFilter();
    this.startCapture();
    this.addEvent('info', 'NetworkWizard initialized');
  }

  bindEvents() {
    this.elements.clearBtn.addEventListener('click', () => this.clear());
    this.elements.recordToggle.addEventListener('change', (e) => this.toggleRecording(e.target.checked));
    this.elements.statusDrawerToggle.addEventListener('click', () => this.toggleDrawer());
    this.elements.networkBody.addEventListener('click', (e) => this.handleTableClick(e));
    this.elements.searchInput.addEventListener('input', (e) => this.updateFilter('search', e.target.value));
    this.elements.filterBar.addEventListener('click', (e) => this.handleFilterClick(e));
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.kebab-menu')) {
        document.querySelectorAll('.kebab-menu.open').forEach(m => m.classList.remove('open'));
      }
      if (!e.target.closest('.chip-add-menu')) {
        document.querySelectorAll('.chip-add-menu.open').forEach(m => m.classList.remove('open'));
      }
    });
  }

  handleFilterClick(e) {
    const addBtn = e.target.closest('.chip-add-btn');
    if (addBtn) {
      e.stopPropagation();
      if (addBtn.classList.contains('disabled')) {
        return;
      }
      const menu = addBtn.closest('.chip-add-menu');
      menu.classList.toggle('open');
      return;
    }

    const chipRemove = e.target.closest('.chip-remove');
    if (chipRemove) {
      this.updateFilter(chipRemove.dataset.filter, chipRemove.dataset.value);
      return;
    }

    const addOption = e.target.closest('.chip-add-option');
    if (addOption) {
      this.updateFilter(addOption.dataset.filter, addOption.dataset.value);
      return;
    }

    const btn = e.target.closest('.filter-btn');
    if (!btn) {
      return;
    }

    const filterType = btn.dataset.filter;
    const value = btn.dataset.value;

    btn.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    this.updateFilter(filterType, value);
  }

  updateFilter(filterType, value) {
    if (filterType === 'method') {
      this.toggleMethodFilter(value);
      return;
    }
    this.filters[filterType] = value;
    this.renderCalls();
  }

  toggleMethodFilter(value) {
    if (value === 'all') {
      this.filters.methods.clear();
    } else if (this.filters.methods.has(value)) {
      this.filters.methods.delete(value);
    } else {
      if (value === 'NOT_OPTIONS') {
        this.filters.methods.delete('OPTIONS');
      } else if (value === 'OPTIONS') {
        this.filters.methods.delete('NOT_OPTIONS');
      }
      this.filters.methods.add(value);
    }
    this.renderMethodFilter();
    this.renderCalls();
  }

  renderMethodFilter() {
    const methods = Array.from(this.knownMethods).sort();
    const selected = this.filters.methods;

    let html = '<span class="filter-label">Method:</span>';

    if (selected.size === 0) {
      html += '<span class="filter-chip muted">All</span>';
    } else {
      html += Array.from(selected).map(m =>
        `<span class="filter-chip"><span class="chip-text">${m === 'NOT_OPTIONS' ? '!OPTIONS' : m}</span><button class="chip-remove" data-filter="method" data-value="${m}">×</button></span>`
      ).join('');
    }

    const available = methods.filter(m => !selected.has(m));
    const showNotOptions = this.knownMethods.has('OPTIONS') && !selected.has('NOT_OPTIONS');
    const hasOptions = available.length > 0 || showNotOptions;

    html += `<div class="chip-add-menu">
      <button class="chip-add-btn${hasOptions ? '' : ' disabled'}">+</button>
      ${hasOptions ? `<div class="chip-add-dropdown">
        ${showNotOptions ? '<button class="chip-add-option" data-filter="method" data-value="NOT_OPTIONS">!OPTIONS</button>' : ''}
        ${available.map(m => `<button class="chip-add-option" data-filter="method" data-value="${m}">${m}</button>`).join('')}
      </div>` : ''}
    </div>`;

    this.elements.methodFilter.innerHTML = html;
  }

  getFilteredCalls() {
    const filtered = [];
    this.calls.forEach((call, key) => {
      if (this.filters.type !== 'all' && call.type !== this.filters.type) {
        return;
      }
      if (this.filters.methods.size > 0) {
        if (this.filters.methods.has('NOT_OPTIONS')) {
          if (call.method === 'OPTIONS') {
            return;
          }
        } else if (!this.filters.methods.has(call.method)) {
          return;
        }
      }
      if (this.filters.status === 'success' && call.hasError) {
        return;
      }
      if (this.filters.status === 'error' && !call.hasError) {
        return;
      }
      if (this.filters.search) {
        const searchLower = this.filters.search.toLowerCase();
        const matchesName = call.callName.toLowerCase().includes(searchLower);
        const matchesUrl = call.fullUrl?.toLowerCase().includes(searchLower);
        if (!matchesName && !matchesUrl) {
          return;
        }
      }
      filtered.push([key, call]);
    });
    return filtered;
  }

  startCapture() {
    chrome.devtools.network.getHAR((har) => {
      har.entries.forEach((entry) => this.processEntry(entry));
      this.addEvent('info', `Loaded ${har.entries.length} previous requests`);
    });

    chrome.devtools.network.onRequestFinished.addListener((entry) => {
      if (!this.isRecording) {
        return;
      }
      this.processEntry(entry);
    });

    chrome.devtools.network.onNavigated.addListener(() => {
      this.calls.clear();
      this.expandedCall = null;
      this.renderCalls();
      this.addEvent('info', 'Page reloaded - cleared calls');
    });

    this.updateStatus('Recording');
    this.addEvent('success', 'Network capture started');
  }

  processEntry(entry) {
    const { request, response } = entry;
    const url = this.stripQueryParams(request.url);
    const isGql = url.includes('/graphql');
    const gqlOperation = isGql ? this.extractGqlOperation(request.postData?.text) : null;
    const callName = gqlOperation || url;
    const callKey = gqlOperation ? `gql:${gqlOperation}` : `rest:${url}`;

    const method = request.method;
    const methodAdded = !this.knownMethods.has(method);
    if (methodAdded) {
      this.knownMethods.add(method);
      this.renderMethodFilter();
    }

    const callData = {
      type: isGql ? 'GQL' : 'REST',
      callName,
      method,
      fullUrl: request.url,
      status: response.status,
      statusText: response.statusText,
      hasError: response.status >= 400,
      requestHeaders: this.headersToObject(request.headers),
      responseHeaders: this.headersToObject(response.headers),
      requestBody: request.postData?.text || null,
      mimeType: response.content?.mimeType,
      entry
    };

    if (isGql && response.status === 200) {
      entry.getContent((body) => {
        callData.responseBody = body;
        this.checkGqlErrors(callData, body);
        this.calls.set(callKey, callData);
        this.renderCalls();
      });
    } else {
      this.calls.set(callKey, callData);
      if (this.expandedCall === callKey) {
        this.fetchResponseBody(callKey);
      }
      this.renderCalls();
    }
  }

  headersToObject(headers) {
    if (!headers) {
      return {};
    }
    return headers.reduce((obj, h) => ({ ...obj, [h.name]: h.value }), {});
  }

  checkGqlErrors(callData, body) {
    try {
      const parsed = JSON.parse(body);
      if (parsed.errors?.length > 0) {
        callData.hasError = true;
        callData.status = '200 (GQL Error)';
      }
    } catch (e) {}
  }

  handleTableClick(e) {
    const tab = e.target.closest('.details-tab');
    if (tab) {
      e.stopPropagation();
      this.switchTab(tab.dataset.tab);
      return;
    }

    const headersToggle = e.target.closest('.headers-toggle-btn');
    if (headersToggle) {
      e.stopPropagation();
      this.toggleHeadersTable(headersToggle.dataset.tableId);
      return;
    }

    const cardHeader = e.target.closest('.details-card-header[data-table-id]');
    if (cardHeader) {
      e.stopPropagation();
      this.toggleHeadersTable(cardHeader.dataset.tableId);
      return;
    }

    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
      e.stopPropagation();
      this.copyContent(copyBtn.dataset.copy, copyBtn.dataset.key);
      return;
    }

    const kebabBtn = e.target.closest('.kebab-btn');
    if (kebabBtn) {
      e.stopPropagation();
      this.toggleKebabMenu(kebabBtn);
      return;
    }

    const kebabOption = e.target.closest('.kebab-option');
    if (kebabOption) {
      e.stopPropagation();
      this.handleKebabAction(kebabOption.dataset.action, kebabOption.dataset.key);
      return;
    }

    if (e.target.closest('.btn')) {
      return;
    }

    const row = e.target.closest('.call-row');
    if (row) {
      this.toggleCallExpansion(row.dataset.callKey);
    }
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll('.details-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.details-panel').forEach(p => {
      p.classList.toggle('active', p.dataset.panel === tabName);
    });
  }

  toggleHeadersTable(tableId) {
    if (this.expandedTables.has(tableId)) {
      this.expandedTables.delete(tableId);
    } else {
      this.expandedTables.add(tableId);
    }
    this.renderCalls();
  }

  copyContent(type, callKey) {
    const call = this.calls.get(callKey);
    if (!call) {
      return;
    }

    let content = '';
    if (type === 'request') {
      content = call.requestBody || '';
    } else if (type === 'response') {
      content = call.responseBody || '';
    }

    this.copyToClipboard(content, `${type} body`);
  }

  toggleKebabMenu(btn) {
    const menu = btn.closest('.kebab-menu');
    const wasOpen = menu.classList.contains('open');

    document.querySelectorAll('.kebab-menu.open').forEach(m => m.classList.remove('open'));

    if (!wasOpen) {
      menu.classList.add('open');
    }
  }

  handleKebabAction(action, callKey) {
    document.querySelectorAll('.kebab-menu.open').forEach(m => m.classList.remove('open'));

    if (action === 'copy-curl') {
      this.copyCurl(callKey);
    }
  }

  copyCurl(callKey) {
    const call = this.calls.get(callKey);
    if (!call) {
      return;
    }

    let curl = `curl '${call.fullUrl}'`;

    if (call.method !== 'GET') {
      curl += ` -X ${call.method}`;
    }

    Object.entries(call.requestHeaders).forEach(([name, value]) => {
      curl += ` -H '${name}: ${value.replace(/'/g, "'\\''")}'`;
    });

    if (call.requestBody) {
      curl += ` --data-raw '${call.requestBody.replace(/'/g, "'\\''")}'`;
    }

    this.copyToClipboard(curl, 'cURL');
  }

  copyToClipboard(text, label) {
    navigator.clipboard.writeText(text).then(() => {
      this.addEvent('success', `Copied ${label} to clipboard`);
    }).catch(() => {
      this.addEvent('error', `Failed to copy ${label}`);
    });
  }

  toggleCallExpansion(callKey) {
    const wasExpanded = this.expandedCall === callKey;
    this.expandedCall = wasExpanded ? null : callKey;

    if (!wasExpanded) {
      this.fetchResponseBody(callKey);
    }
    this.renderCalls();
  }

  fetchResponseBody(callKey) {
    const call = this.calls.get(callKey);
    if (!call || call.responseBody !== undefined) {
      return;
    }

    call.entry.getContent((body) => {
      call.responseBody = body;
      this.renderCalls();
    });
  }

  toggleDrawer() {
    this.drawerExpanded = !this.drawerExpanded;
    this.elements.statusDrawer.classList.toggle('collapsed', !this.drawerExpanded);
    this.elements.statusDrawer.classList.toggle('expanded', this.drawerExpanded);
  }

  addEvent(type, message) {
    this.events.unshift({ type, message, time: new Date() });
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }
    this.renderEvents();
  }

  renderEvents() {
    const icons = { info: '●', success: '✓', warning: '⚠', error: '✕' };
    const colors = { info: 'text-muted', success: 'text-success', warning: 'text-warning', error: 'text-error' };

    this.elements.eventList.innerHTML = this.events.map(event => `
      <li class="event-item">
        <span class="event-time">${event.time.toLocaleTimeString()}</span>
        <span class="event-icon ${colors[event.type]}">${icons[event.type]}</span>
        <span class="event-message">${this.escapeHtml(event.message)}</span>
      </li>
    `).join('');
  }

  attachDebugger() {
    if (this.debuggerAttached) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId: this.tabId }, '1.3', () => {
        if (chrome.runtime.lastError) {
          this.addEvent('error', 'Debugger attach failed: ' + chrome.runtime.lastError.message);
          reject(chrome.runtime.lastError);
          return;
        }

        this.debuggerAttached = true;
        this.addEvent('success', 'Debugger attached for interception');

        chrome.debugger.sendCommand({ tabId: this.tabId }, 'Fetch.enable', {
          patterns: [{ requestStage: 'Response' }]
        }, () => {
          if (chrome.runtime.lastError) {
            this.addEvent('error', 'Fetch enable failed');
            reject(chrome.runtime.lastError);
            return;
          }
          resolve();
        });

        chrome.debugger.onDetach.addListener((source, reason) => {
          if (source.tabId === this.tabId) {
            this.debuggerAttached = false;
            this.overrides.clear();
            this.addEvent('warning', 'Debugger detached: ' + reason);
            this.renderCalls();
          }
        });
      });
    });
  }

  detachDebugger() {
    if (this.debuggerAttached) {
      chrome.debugger.detach({ tabId: this.tabId });
      this.debuggerAttached = false;
      this.addEvent('info', 'Debugger detached');
    }
  }

  stripQueryParams(url) {
    const idx = url.indexOf('?');
    return idx === -1 ? url : url.substring(0, idx);
  }

  extractGqlOperation(postData) {
    if (!postData) {
      return null;
    }
    try {
      const data = JSON.parse(postData);
      if (data.operationName) {
        return data.operationName;
      }
      const match = (data.query || '').match(/(?:query|mutation|subscription)\s+(\w+)/);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  renderCalls() {
    const { networkBody, emptyState } = this.elements;
    const filtered = this.getFilteredCalls();

    if (filtered.length === 0) {
      networkBody.innerHTML = '';
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';
    const rows = [];

    filtered.forEach(([key, call]) => {
      const isExpanded = this.expandedCall === key;
      const badgeClass = call.type === 'GQL' ? 'badge-gql' : 'badge-rest';
      const statusClass = call.hasError ? 'text-error' : 'text-success';

      rows.push(`
        <tr class="call-row${isExpanded ? ' expanded' : ''}" data-call-key="${this.escapeHtml(key)}">
          <td><span class="expand-icon">▶</span> <span class="badge ${badgeClass}">${call.type}</span></td>
          <td class="method-cell">${call.method}</td>
          <td class="call-name">${this.escapeHtml(call.callName)}</td>
          <td><span class="font-semibold ${statusClass}">${call.status}</span></td>
          <td class="actions-cell">
            <button class="btn btn-sm btn-primary" data-action="override" data-key="${this.escapeHtml(key)}">Override</button>
            <button class="btn btn-sm btn-danger" data-action="block" data-key="${this.escapeHtml(key)}">Block</button>
            <div class="kebab-menu">
              <button class="kebab-btn" data-key="${this.escapeHtml(key)}">⋮</button>
              <div class="kebab-dropdown">
                <button class="kebab-option" data-action="copy-curl" data-key="${this.escapeHtml(key)}">Copy cURL</button>
              </div>
            </div>
          </td>
        </tr>
      `);

      if (isExpanded) {
        rows.push(`<tr class="call-details visible"><td colspan="5">${this.renderCallDetails(call, key)}</td></tr>`);
      }
    });

    networkBody.innerHTML = rows.join('');
  }

  renderCallDetails(call, callKey) {
    const requestHeaders = this.renderHeaders(call.requestHeaders, `${callKey}-req`);
    const responseHeaders = this.renderHeaders(call.responseHeaders, `${callKey}-res`);
    const requestBody = this.formatBody(call.requestBody);
    const responseBody = call.responseBody === undefined
      ? '<span class="text-muted">Loading...</span>'
      : this.formatBody(call.responseBody);

    const statusClass = call.hasError ? 'text-error' : 'text-success';

    return `
      <div class="details-content">
        <nav class="details-tabs">
          <button class="details-tab${this.activeTab === 'headers' ? ' active' : ''}" data-tab="headers">Headers</button>
          <button class="details-tab${this.activeTab === 'request' ? ' active' : ''}" data-tab="request">Request</button>
          <button class="details-tab${this.activeTab === 'response' ? ' active' : ''}" data-tab="response">Response</button>
        </nav>
        <section class="details-panel${this.activeTab === 'headers' ? ' active' : ''}" data-panel="headers">
          <div class="details-card">
            <div class="details-card-header">General</div>
            <div class="details-card-body">
              <div class="info-grid">
                <span class="info-label">URL</span>
                <span class="info-value">${this.escapeHtml(call.fullUrl || '')}</span>
                <span class="info-label">Method</span>
                <span class="info-value">${this.escapeHtml(call.method || '')}</span>
                <span class="info-label">Status</span>
                <span class="info-value ${statusClass}">${call.status} ${this.escapeHtml(call.statusText || '')}</span>
              </div>
            </div>
          </div>
          <div class="details-card">
            <div class="details-card-header clickable" data-table-id="${callKey}-req">Request Headers</div>
            <div class="details-card-body">${requestHeaders}</div>
          </div>
          <div class="details-card">
            <div class="details-card-header clickable" data-table-id="${callKey}-res">Response Headers</div>
            <div class="details-card-body">${responseHeaders}</div>
          </div>
        </section>
        <section class="details-panel${this.activeTab === 'request' ? ' active' : ''}" data-panel="request">
          <div class="panel-toolbar">
            <button class="btn btn-sm btn-secondary copy-btn" data-copy="request" data-key="${callKey}">Copy</button>
          </div>
          <pre class="details-code">${requestBody}</pre>
        </section>
        <section class="details-panel${this.activeTab === 'response' ? ' active' : ''}" data-panel="response">
          <div class="panel-toolbar">
            <button class="btn btn-sm btn-secondary copy-btn" data-copy="response" data-key="${callKey}">Copy</button>
          </div>
          <pre class="details-code">${responseBody}</pre>
        </section>
      </div>
    `;
  }

  renderHeaders(headers, tableId) {
    if (!headers || Object.keys(headers).length === 0) {
      return '<div class="text-muted" style="padding: 8px 16px;">No headers</div>';
    }

    const entries = Object.entries(headers);
    const maxVisible = 7;
    const needsCollapse = entries.length > maxVisible;
    const isExpanded = this.expandedTables?.has(tableId);

    const visibleEntries = needsCollapse && !isExpanded ? entries.slice(0, maxVisible) : entries;
    const hiddenCount = entries.length - maxVisible;

    let html = `<table class="headers-table" data-table-id="${tableId}">`;
    html += visibleEntries
      .map(([name, value]) => `<tr><td class="header-name">${this.escapeHtml(name)}</td><td class="header-value">${this.escapeHtml(value)}</td></tr>`)
      .join('');

    if (needsCollapse) {
      if (isExpanded) {
        html += `<tr class="headers-toggle"><td colspan="2"><button class="headers-toggle-btn" data-table-id="${tableId}">Show less</button></td></tr>`;
      } else {
        html += `<tr class="headers-toggle"><td colspan="2"><button class="headers-toggle-btn" data-table-id="${tableId}">Show ${hiddenCount} more...</button></td></tr>`;
      }
    }

    html += '</table>';
    return html;
  }

  formatBody(body) {
    if (!body) {
      return '<span class="text-muted">No body</span>';
    }
    try {
      return this.escapeHtml(JSON.stringify(JSON.parse(body), null, 2));
    } catch (e) {
      return this.escapeHtml(body);
    }
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  clear() {
    const count = this.calls.size;
    this.calls.clear();
    this.expandedCall = null;
    this.renderCalls();
    this.updateStatus('Cleared');
    this.addEvent('info', `Cleared ${count} captured calls`);
  }

  toggleRecording(enabled) {
    this.isRecording = enabled;
    this.updateStatus(enabled ? 'Recording' : 'Paused');
    this.addEvent('info', enabled ? 'Recording resumed' : 'Recording paused');
  }

  updateStatus(message) {
    this.elements.statusText.textContent = message;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.networkWizard = new NetworkWizardPanel();
});
