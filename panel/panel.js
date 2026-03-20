class NetworkWizardPanel {
  constructor() {
    this.isRecording = true;
    this.calls = new Map();
    this.pendingRequests = new Map();
    this.overrides = new Map();
    this.blockedCalls = new Set();
    this.blockedListSnapshot = new Set();
    this.expandedCall = null;
    this.expandedOverride = null;
    this.expandedTables = new Set();
    this.activeTab = 'headers';
    this.overrideHeadersView = new Map();
    this.filters = { search: '', type: 'all', methods: new Set(), status: 'all' };
    this.knownMethods = new Set(['GET', 'POST', 'PUT', 'DELETE']);
    this.events = [];
    this.maxEvents = 5;
    this.tabId = chrome.devtools.inspectedWindow.tabId;
    this.debuggerAttached = false;
    this.drawerExpanded = false;
    this.currentView = 'network';
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
      methodFilter: document.getElementById('methodFilter'),
      headerTabs: document.getElementById('headerTabs'),
      networkView: document.getElementById('networkView'),
      blockedView: document.getElementById('blockedView'),
      blockedList: document.getElementById('blockedList'),
      blockedEmptyState: document.getElementById('blockedEmptyState'),
      overridesView: document.getElementById('overridesView'),
      overridesList: document.getElementById('overridesList'),
      overridesEmptyState: document.getElementById('overridesEmptyState')
    };
    this.bindEvents();
    this.renderMethodFilter();
    this.connectToBackground();
    this.startCapture();
    this.loadBlockedCalls();
    this.loadOverrides();
    this.addEvent('info', 'NetworkWizard initialized');
  }

  loadBlockedCalls() {
    chrome.devtools.inspectedWindow.eval('window.location.origin', (origin) => {
      this.currentOrigin = origin;
      chrome.storage.local.get(['blockedCalls'], (result) => {
        const allBlocked = result.blockedCalls || {};
        const blocked = allBlocked[origin] || [];
        if (blocked.length > 0) {
          this.attachDebugger().then(() => {
            blocked.forEach(key => this.blockedCalls.add(key));
            this.renderCalls();
            this.addEvent('info', `Restored ${blocked.length} blocked call(s)`);
          });
        }
      });
    });
  }

  saveBlockedCalls() {
    if (!this.currentOrigin) {
      return;
    }
    chrome.storage.local.get(['blockedCalls'], (result) => {
      const allBlocked = result.blockedCalls || {};
      if (this.blockedCalls.size > 0) {
        allBlocked[this.currentOrigin] = Array.from(this.blockedCalls);
      } else {
        delete allBlocked[this.currentOrigin];
      }
      chrome.storage.local.set({ blockedCalls: allBlocked });
    });
  }

  loadOverrides() {
    chrome.devtools.inspectedWindow.eval('window.location.origin', (origin) => {
      this.currentOrigin = origin;
      chrome.storage.local.get(['overrides'], (result) => {
        const allOverrides = result.overrides || {};
        const overrides = allOverrides[origin] || [];
        if (overrides.length > 0) {
          this.attachDebugger().then(() => {
            overrides.forEach(o => this.overrides.set(o.key, o));
            this.renderOverridesList();
            this.addEvent('info', `Restored ${overrides.length} override(s)`);
          });
        }
      });
    });
  }

  saveOverrides() {
    if (!this.currentOrigin) {
      return;
    }
    chrome.storage.local.get(['overrides'], (result) => {
      const allOverrides = result.overrides || {};
      if (this.overrides.size > 0) {
        allOverrides[this.currentOrigin] = Array.from(this.overrides.values());
      } else {
        delete allOverrides[this.currentOrigin];
      }
      chrome.storage.local.set({ overrides: allOverrides });
    });
  }

  connectToBackground() {
    try {
      this.port = chrome.runtime.connect({ name: 'networkwizard' });
      this.port.postMessage({ type: 'init', tabId: this.tabId });

      this.port.onMessage.addListener((msg) => {
        if (!this.isRecording) {
          return;
        }

        if (msg.type === 'requestStart') {
          this.addPendingRequest(msg);
        } else if (msg.type === 'requestEnd') {
          this.completePendingRequest(msg.requestId, msg.statusCode);
        } else if (msg.type === 'requestError') {
          this.failPendingRequest(msg.requestId);
        }
      });

      this.port.onDisconnect.addListener(() => {
        this.addEvent('warning', 'Background connection lost');
      });
    } catch (e) {
      this.addEvent('error', 'Failed to connect to background');
    }
  }

  addPendingRequest(msg) {
    const url = this.stripQueryParams(msg.url);
    const isGql = url.includes('/graphql');
    const gqlOperation = isGql ? this.extractGqlOperation(msg.bodyText) : null;
    const callName = gqlOperation || url;
    const callKey = gqlOperation ? `gql:${gqlOperation}` : `rest:${url}`;

    if (this.calls.has(callKey) && !this.calls.get(callKey).pending) {
      return;
    }

    const method = msg.method;
    if (!this.knownMethods.has(method)) {
      this.knownMethods.add(method);
      this.renderMethodFilter();
    }

    this.pendingRequests.set(msg.requestId, callKey);
    this.calls.set(callKey, {
      type: isGql ? 'GQL' : 'REST',
      callName,
      method,
      fullUrl: msg.url,
      status: null,
      statusText: '',
      hasError: false,
      requestHeaders: {},
      responseHeaders: {},
      requestBody: msg.bodyText,
      pending: true
    });

    this.renderCalls();
  }

  completePendingRequest(requestId, statusCode) {
    const callKey = this.pendingRequests.get(requestId);
    if (!callKey) {
      return;
    }

    const call = this.calls.get(callKey);
    if (call && call.pending) {
      call.status = statusCode;
      call.hasError = statusCode >= 400;
      call.pending = false;
      this.renderCalls();
    }

    this.pendingRequests.delete(requestId);
  }

  failPendingRequest(requestId) {
    const callKey = this.pendingRequests.get(requestId);
    if (!callKey) {
      return;
    }

    const call = this.calls.get(callKey);
    if (call && call.pending) {
      call.status = 'Failed';
      call.hasError = true;
      call.pending = false;
    }

    this.pendingRequests.delete(requestId);
    this.renderCalls();
  }

  bindEvents() {
    this.elements.clearBtn.addEventListener('click', () => this.clear());
    this.elements.recordToggle.addEventListener('change', (e) => this.toggleRecording(e.target.checked));
    this.elements.statusDrawerToggle.addEventListener('click', () => this.toggleDrawer());
    this.elements.networkBody.addEventListener('click', (e) => this.handleTableClick(e));
    this.elements.searchInput.addEventListener('input', (e) => this.updateFilter('search', e.target.value));
    this.elements.filterBar.addEventListener('click', (e) => this.handleFilterClick(e));
    this.elements.headerTabs.addEventListener('click', (e) => this.handleHeaderTabClick(e));
    this.elements.blockedList.addEventListener('click', (e) => this.handleBlockedListClick(e));
    this.elements.overridesList.addEventListener('click', (e) => this.handleOverridesListClick(e));
    this.elements.overridesList.addEventListener('input', (e) => this.handleOverridesListInput(e));
    this.elements.overridesList.addEventListener('change', (e) => this.handleOverridesListChange(e));
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.kebab-menu')) {
        document.querySelectorAll('.kebab-menu.open').forEach(m => m.classList.remove('open'));
      }
      if (!e.target.closest('.chip-add-menu')) {
        document.querySelectorAll('.chip-add-menu.open').forEach(m => m.classList.remove('open'));
      }
    });
  }

  handleHeaderTabClick(e) {
    const tab = e.target.closest('.header-tab');
    if (!tab) {
      return;
    }
    this.switchView(tab.dataset.view);
  }

  switchView(view) {
    this.currentView = view;

    this.elements.headerTabs.querySelectorAll('.header-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.view === view);
    });

    this.elements.networkView.classList.toggle('hidden', view !== 'network');
    this.elements.blockedView.classList.toggle('hidden', view !== 'blocked');
    this.elements.overridesView.classList.toggle('hidden', view !== 'overrides');

    if (view === 'blocked') {
      this.blockedListSnapshot = new Set(this.blockedCalls);
      this.renderBlockedList();
    } else if (view === 'overrides') {
      this.renderOverridesList();
    }
  }

  renderBlockedList() {
    const snapshot = this.blockedListSnapshot || new Set();

    if (snapshot.size === 0) {
      this.elements.blockedList.innerHTML = '';
      this.elements.blockedEmptyState.style.display = 'flex';
      return;
    }

    this.elements.blockedEmptyState.style.display = 'none';
    this.elements.blockedList.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Call Name</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${Array.from(snapshot).map(key => {
            const isGql = key.startsWith('gql:');
            const name = key.replace(/^(gql:|rest:)/, '');
            const badgeClass = isGql ? 'badge-gql' : 'badge-rest';
            const isCurrentlyBlocked = this.blockedCalls.has(key);
            const btnClass = isCurrentlyBlocked ? 'btn btn-sm btn-unblock' : 'btn btn-sm btn-danger';
            const btnText = isCurrentlyBlocked ? 'Un-Block' : 'Block';
            const action = isCurrentlyBlocked ? 'unblock' : 'block';
            return `
              <tr>
                <td><span class="badge ${badgeClass}">${isGql ? 'GQL' : 'REST'}</span></td>
                <td class="call-name" title="${this.escapeHtml(name)}">${this.escapeHtml(this.truncateCallName(name))}</td>
                <td>
                  <button class="${btnClass}" data-action="${action}" data-key="${this.escapeHtml(key)}">${btnText}</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  handleBlockedListClick(e) {
    const btn = e.target.closest('.btn[data-action]');
    if (btn && (btn.dataset.action === 'unblock' || btn.dataset.action === 'block')) {
      this.toggleBlock(btn.dataset.key).then(() => {
        this.renderBlockedList();
      });
    }
  }

  renderOverridesList() {
    const pageScrollTop = document.documentElement.scrollTop || document.body.scrollTop;
    const viewScrollTop = this.elements.overridesView.scrollTop;

    const headersScrollPositions = new Map();
    this.elements.overridesList.querySelectorAll('.headers-scroll-area').forEach(el => {
      const key = el.closest('.override-details')?.previousElementSibling?.dataset?.key;
      if (key && el.scrollTop > 0) {
        headersScrollPositions.set(key, el.scrollTop);
      }
    });

    const matchScrollPositions = new Map();
    this.elements.overridesList.querySelectorAll('.match-scroll-area').forEach(el => {
      const key = el.closest('.override-details')?.previousElementSibling?.dataset?.key;
      if (key && el.scrollTop > 0) {
        matchScrollPositions.set(key, el.scrollTop);
      }
    });

    const overrides = Array.from(this.overrides.entries());

    if (overrides.length === 0) {
      this.elements.overridesList.innerHTML = '';
      this.elements.overridesEmptyState.style.display = 'flex';
      return;
    }

    this.elements.overridesEmptyState.style.display = 'none';

    const toolbarHtml = `
      <div class="overrides-toolbar">
        <button class="btn btn-sm btn-secondary" data-action="import-full">Import Override</button>
        <button class="btn btn-sm btn-secondary" data-action="export-all">Export All</button>
      </div>
    `;

    const rows = overrides.map(([key, override]) => {
      const isExpanded = this.expandedOverride === key && !override.deleted;
      const isDeleted = override.deleted === true;
      const badgeClass = override.type === 'GQL' ? 'badge-gql' : 'badge-rest';
      const rowClass = `override-row${isExpanded ? ' expanded' : ''}${isDeleted ? ' deleted' : ''}`;

      let actionsHtml;
      if (isDeleted) {
        actionsHtml = `
          <button class="btn btn-sm btn-unblock" data-action="restore" data-key="${this.escapeHtml(key)}">Restore</button>
          <button class="btn btn-sm btn-danger" data-action="permanent-delete" data-key="${this.escapeHtml(key)}">Remove</button>
        `;
      } else {
        const toggleClass = override.enabled ? 'btn btn-sm btn-unblock' : 'btn btn-sm btn-secondary';
        const toggleText = override.enabled ? 'Enabled' : 'Disabled';
        actionsHtml = `
          <button class="${toggleClass}" data-action="toggle-enabled" data-key="${this.escapeHtml(key)}">${toggleText}</button>
          <button class="btn btn-sm btn-secondary" data-action="export" data-key="${this.escapeHtml(key)}">Export</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-key="${this.escapeHtml(key)}">Delete</button>
        `;
      }

      let rowHtml = `
        <tr class="${rowClass}" data-key="${this.escapeHtml(key)}">
          <td><span class="expand-icon">${isDeleted ? '' : '▶'}</span> <span class="badge ${badgeClass}">${override.type}</span></td>
          <td class="call-name" title="${this.escapeHtml(override.callName)}">${this.escapeHtml(this.truncateCallName(override.callName))}</td>
          <td class="actions-cell">${actionsHtml}</td>
        </tr>
      `;

      if (isExpanded) {
        rowHtml += `<tr class="override-details visible"><td colspan="3">${this.renderOverrideForm(override, key)}</td></tr>`;
      }

      return rowHtml;
    }).join('');

    this.elements.overridesList.innerHTML = `
      ${toolbarHtml}
      <table class="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Call Name</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    headersScrollPositions.forEach((scrollTop, key) => {
      const row = this.elements.overridesList.querySelector(`.override-row[data-key="${key}"]`);
      const scrollArea = row?.nextElementSibling?.querySelector('.headers-scroll-area');
      if (scrollArea) {
        scrollArea.scrollTop = scrollTop;
      }
    });

    matchScrollPositions.forEach((scrollTop, key) => {
      const row = this.elements.overridesList.querySelector(`.override-row[data-key="${key}"]`);
      const scrollArea = row?.nextElementSibling?.querySelector('.match-scroll-area');
      if (scrollArea) {
        scrollArea.scrollTop = scrollTop;
      }
    });

    this.elements.overridesList.querySelectorAll('.override-textarea.auto-size').forEach(textarea => {
      this.autoSizeTextarea(textarea);
    });

    document.documentElement.scrollTop = document.body.scrollTop = pageScrollTop;
    this.elements.overridesView.scrollTop = viewScrollTop;
  }

  autoSizeTextarea(textarea) {
    textarea.style.height = 'auto';
    const maxHeight = window.innerHeight * 0.4;
    const contentHeight = textarea.scrollHeight;
    textarea.style.height = Math.min(contentHeight, maxHeight) + 'px';
  }

  renderOverrideForm(override, key) {
    const headersViewMode = this.overrideHeadersView.get(key) || 'keyvalue';
    const isGql = override.type === 'GQL';

    const matchLabel = isGql ? 'Match Variables' : 'Match Params';
    const matchValue = isGql ? override.matchVariables : override.matchParams;
    const matchEnabled = isGql ? override.matchVariablesEnabled : override.matchParamsEnabled;
    const matchField = isGql ? 'matchVariables' : 'matchParams';

    const matchHtml = isGql
      ? this.renderMatchEditorJson(matchValue, matchField, key)
      : this.renderMatchEditor(matchValue, matchField, key);
    const headersHtml = this.renderHeadersEditor(override.responseHeaders, headersViewMode, key);

    return `
      <div class="override-form">
        <div class="override-section">
          <div class="override-section-header">
            <span class="override-section-title">${matchLabel}</span>
            <label class="override-match-toggle">
              <input type="checkbox" data-field="${matchField}-enabled" data-key="${key}" ${matchEnabled ? 'checked' : ''}>
              <span>Match specific ${isGql ? 'variables' : 'params'}</span>
            </label>
          </div>
          <div class="override-match-content ${!matchEnabled ? 'hidden' : ''}" data-match-content="${key}">
            ${matchHtml}
          </div>
        </div>

        <div class="override-section">
          <div class="override-section-header">
            <span class="override-section-title">Status</span>
          </div>
          <div class="override-status-row">
            <label class="override-field">
              <span class="override-field-label">Code</span>
              <input type="number" class="override-input override-input-sm" data-field="statusCode" data-key="${key}" value="${override.statusCode || ''}" placeholder="200">
            </label>
            <label class="override-field">
              <span class="override-field-label">Text</span>
              <input type="text" class="override-input" data-field="statusText" data-key="${key}" value="${this.escapeHtml(override.statusText || '')}" placeholder="OK">
            </label>
          </div>
        </div>

        <div class="override-section">
          <div class="override-section-header">
            <span class="override-section-title">Response Body</span>
            <div class="override-section-actions">
              <button class="btn btn-sm btn-secondary" data-action="import-body" data-key="${key}">Import JSON</button>
            </div>
          </div>
          <textarea class="override-textarea auto-size" data-field="responseBody" data-key="${key}" placeholder="Enter response body JSON...">${this.escapeHtml(override.responseBody || '')}</textarea>
        </div>

        <div class="override-section">
          <div class="override-section-header">
            <span class="override-section-title">Response Headers</span>
            <div class="override-view-toggle">
              <button class="view-toggle-btn${headersViewMode === 'keyvalue' ? ' active' : ''}" data-action="set-headers-view" data-view="keyvalue" data-key="${key}">Key-Value</button>
              <button class="view-toggle-btn${headersViewMode === 'json' ? ' active' : ''}" data-action="set-headers-view" data-view="json" data-key="${key}">JSON</button>
            </div>
          </div>
          <div class="override-headers-content" data-headers-content="${key}">
            ${headersHtml}
          </div>
        </div>
      </div>
    `;
  }

  renderMatchEditor(matchObj, field, key) {
    if (!matchObj) {
      return '<div class="text-muted">Matching any request to this endpoint</div>';
    }

    const entries = this.getMatchAsArray(matchObj);
    let html = '<div class="match-entries">';

    html += `<div class="match-add-sticky"><button class="btn btn-sm btn-secondary" data-action="add-match" data-field="${field}" data-key="${key}">+ Add</button></div>`;
    html += '<div class="match-scroll-area">';

    entries.forEach((entry, idx) => {
      const isDeleted = entry.deleted === true;
      const isAdded = entry.added === true;
      const entryClass = `match-entry${isDeleted ? ' deleted' : ''}${isAdded ? ' added' : ''}`;
      const toggleBtn = isDeleted
        ? `<button class="btn btn-sm btn-unblock" data-action="restore-match" data-field="${field}" data-idx="${idx}" data-key="${key}">Restore</button>`
        : `<button class="btn btn-sm btn-danger" data-action="remove-match" data-field="${field}" data-idx="${idx}" data-key="${key}">×</button>`;
      const statusIcon = isAdded
        ? '<span class="header-status-icon added" title="Added">+</span>'
        : '<span class="header-status-icon original" title="Original">●</span>';

      html += `
        <div class="${entryClass}">
          ${statusIcon}
          <input type="text" class="override-input" data-match-key="${idx}" data-field="${field}" data-key="${key}" value="${this.escapeHtml(entry.name)}" placeholder="Key"${isDeleted ? ' disabled' : ''}>
          <input type="text" class="override-input" data-match-value="${idx}" data-field="${field}" data-key="${key}" value="${this.escapeHtml(String(entry.value))}" placeholder="Value"${isDeleted ? ' disabled' : ''}>
          ${toggleBtn}
        </div>
      `;
    });

    html += '</div></div>';

    return html;
  }

  renderMatchEditorJson(matchObj, field, key) {
    if (!matchObj) {
      return '<div class="text-muted">Matching any request to this endpoint</div>';
    }

    const jsonStr = typeof matchObj === 'string' ? matchObj : JSON.stringify(matchObj, null, 2);

    return `
      <div class="match-json-editor">
        <textarea class="override-textarea auto-size" data-field="${field}-json" data-key="${key}" placeholder='{"variableName": "value"}'>${this.escapeHtml(jsonStr)}</textarea>
      </div>
    `;
  }

  getMatchAsArray(matchObj) {
    if (!matchObj) {
      return [];
    }
    if (Array.isArray(matchObj)) {
      return matchObj.map(m => ({
        name: m.name,
        value: m.value,
        deleted: m.deleted || false,
        added: m.added || false
      }));
    }
    return Object.entries(matchObj).map(([name, value]) => ({ name, value, deleted: false, added: false }));
  }

  renderHeadersEditor(headers, viewMode, key) {
    if (viewMode === 'json') {
      const headersArray = this.getHeadersAsArray(headers);
      const activeHeaders = {};
      headersArray.filter(h => !h.deleted && h.name).forEach(h => {
        activeHeaders[h.name] = h.value;
      });
      const jsonStr = Object.keys(activeHeaders).length > 0 ? JSON.stringify(activeHeaders, null, 2) : '';
      return `<textarea class="override-textarea override-textarea-sm" data-field="responseHeaders-json" data-key="${key}" placeholder='{"Content-Type": "application/json"}'>${this.escapeHtml(jsonStr)}</textarea>`;
    }

    const entries = this.getHeadersAsArray(headers);
    let html = '<div class="headers-entries">';

    html += `<div class="headers-add-sticky"><button class="btn btn-sm btn-secondary" data-action="add-header" data-key="${key}">+ Add Header</button></div>`;
    html += '<div class="headers-scroll-area">';

    entries.forEach((header, idx) => {
      const isDeleted = header.deleted === true;
      const isAdded = header.added === true;
      const entryClass = `header-entry${isDeleted ? ' deleted' : ''}${isAdded ? ' added' : ''}`;
      const toggleBtn = isDeleted
        ? `<button class="btn btn-sm btn-unblock" data-action="restore-header" data-idx="${idx}" data-key="${key}">Restore</button>`
        : `<button class="btn btn-sm btn-danger" data-action="remove-header" data-idx="${idx}" data-key="${key}">×</button>`;
      const statusIcon = isAdded
        ? '<span class="header-status-icon added" title="Added">+</span>'
        : '<span class="header-status-icon original" title="Original">●</span>';

      html += `
        <div class="${entryClass}">
          ${statusIcon}
          <input type="text" class="override-input" data-header-key="${idx}" data-key="${key}" value="${this.escapeHtml(header.name)}" placeholder="Header name"${isDeleted ? ' disabled' : ''}>
          <input type="text" class="override-input" data-header-value="${idx}" data-key="${key}" value="${this.escapeHtml(header.value)}" placeholder="Value"${isDeleted ? ' disabled' : ''}>
          ${toggleBtn}
        </div>
      `;
    });

    html += '</div></div>';

    return html;
  }

  getHeadersAsArray(headers) {
    if (!headers) {
      return [];
    }
    if (Array.isArray(headers)) {
      return headers.map(h => ({
        name: h.name,
        value: h.value,
        deleted: h.deleted || false,
        added: h.added || false
      }));
    }
    return Object.entries(headers).map(([name, value]) => ({ name, value, deleted: false, added: false }));
  }

  headersArrayToObject(headersArray) {
    if (!headersArray || headersArray.length === 0) {
      return null;
    }
    return headersArray;
  }

  formatJsonString(str) {
    if (!str) {
      return null;
    }
    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch (e) {
      return str;
    }
  }

  handleOverridesListClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (btn) {
      const action = btn.dataset.action;
      const key = btn.dataset.key;

      if (action === 'toggle-enabled') {
        this.toggleOverrideEnabled(key);
      } else if (action === 'delete') {
        this.deleteOverride(key);
      } else if (action === 'restore') {
        this.restoreOverride(key);
      } else if (action === 'permanent-delete') {
        this.permanentlyDeleteOverride(key);
      } else if (action === 'export') {
        this.exportOverride(key);
      } else if (action === 'export-all') {
        this.exportAllOverrides();
      } else if (action === 'import-full') {
        this.importFullOverride();
      } else if (action === 'import-body') {
        this.importOverrideBody(key);
      } else if (action === 'set-headers-view') {
        this.setHeadersViewMode(key, btn.dataset.view);
      } else if (action === 'add-header') {
        this.addHeaderEntry(key);
      } else if (action === 'remove-header') {
        this.removeHeaderEntry(key, parseInt(btn.dataset.idx));
      } else if (action === 'restore-header') {
        this.restoreHeaderEntry(key, parseInt(btn.dataset.idx));
      } else if (action === 'add-match') {
        this.addMatchEntry(key, btn.dataset.field);
      } else if (action === 'remove-match') {
        this.removeMatchEntry(key, btn.dataset.field, parseInt(btn.dataset.idx));
      } else if (action === 'restore-match') {
        this.restoreMatchEntry(key, btn.dataset.field, parseInt(btn.dataset.idx));
      }
      return;
    }

    const row = e.target.closest('.override-row');
    if (row && !e.target.closest('.actions-cell')) {
      const key = row.dataset.key;
      this.expandedOverride = this.expandedOverride === key ? null : key;
      this.renderOverridesList();
    }
  }

  handleOverridesListInput(e) {
    const target = e.target;
    if (!target.dataset.key) {
      return;
    }

    const key = target.dataset.key;
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }

    if (target.dataset.field === 'responseBody') {
      override.responseBody = target.value || null;
      this.saveOverrides();
    } else if (target.dataset.field === 'responseHeaders-json') {
      try {
        const parsed = target.value ? JSON.parse(target.value) : null;
        if (parsed) {
          override.responseHeaders = Object.entries(parsed).map(([name, value]) => ({
            name,
            value: String(value),
            deleted: false
          }));
        } else {
          override.responseHeaders = null;
        }
        target.classList.remove('invalid');
        this.saveOverrides();
      } catch (e) {
        target.classList.add('invalid');
      }
    } else if (target.dataset.field === 'matchVariables-json') {
      try {
        override.matchVariables = target.value ? JSON.parse(target.value) : null;
        target.classList.remove('invalid');
        this.saveOverrides();
      } catch (e) {
        target.classList.add('invalid');
      }
    } else if (target.dataset.headerKey !== undefined) {
      this.updateHeaderKey(key, parseInt(target.dataset.headerKey), target.value);
    } else if (target.dataset.headerValue !== undefined) {
      this.updateHeaderValue(key, parseInt(target.dataset.headerValue), target.value);
    } else if (target.dataset.matchKey !== undefined) {
      this.updateMatchKey(key, target.dataset.field, parseInt(target.dataset.matchKey), target.value);
    } else if (target.dataset.matchValue !== undefined) {
      this.updateMatchValue(key, target.dataset.field, parseInt(target.dataset.matchValue), target.value);
    }
  }

  handleOverridesListChange(e) {
    const target = e.target;
    if (!target.dataset.key) {
      return;
    }

    const key = target.dataset.key;
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }

    const field = target.dataset.field;

    if (field === 'statusCode') {
      override.statusCode = target.value ? parseInt(target.value) : null;
      this.saveOverrides();
    } else if (field === 'statusText') {
      override.statusText = target.value || null;
      this.saveOverrides();
    } else if (field === 'matchVariables-enabled') {
      override.matchVariablesEnabled = target.checked;
      if (target.checked && !override.matchVariables) {
        override.matchVariables = {};
      }
      this.saveOverrides();
      this.renderOverridesList();
    } else if (field === 'matchParams-enabled') {
      override.matchParamsEnabled = target.checked;
      if (target.checked && !override.matchParams) {
        override.matchParams = [];
      }
      this.saveOverrides();
      this.renderOverridesList();
    }
  }

  setHeadersViewMode(key, view) {
    this.overrideHeadersView.set(key, view);
    this.renderOverridesList();
  }

  addHeaderEntry(key) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override.responseHeaders = this.getHeadersAsArray(override.responseHeaders);
    override.responseHeaders.push({ name: '', value: '', deleted: false, added: true });
    this.saveOverrides();
    this.renderOverridesList();
  }

  removeHeaderEntry(key, idx) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override.responseHeaders = this.getHeadersAsArray(override.responseHeaders);
    if (override.responseHeaders[idx]) {
      override.responseHeaders[idx].deleted = true;
      this.saveOverrides();
      this.renderOverridesList();
    }
  }

  restoreHeaderEntry(key, idx) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override.responseHeaders = this.getHeadersAsArray(override.responseHeaders);
    if (override.responseHeaders[idx]) {
      override.responseHeaders[idx].deleted = false;
      this.saveOverrides();
      this.renderOverridesList();
    }
  }

  updateHeaderKey(key, idx, newKey) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override.responseHeaders = this.getHeadersAsArray(override.responseHeaders);
    if (override.responseHeaders[idx]) {
      override.responseHeaders[idx].name = newKey;
      this.saveOverrides();
    }
  }

  updateHeaderValue(key, idx, newValue) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override.responseHeaders = this.getHeadersAsArray(override.responseHeaders);
    if (override.responseHeaders[idx]) {
      override.responseHeaders[idx].value = newValue;
      this.saveOverrides();
    }
  }

  addMatchEntry(key, field) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override[field] = this.getMatchAsArray(override[field]);
    override[field].push({ name: '', value: '', deleted: false, added: true });
    this.saveOverrides();
    this.renderOverridesList();
  }

  removeMatchEntry(key, field, idx) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override[field] = this.getMatchAsArray(override[field]);
    if (override[field][idx]) {
      override[field][idx].deleted = true;
      this.saveOverrides();
      this.renderOverridesList();
    }
  }

  restoreMatchEntry(key, field, idx) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override[field] = this.getMatchAsArray(override[field]);
    if (override[field][idx]) {
      override[field][idx].deleted = false;
      this.saveOverrides();
      this.renderOverridesList();
    }
  }

  updateMatchKey(key, field, idx, newKey) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override[field] = this.getMatchAsArray(override[field]);
    if (override[field][idx]) {
      override[field][idx].name = newKey;
      this.saveOverrides();
    }
  }

  updateMatchValue(key, field, idx, newValue) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override[field] = this.getMatchAsArray(override[field]);
    if (override[field][idx]) {
      override[field][idx].value = newValue;
      this.saveOverrides();
    }
  }

  importOverrideBody(key) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          JSON.parse(ev.target.result);
          const override = this.overrides.get(key);
          if (override) {
            override.responseBody = ev.target.result;
            this.saveOverrides();
            this.renderOverridesList();
            this.addEvent('success', 'Imported response body');
          }
        } catch (err) {
          this.addEvent('error', 'Invalid JSON file: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  importFullOverride() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          const overrides = Array.isArray(data) ? data : [data];
          let imported = 0;

          overrides.forEach(o => {
            if (!o.key || !o.type || !o.callName) {
              return;
            }
            this.overrides.set(o.key, {
              key: o.key,
              type: o.type,
              callName: o.callName,
              enabled: o.enabled !== false,
              matchParams: o.matchParams || null,
              matchVariables: o.matchVariables || null,
              statusCode: o.statusCode || null,
              statusText: o.statusText || null,
              responseHeaders: o.responseHeaders || null,
              responseBody: o.responseBody || null
            });
            imported++;
          });

          if (imported > 0) {
            this.attachDebugger().then(() => {
              this.saveOverrides();
              this.renderOverridesList();
              this.addEvent('success', `Imported ${imported} override(s)`);
            });
          } else {
            this.addEvent('error', 'No valid overrides found in file');
          }
        } catch (err) {
          this.addEvent('error', 'Invalid JSON file: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  exportOverride(key) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    const data = JSON.stringify(override, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `override-${override.callName.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.addEvent('success', 'Exported override');
  }

  exportAllOverrides() {
    if (this.overrides.size === 0) {
      this.addEvent('warning', 'No overrides to export');
      return;
    }
    const data = JSON.stringify(Array.from(this.overrides.values()), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `overrides-${this.currentOrigin?.replace(/[^a-z0-9]/gi, '_') || 'export'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.addEvent('success', `Exported ${this.overrides.size} override(s)`);
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
      this.pendingRequests.clear();
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
      entry,
      pending: false
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
      if (kebabBtn.disabled) {
        return;
      }
      this.toggleKebabMenu(kebabBtn);
      return;
    }

    const kebabOption = e.target.closest('.kebab-option');
    if (kebabOption) {
      e.stopPropagation();
      this.handleKebabAction(kebabOption.dataset.action, kebabOption.dataset.key);
      return;
    }

    const actionBtn = e.target.closest('.btn[data-action]');
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      const callKey = actionBtn.dataset.key;
      if (action === 'block' || action === 'unblock') {
        this.toggleBlock(callKey);
      } else if (action === 'override') {
        this.createOrEditOverride(callKey);
      }
      return;
    }

    if (e.target.closest('.btn')) {
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }

    const row = e.target.closest('.call-row');
    if (row && !row.classList.contains('pending')) {
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

    if (!call.entry) {
      call.responseBody = null;
      this.renderCalls();
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
          patterns: [{ requestStage: 'Request' }]
        }, () => {
          if (chrome.runtime.lastError) {
            this.addEvent('error', 'Fetch enable failed');
            reject(chrome.runtime.lastError);
            return;
          }
          resolve();
        });

        chrome.debugger.onEvent.addListener((source, method, params) => {
          if (source.tabId !== this.tabId || method !== 'Fetch.requestPaused') {
            return;
          }
          this.handlePausedRequest(params);
        });

        chrome.debugger.onDetach.addListener((source, reason) => {
          if (source.tabId === this.tabId) {
            this.debuggerAttached = false;
            this.blockedCalls.clear();
            this.overrides.clear();
            this.addEvent('warning', 'Debugger detached: ' + reason);
            this.renderCalls();
          }
        });
      });
    });
  }

  handlePausedRequest(params) {
    const { requestId, request } = params;
    const url = this.stripQueryParams(request.url);
    const fullUrl = request.url;
    const isGql = url.includes('/graphql');

    let callKey = null;
    let gqlVariables = null;
    let urlParams = null;

    if (isGql && request.postData) {
      const operation = this.extractGqlOperation(request.postData);
      if (operation) {
        callKey = `gql:${operation}`;
        try {
          const parsed = JSON.parse(request.postData);
          gqlVariables = parsed.variables || {};
        } catch (e) {}
      }
    } else {
      callKey = `rest:${url}`;
      try {
        urlParams = Object.fromEntries(new URL(fullUrl).searchParams.entries());
      } catch (e) {}
    }

    if (callKey && this.blockedCalls.has(callKey)) {
      chrome.debugger.sendCommand({ tabId: this.tabId }, 'Fetch.failRequest', {
        requestId,
        errorReason: 'BlockedByClient'
      }, () => {
        if (chrome.runtime.lastError) {}
      });
      return;
    }

    const override = callKey ? this.findMatchingOverride(callKey, isGql ? gqlVariables : urlParams, isGql) : null;

    if (override && override.enabled) {
      this.fulfillWithOverride(requestId, override);
      return;
    }

    chrome.debugger.sendCommand({ tabId: this.tabId }, 'Fetch.continueRequest', {
      requestId
    }, () => {
      if (chrome.runtime.lastError) {}
    });
  }

  findMatchingOverride(callKey, params, isGql) {
    const override = this.overrides.get(callKey);
    if (!override || override.deleted) {
      return null;
    }

    const matchEnabled = isGql ? override.matchVariablesEnabled : override.matchParamsEnabled;
    const matchCriteria = isGql ? override.matchVariables : override.matchParams;

    if (!matchEnabled) {
      return override;
    }

    if (!params) {
      return null;
    }

    if (isGql) {
      if (typeof matchCriteria === 'object' && !Array.isArray(matchCriteria)) {
        const entries = Object.entries(matchCriteria);
        if (entries.length === 0) {
          return override;
        }
        for (const [matchKey, value] of entries) {
          if (JSON.stringify(params[matchKey]) !== JSON.stringify(value)) {
            return null;
          }
        }
        return override;
      }
    }

    const matchArray = this.getMatchAsArray(matchCriteria);
    const activeMatches = matchArray.filter(m => !m.deleted && m.name);

    if (activeMatches.length === 0) {
      return override;
    }

    for (const match of activeMatches) {
      if (String(params[match.name]) !== String(match.value)) {
        return null;
      }
    }

    return override;
  }

  fulfillWithOverride(requestId, override) {
    const responseCode = override.statusCode || 200;
    const responsePhrase = override.statusText || 'OK';

    let responseHeaders = [];
    if (override.responseHeaders) {
      const headersArray = this.getHeadersAsArray(override.responseHeaders);
      responseHeaders = headersArray
        .filter(h => !h.deleted && h.name)
        .map(h => ({ name: h.name, value: String(h.value) }));
    }

    const hasContentType = responseHeaders.some(h => h.name.toLowerCase() === 'content-type');
    if (!hasContentType) {
      responseHeaders.push({ name: 'Content-Type', value: 'application/json' });
    }

    const body = override.responseBody || '{}';
    const encoder = new TextEncoder();
    const bytes = encoder.encode(body);
    const bodyBase64 = btoa(String.fromCharCode(...bytes));

    chrome.debugger.sendCommand({ tabId: this.tabId }, 'Fetch.fulfillRequest', {
      requestId,
      responseCode,
      responsePhrase,
      responseHeaders,
      body: bodyBase64
    }, () => {
      if (chrome.runtime.lastError) {}
    });
  }

  toggleBlock(callKey) {
    if (this.blockedCalls.has(callKey)) {
      this.blockedCalls.delete(callKey);
      this.addEvent('info', `Un-Blocked: ${callKey}`);
      this.saveBlockedCalls();
      if (this.blockedCalls.size === 0 && this.overrides.size === 0) {
        this.detachDebugger();
      }
      this.renderCalls();
      return Promise.resolve();
    } else {
      return this.attachDebugger().then(() => {
        this.blockedCalls.add(callKey);
        this.addEvent('success', `Blocking: ${callKey}`);
        this.saveBlockedCalls();
        this.renderCalls();
      });
    }
  }

  createOrEditOverride(callKey) {
    const call = this.calls.get(callKey);
    if (!call) {
      return;
    }

    if (!this.overrides.has(callKey)) {
      const isGql = callKey.startsWith('gql:');
      let matchParams = null;
      let matchParamsEnabled = false;
      let matchVariables = null;
      let matchVariablesEnabled = false;

      if (isGql && call.requestBody) {
        try {
          const parsed = JSON.parse(call.requestBody);
          if (parsed.variables && Object.keys(parsed.variables).length > 0) {
            matchVariables = parsed.variables;
            matchVariablesEnabled = true;
          }
        } catch (e) {}
      } else if (!isGql && call.fullUrl) {
        try {
          const urlParams = new URL(call.fullUrl).searchParams;
          if (urlParams.toString()) {
            matchParams = Object.entries(Object.fromEntries(urlParams.entries())).map(([name, value]) => ({
              name,
              value,
              deleted: false,
              added: false
            }));
            matchParamsEnabled = true;
          }
        } catch (e) {}
      }

      let responseHeaders = null;
      if (call.responseHeaders && Object.keys(call.responseHeaders).length > 0) {
        responseHeaders = Object.entries(call.responseHeaders).map(([name, value]) => ({
          name,
          value: String(value),
          deleted: false,
          added: false
        }));
      }

      this.overrides.set(callKey, {
        key: callKey,
        type: call.type,
        callName: call.callName,
        enabled: true,
        matchParams,
        matchParamsEnabled,
        matchVariables,
        matchVariablesEnabled,
        statusCode: call.status,
        statusText: call.statusText || '',
        responseHeaders,
        responseBody: this.formatJsonString(call.responseBody)
      });

      this.attachDebugger().then(() => {
        this.saveOverrides();
        this.addEvent('success', `Created override for: ${call.callName}`);
      });
    }

    this.expandedOverride = callKey;
    this.switchView('overrides');
  }

  toggleOverrideEnabled(key) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override.enabled = !override.enabled;
    this.saveOverrides();
    this.renderOverridesList();
    this.addEvent('info', `Override ${override.enabled ? 'enabled' : 'disabled'}: ${override.callName}`);
  }

  deleteOverride(key) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override.deleted = true;
    this.saveOverrides();
    if (this.expandedOverride === key) {
      this.expandedOverride = null;
    }
    this.renderOverridesList();
    this.renderCalls();
    this.addEvent('info', `Deleted override: ${override.callName}`);
  }

  restoreOverride(key) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override.deleted = false;
    this.saveOverrides();
    this.renderOverridesList();
    this.renderCalls();
    this.addEvent('info', `Restored override: ${override.callName}`);
  }

  permanentlyDeleteOverride(key) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    this.overrides.delete(key);
    this.saveOverrides();
    if (this.expandedOverride === key) {
      this.expandedOverride = null;
    }
    this.renderOverridesList();
    this.renderCalls();
    this.addEvent('info', `Permanently deleted override: ${override.callName}`);

    const activeOverrides = Array.from(this.overrides.values()).filter(o => !o.deleted);
    if (this.blockedCalls.size === 0 && activeOverrides.length === 0) {
      this.detachDebugger();
    }
  }

  updateOverrideField(key, field, value) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override[field] = value;
    this.saveOverrides();
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

  truncateCallName(name) {
    if (name.length <= 150) {
      return name;
    }
    return name.slice(0, 150) + '...';
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
      const isPending = call.pending;
      const isBlocked = this.blockedCalls.has(key);
      const override = this.overrides.get(key);
      const hasOverride = override !== undefined && !override.deleted;
      const overrideEnabled = hasOverride && override.enabled;
      const badgeClass = call.type === 'GQL' ? 'badge-gql' : 'badge-rest';
      const statusClass = isPending ? 'text-muted' : (call.hasError ? 'text-error' : 'text-success');
      const rowClass = `call-row${isExpanded ? ' expanded' : ''}${isPending ? ' pending' : ''}${isBlocked ? ' blocked' : ''}${overrideEnabled ? ' overridden' : ''}`;
      const blockBtnClass = isBlocked ? 'btn btn-sm btn-unblock' : 'btn btn-sm btn-danger';
      const blockBtnText = isBlocked ? 'Un-Block' : 'Block';
      const blockAction = isBlocked ? 'unblock' : 'block';
      const overrideBtnClass = hasOverride ? 'btn btn-sm btn-override-active' : 'btn btn-sm btn-primary';
      const overrideBtnText = hasOverride ? 'Edit Override' : 'Override';

      rows.push(`
        <tr class="${rowClass}" data-call-key="${this.escapeHtml(key)}">
          <td><span class="expand-icon">${isPending ? '<span class="spinner"></span>' : '▶'}</span> <span class="badge ${badgeClass}">${call.type}</span></td>
          <td class="method-cell">${call.method}</td>
          <td class="call-name" title="${this.escapeHtml(call.callName)}">${this.escapeHtml(this.truncateCallName(call.callName))}</td>
          <td><span class="font-semibold ${statusClass}">${isPending ? 'Loading...' : call.status}</span>${overrideEnabled ? '<span class="override-indicator" title="Override active">⚡</span>' : ''}</td>
          <td class="actions-cell">
            <button class="${overrideBtnClass}" data-action="override" data-key="${this.escapeHtml(key)}"${isPending ? ' disabled' : ''}>${overrideBtnText}</button>
            <button class="${blockBtnClass}" data-action="${blockAction}" data-key="${this.escapeHtml(key)}"${isPending ? ' disabled' : ''}>${blockBtnText}</button>
            <div class="kebab-menu">
              <button class="kebab-btn" data-key="${this.escapeHtml(key)}"${isPending ? ' disabled' : ''}>⋮</button>
              <div class="kebab-dropdown">
                <button class="kebab-option" data-action="copy-curl" data-key="${this.escapeHtml(key)}">Copy cURL</button>
              </div>
            </div>
          </td>
        </tr>
      `);

      if (isExpanded && !isPending) {
        rows.push(`<tr class="call-details visible"><td colspan="5">${this.renderCallDetails(call, key)}</td></tr>`);
      }
    });

    networkBody.innerHTML = rows.join('');
  }

  renderCallDetails(call, callKey) {
    const requestHeaders = this.renderHeaders(call.requestHeaders, `${callKey}-req`);
    const responseHeaders = this.renderHeaders(call.responseHeaders, `${callKey}-res`);
    const requestBody = this.formatBody(call.requestBody);
    let responseBody;
    if (call.responseBody === undefined) {
      responseBody = '<span class="text-muted">Loading...</span>';
    } else if (call.responseBody === null && !call.entry) {
      responseBody = '<span class="text-muted">Response not captured (request started before DevTools)</span>';
    } else {
      responseBody = this.formatBody(call.responseBody);
    }

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
