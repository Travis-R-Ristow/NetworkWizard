class NetworkWizardPanel {
  constructor() {
    this.isRecording = true;
    this.calls = new Map();
    this.pendingRequests = new Map();
    this.overrides = new Map();
    this.delays = new Map();
    this.blockedCalls = new Map();
    this.blockedListSnapshot = new Map();
    this.scopeFilter = 'all';
    this.jsonEditors = new Map();
    this.expandedCall = null;
    this.expandedOverride = null;
    this.expandedDelay = null;
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
      overridesEmptyState: document.getElementById('overridesEmptyState'),
      delaysView: document.getElementById('delaysView'),
      delaysList: document.getElementById('delaysList'),
      delaysEmptyState: document.getElementById('delaysEmptyState')
    };
    this.bindEvents();
    this.renderMethodFilter();
    this.connectToBackground();
    this.startCapture();
    this.loadBlockedCalls();
    this.loadOverrides();
    this.loadDelays();
    this.addEvent('info', 'NetworkWizard initialized');
  }

  loadBlockedCalls() {
    chrome.devtools.inspectedWindow.eval('window.location.origin', (origin) => {
      this.currentOrigin = origin;
      chrome.storage.local.get(['blockedCalls', 'blockedCallsGlobal'], (result) => {
        const allBlocked = result.blockedCalls || {};
        const globalBlocked = result.blockedCallsGlobal || [];
        const siteBlocked = allBlocked[origin] || [];

        const allEntries = [
          ...globalBlocked.map(b => typeof b === 'string' ? { key: b, scope: 'global' } : b),
          ...siteBlocked.map(b => typeof b === 'string' ? { key: b, scope: 'site', scopeOrigin: origin } : b)
        ];

        if (allEntries.length > 0) {
          this.attachDebugger().then(() => {
            allEntries.forEach(block => {
              this.blockedCalls.set(block.key, {
                key: block.key,
                scope: block.scope || 'site',
                scopeOrigin: block.scopeOrigin || origin
              });
            });
            this.renderCalls();
            this.addEvent('info', `Restored ${allEntries.length} blocked call(s)`);
          }).catch(() => {});
        }
      });
    });
  }

  saveBlockedCalls() {
    if (!this.currentOrigin) {
      return;
    }
    chrome.storage.local.get(['blockedCalls', 'blockedCallsGlobal'], (result) => {
      const allBlocked = result.blockedCalls || {};
      const globalBlocked = [];
      const siteBlocked = [];

      this.blockedCalls.forEach((block) => {
        if (block.scope === 'global') {
          globalBlocked.push(block);
        } else if (block.scopeOrigin === this.currentOrigin) {
          siteBlocked.push(block);
        }
      });

      if (siteBlocked.length > 0) {
        allBlocked[this.currentOrigin] = siteBlocked;
      } else {
        delete allBlocked[this.currentOrigin];
      }

      chrome.storage.local.set({
        blockedCalls: allBlocked,
        blockedCallsGlobal: globalBlocked
      });
    });
  }

  loadOverrides() {
    chrome.devtools.inspectedWindow.eval('window.location.origin', (origin) => {
      this.currentOrigin = origin;
      chrome.storage.local.get(['overrides', 'overridesGlobal'], (result) => {
        const allOverrides = result.overrides || {};
        const globalOverrides = result.overridesGlobal || [];
        const siteOverrides = allOverrides[origin] || [];

        const allEntries = [
          ...globalOverrides.map(o => ({ ...o, scope: 'global' })),
          ...siteOverrides.map(o => ({ ...o, scope: o.scope || 'site', scopeOrigin: o.scopeOrigin || origin }))
        ];

        if (allEntries.length > 0) {
          this.attachDebugger().then(() => {
            allEntries.forEach(o => this.overrides.set(o.key, o));
            this.renderOverridesList();
            this.addEvent('info', `Restored ${allEntries.length} override(s)`);
          }).catch(() => {});
        }
      });
    });
  }

  saveOverrides() {
    if (!this.currentOrigin) {
      return;
    }
    chrome.storage.local.get(['overrides', 'overridesGlobal'], (result) => {
      const allOverrides = result.overrides || {};
      const globalOverrides = [];
      const siteOverrides = [];

      this.overrides.forEach((override) => {
        if (override.scope === 'global') {
          globalOverrides.push(override);
        } else if (!override.scopeOrigin || override.scopeOrigin === this.currentOrigin) {
          siteOverrides.push({ ...override, scopeOrigin: this.currentOrigin });
        }
      });

      if (siteOverrides.length > 0) {
        allOverrides[this.currentOrigin] = siteOverrides;
      } else {
        delete allOverrides[this.currentOrigin];
      }

      chrome.storage.local.set({
        overrides: allOverrides,
        overridesGlobal: globalOverrides
      });
    });
  }

  loadDelays() {
    chrome.devtools.inspectedWindow.eval('window.location.origin', (origin) => {
      this.currentOrigin = origin;
      chrome.storage.local.get(['delays', 'delaysGlobal'], (result) => {
        const allDelays = result.delays || {};
        const globalDelays = result.delaysGlobal || [];
        const siteDelays = allDelays[origin] || [];

        const allEntries = [
          ...globalDelays.map(d => ({ ...d, scope: 'global' })),
          ...siteDelays.map(d => ({ ...d, scope: d.scope || 'site', scopeOrigin: d.scopeOrigin || origin }))
        ];

        if (allEntries.length > 0) {
          this.attachDebugger().then(() => {
            allEntries.forEach(d => this.delays.set(d.key, d));
            this.renderDelaysList();
            this.addEvent('info', `Restored ${allEntries.length} delay(s)`);
          }).catch(() => {});
        }
      });
    });
  }

  saveDelays() {
    if (!this.currentOrigin) {
      return;
    }
    chrome.storage.local.get(['delays', 'delaysGlobal'], (result) => {
      const allDelays = result.delays || {};
      const globalDelays = [];
      const siteDelays = [];

      this.delays.forEach((delay) => {
        if (delay.scope === 'global') {
          globalDelays.push(delay);
        } else if (!delay.scopeOrigin || delay.scopeOrigin === this.currentOrigin) {
          siteDelays.push({ ...delay, scopeOrigin: this.currentOrigin });
        }
      });

      if (siteDelays.length > 0) {
        allDelays[this.currentOrigin] = siteDelays;
      } else {
        delete allDelays[this.currentOrigin];
      }

      chrome.storage.local.set({
        delays: allDelays,
        delaysGlobal: globalDelays
      });
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
    this.elements.delaysList.addEventListener('click', (e) => this.handleDelaysListClick(e));
    this.elements.delaysList.addEventListener('input', (e) => this.handleDelaysListInput(e));
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
    this.scopeFilter = 'all';

    this.elements.headerTabs.querySelectorAll('.header-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.view === view);
    });

    this.elements.networkView.classList.toggle('hidden', view !== 'network');
    this.elements.blockedView.classList.toggle('hidden', view !== 'blocked');
    this.elements.overridesView.classList.toggle('hidden', view !== 'overrides');
    this.elements.delaysView.classList.toggle('hidden', view !== 'delays');

    if (view === 'blocked') {
      this.blockedListSnapshot = new Map(this.blockedCalls);
      this.renderBlockedList();
    } else if (view === 'overrides') {
      this.renderOverridesList();
    } else if (view === 'delays') {
      this.renderDelaysList();
    }
  }

  renderScopeFilterToolbar() {
    return `
      <div class="scope-filter-toolbar">
        <span class="scope-filter-label">Show:</span>
        <div class="scope-filter-group">
          <button class="scope-filter-btn${this.scopeFilter === 'all' ? ' active' : ''}" data-action="set-scope-filter" data-filter="all">All</button>
          <button class="scope-filter-btn${this.scopeFilter === 'global' ? ' active' : ''}" data-action="set-scope-filter" data-filter="global">Global Only</button>
          <button class="scope-filter-btn${this.scopeFilter === 'site' ? ' active' : ''}" data-action="set-scope-filter" data-filter="site">This Site Only</button>
        </div>
      </div>
    `;
  }

  setScopeFilter(filter) {
    this.scopeFilter = filter;
    if (this.currentView === 'blocked') {
      this.renderBlockedList();
    } else if (this.currentView === 'overrides') {
      this.renderOverridesList();
    } else if (this.currentView === 'delays') {
      this.renderDelaysList();
    }
  }

  filterByScope(entries, isMap = false) {
    if (this.scopeFilter === 'all') {
      return entries;
    }

    if (isMap) {
      return Array.from(entries).filter(([, item]) => {
        const scope = item.scope || 'site';
        if (this.scopeFilter === 'global') {
          return scope === 'global';
        }
        return scope === 'site' && (item.scopeOrigin === this.currentOrigin || !item.scopeOrigin);
      });
    }

    return entries.filter(item => {
      const scope = item.scope || 'site';
      if (this.scopeFilter === 'global') {
        return scope === 'global';
      }
      return scope === 'site' && (item.scopeOrigin === this.currentOrigin || !item.scopeOrigin);
    });
  }

  renderBlockedList() {
    const snapshot = this.blockedListSnapshot || new Map();
    const filtered = this.filterByScope(snapshot.entries(), true);

    if (snapshot.size === 0) {
      this.elements.blockedList.innerHTML = '';
      this.elements.blockedEmptyState.style.display = 'flex';
      return;
    }

    this.elements.blockedEmptyState.style.display = 'none';

    const filterToolbar = this.renderScopeFilterToolbar();
    const hasFilteredResults = filtered.length > 0;

    this.elements.blockedList.innerHTML = `
      ${filterToolbar}
      <table class="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Call Name</th>
            <th>Scope</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${!hasFilteredResults ? `<tr><td colspan="4" class="no-filter-results">No ${this.scopeFilter === 'global' ? 'global' : 'site-specific'} blocked calls</td></tr>` : ''}
          ${filtered.map(([key, block]) => {
            const isGql = key.startsWith('gql:');
            const name = key.replace(/^(gql:|rest:)/, '');
            const badgeClass = isGql ? 'badge-gql' : 'badge-rest';
            const isCurrentlyBlocked = this.isBlockedForCurrentSite(key);
            const btnClass = isCurrentlyBlocked ? 'btn btn-sm btn-unblock' : 'btn btn-sm btn-danger';
            const btnText = isCurrentlyBlocked ? 'Un-Block' : 'Block';
            const action = isCurrentlyBlocked ? 'unblock' : 'block';
            const scope = block.scope || 'site';
            const scopeLabel = scope === 'global' ? 'All Sites' : this.truncateScopeOrigin(block.scopeOrigin || this.currentOrigin);
            const scopeBadgeClass = scope === 'global' ? 'scope-badge-global' : 'scope-badge-site';
            return `
              <tr>
                <td><span class="badge ${badgeClass}">${isGql ? 'GQL' : 'REST'}</span></td>
                <td class="call-name" title="${this.escapeHtml(name)}">${this.escapeHtml(this.truncateCallName(name))}</td>
                <td>
                  <span class="scope-badge ${scopeBadgeClass}" title="${scope === 'global' ? 'Applies to all sites' : block.scopeOrigin || this.currentOrigin}">${scopeLabel}</span>
                  <button class="btn btn-sm btn-secondary btn-scope-toggle" data-action="toggle-scope" data-key="${this.escapeHtml(key)}" title="Toggle scope">${scope === 'global' ? '🌐→📍' : '📍→🌐'}</button>
                </td>
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

  truncateScopeOrigin(origin) {
    if (!origin) {
      return 'This Site';
    }
    try {
      const url = new URL(origin);
      return url.hostname.length > 25 ? url.hostname.substring(0, 22) + '...' : url.hostname;
    } catch (e) {
      return origin.length > 25 ? origin.substring(0, 22) + '...' : origin;
    }
  }

  handleBlockedListClick(e) {
    const btn = e.target.closest('.btn[data-action]');
    if (!btn) {
      return;
    }

    if (btn.dataset.action === 'unblock' || btn.dataset.action === 'block') {
      this.toggleBlock(btn.dataset.key).then(() => {
        this.renderBlockedList();
      });
    } else if (btn.dataset.action === 'toggle-scope') {
      this.toggleBlockedScope(btn.dataset.key);
    } else if (btn.dataset.action === 'set-scope-filter') {
      this.setScopeFilter(btn.dataset.filter);
    }
  }

  toggleBlockedScope(key) {
    const block = this.blockedCalls.get(key);
    if (!block) {
      return;
    }

    if (block.scope === 'global') {
      block.scope = 'site';
      block.scopeOrigin = this.currentOrigin;
    } else {
      block.scope = 'global';
      delete block.scopeOrigin;
    }

    this.blockedListSnapshot = new Map(this.blockedCalls);
    this.saveBlockedCalls();
    this.renderBlockedList();
    this.addEvent('info', `Block scope changed to ${block.scope === 'global' ? 'All Sites' : 'This Site'}`);
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

    const filtered = this.filterByScope(overrides, true);
    const hasFilteredResults = filtered.length > 0;

    const toolbarHtml = `
      ${this.renderScopeFilterToolbar()}
      <div class="overrides-toolbar">
        <button class="btn btn-sm btn-secondary" data-action="import-full">Import Override</button>
        <button class="btn btn-sm btn-secondary" data-action="export-all">Export All</button>
      </div>
    `;

    const noResultsRow = !hasFilteredResults
      ? `<tr><td colspan="4" class="no-filter-results">No ${this.scopeFilter === 'global' ? 'global' : 'site-specific'} overrides</td></tr>`
      : '';

    const rows = filtered.map(([key, override]) => {
      const isExpanded = this.expandedOverride === key && !override.deleted;
      const isDeleted = override.deleted === true;
      const badgeClass = override.type === 'GQL' ? 'badge-gql' : 'badge-rest';
      const rowClass = `override-row${isExpanded ? ' expanded' : ''}${isDeleted ? ' deleted' : ''}`;
      const scope = override.scope || 'site';
      const scopeLabel = scope === 'global' ? 'All Sites' : this.truncateScopeOrigin(override.scopeOrigin || this.currentOrigin);
      const scopeBadgeClass = scope === 'global' ? 'scope-badge-global' : 'scope-badge-site';

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
          <td><span class="scope-badge ${scopeBadgeClass}" title="${scope === 'global' ? 'Applies to all sites' : override.scopeOrigin || this.currentOrigin}">${scopeLabel}</span></td>
          <td class="actions-cell">${actionsHtml}</td>
        </tr>
      `;

      if (isExpanded) {
        rowHtml += `<tr class="override-details visible"><td colspan="4">${this.renderOverrideForm(override, key)}</td></tr>`;
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
            <th>Scope</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${noResultsRow}${rows}</tbody>
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

    this.initJsonEditors();

    document.documentElement.scrollTop = document.body.scrollTop = pageScrollTop;
    this.elements.overridesView.scrollTop = viewScrollTop;
  }

  initJsonEditors() {
    const activeKeys = new Set();

    this.elements.overridesList.querySelectorAll('.json-editor-container[data-field="responseBody"]').forEach(container => {
      const key = container.dataset.key;
      const override = this.overrides.get(key);
      activeKeys.add(key);

      if (!override) {
        return;
      }

      const existingEditor = this.jsonEditors.get(key);
      if (existingEditor) {
        if (existingEditor.container.isConnected) {
          return;
        }
        existingEditor.destroy();
        this.jsonEditors.delete(key);
      }

      const editor = new JsonEditor(container, {
        placeholder: 'Enter response body JSON...',
        onChange: (newValue) => {
          const o = this.overrides.get(key);
          if (o) {
            o.responseBody = newValue || null;
            this.saveOverrides();
          }
        }
      });

      editor.setValue(override.responseBody || '');
      this.jsonEditors.set(key, editor);
    });

    this.jsonEditors.forEach((editor, key) => {
      if (!activeKeys.has(key)) {
        editor.destroy();
        this.jsonEditors.delete(key);
      }
    });
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

    const scope = override.scope || 'site';
    const scopeOrigin = override.scopeOrigin || this.currentOrigin;

    return `
      <div class="override-form">
        <div class="override-section">
          <div class="override-section-header">
            <span class="override-section-title">Scope</span>
          </div>
          <div class="scope-toggle-row">
            <div class="scope-toggle-group">
              <button class="scope-toggle-btn${scope === 'site' ? ' active' : ''}" data-action="set-scope" data-scope="site" data-key="${key}">This Site Only</button>
              <button class="scope-toggle-btn${scope === 'global' ? ' active' : ''}" data-action="set-scope" data-scope="global" data-key="${key}">All Sites</button>
            </div>
            <span class="scope-origin-label ${scope === 'global' ? 'hidden' : ''}" data-scope-origin="${key}">${this.escapeHtml(scopeOrigin)}</span>
          </div>
        </div>

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
          <div class="json-editor-container" data-field="responseBody" data-key="${key}"></div>
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
      } else if (action === 'set-scope') {
        this.setOverrideScope(key, btn.dataset.scope);
      } else if (action === 'set-scope-filter') {
        this.setScopeFilter(btn.dataset.filter);
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

    if (target.dataset.field === 'responseHeaders-json') {
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
          const parsed = JSON.parse(ev.target.result);
          const formatted = JSON.stringify(parsed, null, 2);
          const override = this.overrides.get(key);
          if (override) {
            override.responseBody = formatted;
            this.saveOverrides();

            const editor = this.jsonEditors.get(key);
            if (editor && editor.container.isConnected) {
              editor.setValue(formatted);
            }

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
              scope: o.scope || 'site',
              scopeOrigin: o.scopeOrigin || this.currentOrigin,
              matchParams: o.matchParams || null,
              matchParamsEnabled: o.matchParamsEnabled || false,
              matchVariables: o.matchVariables || null,
              matchVariablesEnabled: o.matchVariablesEnabled || false,
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
            }).catch(() => {});
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
        callData.statusCode = callData.status;
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
      } else if (action === 'delay') {
        this.createOrEditDelay(callKey);
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
          const msg = chrome.runtime.lastError.message || 'Unknown error';
          this.addEvent('error', 'Debugger attach failed: ' + msg);
          reject(new Error(msg));
          return;
        }

        this.debuggerAttached = true;
        this.addEvent('success', 'Debugger attached for interception');

        chrome.debugger.sendCommand({ tabId: this.tabId }, 'Fetch.enable', {
          patterns: [{ requestStage: 'Request' }, { requestStage: 'Response' }]
        }, () => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || 'Unknown error';
            this.addEvent('error', 'Fetch enable failed: ' + msg);
            reject(new Error(msg));
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
            this.delays.clear();
            this.addEvent('warning', 'Debugger detached: ' + reason);
            this.renderCalls();
          }
        });
      });
    });
  }

  handlePausedRequest(params) {
    const { requestId, request, responseStatusCode } = params;
    const isResponseStage = responseStatusCode !== undefined;
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

    if (isResponseStage) {
      const delay = callKey ? this.getDelayForCurrentSite(callKey) : null;
      if (delay && delay.enabled && !delay.deleted && !delay.delayBefore) {
        setTimeout(() => {
          chrome.debugger.sendCommand({ tabId: this.tabId }, 'Fetch.continueRequest', {
            requestId
          }, () => {
            if (chrome.runtime.lastError) {}
          });
        }, delay.delayMs);
        return;
      }

      chrome.debugger.sendCommand({ tabId: this.tabId }, 'Fetch.continueRequest', {
        requestId
      }, () => {
        if (chrome.runtime.lastError) {}
      });
      return;
    }

    if (callKey && this.isBlockedForCurrentSite(callKey)) {
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

    const delayBeforeReq = callKey ? this.getDelayForCurrentSite(callKey) : null;
    if (delayBeforeReq && delayBeforeReq.enabled && !delayBeforeReq.deleted && delayBeforeReq.delayBefore) {
      setTimeout(() => {
        chrome.debugger.sendCommand({ tabId: this.tabId }, 'Fetch.continueRequest', {
          requestId
        }, () => {
          if (chrome.runtime.lastError) {}
        });
      }, delayBeforeReq.delayMs);
      return;
    }

    chrome.debugger.sendCommand({ tabId: this.tabId }, 'Fetch.continueRequest', {
      requestId
    }, () => {
      if (chrome.runtime.lastError) {}
    });
  }

  getDelayForCurrentSite(callKey) {
    const delay = this.delays.get(callKey);
    if (!delay || delay.deleted) {
      return null;
    }
    if (delay.scope === 'global') {
      return delay;
    }
    if (delay.scopeOrigin === this.currentOrigin) {
      return delay;
    }
    return null;
  }

  getOverrideForCurrentSite(callKey) {
    const override = this.overrides.get(callKey);
    if (!override || override.deleted) {
      return null;
    }
    if (override.scope === 'global') {
      return override;
    }
    if (override.scopeOrigin === this.currentOrigin) {
      return override;
    }
    return null;
  }

  findMatchingOverride(callKey, params, isGql) {
    const override = this.overrides.get(callKey);
    if (!override || override.deleted) {
      return null;
    }

    if (override.scope !== 'global' && override.scopeOrigin !== this.currentOrigin) {
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
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    const bodyBase64 = btoa(binary);

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

  isBlockedForCurrentSite(callKey) {
    const block = this.blockedCalls.get(callKey);
    if (!block) {
      return false;
    }
    if (block.scope === 'global') {
      return true;
    }
    return block.scopeOrigin === this.currentOrigin;
  }

  toggleBlock(callKey) {
    if (this.blockedCalls.has(callKey)) {
      this.blockedCalls.delete(callKey);
      this.addEvent('info', `Un-Blocked: ${callKey}`);
      this.saveBlockedCalls();
      const activeOverrides = Array.from(this.overrides.values()).filter(o => !o.deleted);
      const activeDelays = Array.from(this.delays.values()).filter(d => !d.deleted);
      if (this.blockedCalls.size === 0 && activeOverrides.length === 0 && activeDelays.length === 0) {
        this.detachDebugger();
      }
      this.renderCalls();
      return Promise.resolve();
    } else {
      return this.attachDebugger().then(() => {
        this.blockedCalls.set(callKey, {
          key: callKey,
          scope: 'site',
          scopeOrigin: this.currentOrigin
        });
        this.addEvent('success', `Blocking: ${callKey}`);
        this.saveBlockedCalls();
        this.renderCalls();
      }).catch(() => {});
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
        scope: 'site',
        scopeOrigin: this.currentOrigin,
        matchParams,
        matchParamsEnabled,
        matchVariables,
        matchVariablesEnabled,
        statusCode: call.statusCode || call.status,
        statusText: call.statusText || '',
        responseHeaders,
        responseBody: this.formatJsonString(call.responseBody)
      });

      this.attachDebugger().then(() => {
        this.saveOverrides();
        this.addEvent('success', `Created override for: ${call.callName}`);
      }).catch(() => {});
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

  setOverrideScope(key, scope) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override.scope = scope;
    if (scope === 'site') {
      override.scopeOrigin = this.currentOrigin;
    } else {
      delete override.scopeOrigin;
    }
    this.saveOverrides();
    this.renderOverridesList();
    this.addEvent('info', `Override scope changed to ${scope === 'global' ? 'All Sites' : 'This Site'}`);
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
    const activeDelays = Array.from(this.delays.values()).filter(d => !d.deleted);
    if (this.blockedCalls.size === 0 && activeOverrides.length === 0 && activeDelays.length === 0) {
      this.detachDebugger();
    }
  }

  createOrEditDelay(callKey) {
    const call = this.calls.get(callKey);
    if (!call) {
      return;
    }

    if (!this.delays.has(callKey)) {
      this.delays.set(callKey, {
        key: callKey,
        type: call.type,
        callName: call.callName,
        enabled: true,
        scope: 'site',
        scopeOrigin: this.currentOrigin,
        delayMs: 15000,
        delayBefore: true
      });

      this.attachDebugger().then(() => {
        this.saveDelays();
        this.addEvent('success', `Created delay for: ${call.callName}`);
      }).catch(() => {});
    }

    this.expandedDelay = callKey;
    this.switchView('delays');
  }

  renderDelaysList() {
    const delays = Array.from(this.delays.entries());

    if (delays.length === 0) {
      this.elements.delaysList.innerHTML = '';
      this.elements.delaysEmptyState.style.display = 'flex';
      return;
    }

    this.elements.delaysEmptyState.style.display = 'none';

    const filtered = this.filterByScope(delays, true);
    const hasFilteredResults = filtered.length > 0;

    const noResultsRow = !hasFilteredResults
      ? `<tr><td colspan="5" class="no-filter-results">No ${this.scopeFilter === 'global' ? 'global' : 'site-specific'} delays</td></tr>`
      : '';

    const rows = filtered.map(([key, delay]) => {
      const isExpanded = this.expandedDelay === key && !delay.deleted;
      const isDeleted = delay.deleted === true;
      const badgeClass = delay.type === 'GQL' ? 'badge-gql' : 'badge-rest';
      const rowClass = `delay-row${isExpanded ? ' expanded' : ''}${isDeleted ? ' deleted' : ''}`;
      const scope = delay.scope || 'site';
      const scopeLabel = scope === 'global' ? 'All Sites' : this.truncateScopeOrigin(delay.scopeOrigin || this.currentOrigin);
      const scopeBadgeClass = scope === 'global' ? 'scope-badge-global' : 'scope-badge-site';

      let actionsHtml;
      if (isDeleted) {
        actionsHtml = `
          <button class="btn btn-sm btn-unblock" data-action="restore" data-key="${this.escapeHtml(key)}">Restore</button>
          <button class="btn btn-sm btn-danger" data-action="permanent-delete" data-key="${this.escapeHtml(key)}">Remove</button>
        `;
      } else {
        const toggleClass = delay.enabled ? 'btn btn-sm btn-unblock' : 'btn btn-sm btn-secondary';
        const toggleText = delay.enabled ? 'Enabled' : 'Disabled';
        actionsHtml = `
          <button class="${toggleClass}" data-action="toggle-enabled" data-key="${this.escapeHtml(key)}">${toggleText}</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-key="${this.escapeHtml(key)}">Delete</button>
        `;
      }

      let rowHtml = `
        <tr class="${rowClass}" data-key="${this.escapeHtml(key)}">
          <td><span class="expand-icon">${isDeleted ? '' : '▶'}</span> <span class="badge ${badgeClass}">${delay.type}</span></td>
          <td class="call-name" title="${this.escapeHtml(delay.callName)}">${this.escapeHtml(this.truncateCallName(delay.callName))}</td>
          <td><span class="scope-badge ${scopeBadgeClass}" title="${scope === 'global' ? 'Applies to all sites' : delay.scopeOrigin || this.currentOrigin}">${scopeLabel}</span></td>
          <td>${delay.delayMs / 1000}s ${delay.delayBefore ? 'before' : 'after'}</td>
          <td class="actions-cell">${actionsHtml}</td>
        </tr>
      `;

      if (isExpanded) {
        rowHtml += `<tr class="delay-details visible"><td colspan="5">${this.renderDelayForm(delay, key)}</td></tr>`;
      }

      return rowHtml;
    }).join('');

    this.elements.delaysList.innerHTML = `
      ${this.renderScopeFilterToolbar()}
      <table class="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Call Name</th>
            <th>Scope</th>
            <th>Delay</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${noResultsRow}${rows}</tbody>
      </table>
    `;
  }

  renderDelayForm(delay, key) {
    const scope = delay.scope || 'site';
    const scopeOrigin = delay.scopeOrigin || this.currentOrigin;

    return `
      <div class="delay-form">
        <div class="delay-form-row">
          <div class="delay-field">
            <span class="delay-field-label">Scope:</span>
            <div class="scope-toggle-group">
              <button class="scope-toggle-btn${scope === 'site' ? ' active' : ''}" data-action="set-delay-scope" data-scope="site" data-key="${key}">This Site Only</button>
              <button class="scope-toggle-btn${scope === 'global' ? ' active' : ''}" data-action="set-delay-scope" data-scope="global" data-key="${key}">All Sites</button>
            </div>
            <span class="scope-origin-label ${scope === 'global' ? 'hidden' : ''}">${this.escapeHtml(scopeOrigin)}</span>
          </div>
        </div>
        <div class="delay-form-row">
          <div class="delay-field">
            <span class="delay-field-label">Delay Duration:</span>
            <input type="number" class="delay-input" data-field="delaySeconds" data-key="${key}" value="${delay.delayMs / 1000}" min="1" max="300">
            <span class="delay-unit">seconds</span>
          </div>
        </div>
        <div class="delay-form-row">
          <div class="delay-field">
            <span class="delay-field-label">Delay Timing:</span>
            <div class="delay-toggle-group">
              <button class="delay-toggle-btn${delay.delayBefore ? ' active' : ''}" data-action="set-timing" data-timing="before" data-key="${key}">Before Request</button>
              <button class="delay-toggle-btn${!delay.delayBefore ? ' active' : ''}" data-action="set-timing" data-timing="after" data-key="${key}">After Response</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  handleDelaysListClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (btn) {
      const action = btn.dataset.action;
      const key = btn.dataset.key;

      if (action === 'toggle-enabled') {
        this.toggleDelayEnabled(key);
      } else if (action === 'delete') {
        this.deleteDelay(key);
      } else if (action === 'restore') {
        this.restoreDelay(key);
      } else if (action === 'permanent-delete') {
        this.permanentlyDeleteDelay(key);
      } else if (action === 'set-timing') {
        this.setDelayTiming(key, btn.dataset.timing === 'before');
      } else if (action === 'set-delay-scope') {
        this.setDelayScope(key, btn.dataset.scope);
      } else if (action === 'set-scope-filter') {
        this.setScopeFilter(btn.dataset.filter);
      }
      return;
    }

    const row = e.target.closest('.delay-row');
    if (row && !e.target.closest('.actions-cell')) {
      const key = row.dataset.key;
      this.expandedDelay = this.expandedDelay === key ? null : key;
      this.renderDelaysList();
    }
  }

  handleDelaysListInput(e) {
    const target = e.target;
    if (!target.dataset.key) {
      return;
    }

    const key = target.dataset.key;
    const delay = this.delays.get(key);
    if (!delay) {
      return;
    }

    if (target.dataset.field === 'delaySeconds') {
      const seconds = parseInt(target.value) || 15;
      delay.delayMs = Math.max(1, Math.min(300, seconds)) * 1000;
      this.saveDelays();
      this.renderCalls();
    }
  }

  toggleDelayEnabled(key) {
    const delay = this.delays.get(key);
    if (!delay) {
      return;
    }
    delay.enabled = !delay.enabled;
    this.saveDelays();
    this.renderDelaysList();
    this.renderCalls();
    this.addEvent('info', `Delay ${delay.enabled ? 'enabled' : 'disabled'}: ${delay.callName}`);
  }

  setDelayTiming(key, delayBefore) {
    const delay = this.delays.get(key);
    if (!delay) {
      return;
    }
    delay.delayBefore = delayBefore;
    this.saveDelays();
    this.renderDelaysList();
    this.renderCalls();
  }

  setDelayScope(key, scope) {
    const delay = this.delays.get(key);
    if (!delay) {
      return;
    }
    delay.scope = scope;
    if (scope === 'site') {
      delay.scopeOrigin = this.currentOrigin;
    } else {
      delete delay.scopeOrigin;
    }
    this.saveDelays();
    this.renderDelaysList();
    this.addEvent('info', `Delay scope changed to ${scope === 'global' ? 'All Sites' : 'This Site'}`);
  }

  deleteDelay(key) {
    const delay = this.delays.get(key);
    if (!delay) {
      return;
    }
    delay.deleted = true;
    this.saveDelays();
    if (this.expandedDelay === key) {
      this.expandedDelay = null;
    }
    this.renderDelaysList();
    this.renderCalls();
    this.addEvent('info', `Deleted delay: ${delay.callName}`);
  }

  restoreDelay(key) {
    const delay = this.delays.get(key);
    if (!delay) {
      return;
    }
    delay.deleted = false;
    this.saveDelays();
    this.renderDelaysList();
    this.renderCalls();
    this.addEvent('info', `Restored delay: ${delay.callName}`);
  }

  permanentlyDeleteDelay(key) {
    const delay = this.delays.get(key);
    if (!delay) {
      return;
    }
    this.delays.delete(key);
    this.saveDelays();
    if (this.expandedDelay === key) {
      this.expandedDelay = null;
    }
    this.renderDelaysList();
    this.renderCalls();
    this.addEvent('info', `Permanently deleted delay: ${delay.callName}`);

    const activeOverrides = Array.from(this.overrides.values()).filter(o => !o.deleted);
    const activeDelays = Array.from(this.delays.values()).filter(d => !d.deleted);
    if (this.blockedCalls.size === 0 && activeOverrides.length === 0 && activeDelays.length === 0) {
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

    const expandedCallInFiltered = this.expandedCall && filtered.some(([key]) => key === this.expandedCall);
    let preservedDetailRow = null;
    let preservedCallKey = null;

    if (expandedCallInFiltered) {
      const existingDetailRow = networkBody.querySelector('tr.call-details');
      if (existingDetailRow) {
        preservedDetailRow = existingDetailRow;
        preservedCallKey = this.expandedCall;
        existingDetailRow.remove();
      }
    }

    const rows = [];

    filtered.forEach(([key, call]) => {
      const isExpanded = this.expandedCall === key;
      const isPending = call.pending;
      const isBlocked = this.isBlockedForCurrentSite(key);
      const override = this.getOverrideForCurrentSite(key);
      const hasOverride = override !== null;
      const overrideEnabled = hasOverride && override.enabled;
      const delay = this.getDelayForCurrentSite(key);
      const hasDelay = delay !== null;
      const delayEnabled = hasDelay && delay.enabled;
      const badgeClass = call.type === 'GQL' ? 'badge-gql' : 'badge-rest';
      const statusClass = isPending ? 'text-muted' : (call.hasError ? 'text-error' : 'text-success');
      const rowClass = `call-row${isExpanded ? ' expanded' : ''}${isPending ? ' pending' : ''}${isBlocked ? ' blocked' : ''}${overrideEnabled ? ' overridden' : ''}${delayEnabled ? ' delayed' : ''}`;
      const blockBtnClass = isBlocked ? 'btn btn-sm btn-unblock' : 'btn btn-sm btn-danger';
      const blockBtnText = isBlocked ? 'Un-Block' : 'Block';
      const blockAction = isBlocked ? 'unblock' : 'block';
      const overrideBtnClass = hasOverride ? 'btn btn-sm btn-override-active' : 'btn btn-sm btn-primary';
      const overrideBtnText = hasOverride ? 'Edit Override' : 'Override';
      const delayBtnClass = hasDelay ? 'btn btn-sm btn-delay-active' : 'btn btn-sm btn-delay';
      const delayBtnText = hasDelay ? 'Edit Delay' : 'Delay';
      let statusIndicators = '';
      if (overrideEnabled) {
        statusIndicators += '<span class="override-indicator" title="Override active">⚡</span>';
      }
      if (delayEnabled) {
        statusIndicators += `<span class="delay-indicator" title="Delay active: ${delay.delayMs / 1000}s ${delay.delayBefore ? 'before' : 'after'}">⏱</span>`;
      }

      rows.push(`
        <tr class="${rowClass}" data-call-key="${this.escapeHtml(key)}">
          <td><span class="expand-icon">${isPending ? '<span class="spinner"></span>' : '▶'}</span> <span class="badge ${badgeClass}">${call.type}</span></td>
          <td class="method-cell">${call.method}</td>
          <td class="call-name" title="${this.escapeHtml(call.callName)}">${this.escapeHtml(this.truncateCallName(call.callName))}</td>
          <td><span class="font-semibold ${statusClass}">${isPending ? 'Loading...' : call.status}</span>${statusIndicators}</td>
          <td class="actions-cell">
            <button class="${overrideBtnClass}" data-action="override" data-key="${this.escapeHtml(key)}"${isPending ? ' disabled' : ''}>${overrideBtnText}</button>
            <button class="${delayBtnClass}" data-action="delay" data-key="${this.escapeHtml(key)}"${isPending ? ' disabled' : ''}>${delayBtnText}</button>
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
        if (preservedDetailRow && preservedCallKey === key) {
          rows.push(`<tr class="call-details visible" data-preserved="true"><td colspan="5"></td></tr>`);
        } else {
          rows.push(`<tr class="call-details visible"><td colspan="5">${this.renderCallDetails(call, key)}</td></tr>`);
        }
      }
    });

    networkBody.innerHTML = rows.join('');

    if (preservedDetailRow && preservedCallKey === this.expandedCall) {
      const placeholder = networkBody.querySelector('tr.call-details[data-preserved="true"]');
      if (placeholder) {
        placeholder.replaceWith(preservedDetailRow);
      }
    }

    this.initNetworkJsonEditors();
  }

  initNetworkJsonEditors() {
    const activeKeys = new Set();

    this.elements.networkBody.querySelectorAll('.json-editor-container[data-callkey]').forEach(container => {
      const callKey = container.dataset.callkey;
      const field = container.dataset.field;
      const editorKey = `${callKey}-${field}`;
      const call = this.calls.get(callKey);
      activeKeys.add(editorKey);

      if (!call) {
        return;
      }

      let value = '';
      let placeholder = '';

      if (field === 'requestBody') {
        value = call.requestBody || '';
        placeholder = 'No request body';
      } else if (field === 'responseBodyView') {
        if (call.responseBody === undefined) {
          placeholder = 'Loading response...';
        } else if (call.responseBody === null && !call.entry) {
          placeholder = 'Response not captured (request started before DevTools)';
        } else {
          value = call.responseBody || '';
          placeholder = 'No response body';
        }
      }

      const existingEditor = this.jsonEditors.get(editorKey);
      if (existingEditor) {
        if (existingEditor.container.isConnected) {
          if (existingEditor.getValue() !== value && value) {
            existingEditor.updateValue(value);
          }
          return;
        }
        existingEditor.destroy();
        this.jsonEditors.delete(editorKey);
      }

      const editor = new JsonEditor(container, {
        placeholder: placeholder,
        readOnly: true
      });

      editor.setValue(value);
      this.jsonEditors.set(editorKey, editor);
    });

    this.jsonEditors.forEach((editor, key) => {
      if (key.includes('-requestBody') || key.includes('-responseBodyView')) {
        if (!activeKeys.has(key)) {
          editor.destroy();
          this.jsonEditors.delete(key);
        }
      }
    });
  }

  renderCallDetails(call, callKey) {
    const requestHeaders = this.renderHeaders(call.requestHeaders, `${callKey}-req`);
    const responseHeaders = this.renderHeaders(call.responseHeaders, `${callKey}-res`);

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
          <div class="json-editor-container" data-field="requestBody" data-callkey="${callKey}" data-readonly="true"></div>
        </section>
        <section class="details-panel${this.activeTab === 'response' ? ' active' : ''}" data-panel="response">
          <div class="panel-toolbar">
            <button class="btn btn-sm btn-secondary copy-btn" data-copy="response" data-key="${callKey}">Copy</button>
          </div>
          <div class="json-editor-container" data-field="responseBodyView" data-callkey="${callKey}" data-readonly="true"></div>
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
