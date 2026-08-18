const WRITE_DEBOUNCE_MS = 250;
const MAX_TRACKED_INTERCEPTS = 500;
const HEADER_SIDES = ["req", "res"];
const DETAIL_EDITOR_FIELDS = ["requestBody", "responseBodyView", "requestBodyOverride"];
const REQUEST_EDITOR_FIELDS = ["requestBody", "requestBodyOverride"];
const OVERRIDE_EDITOR_FIELDS = ["request", "response"];

const OVERRIDE_ACTIONS = {
  "toggle-enabled": (panel, key) => panel.setRuleEnabled("overrides", key),
  delete: (panel, key) => panel.setRuleDeleted("overrides", key, true),
  restore: (panel, key) => panel.setRuleDeleted("overrides", key, false),
  "permanent-delete": (panel, key) => panel.purgeRule("overrides", key),
  export: (panel, key) => panel.exportOverride(key),
  "export-all": (panel) => panel.exportAllOverrides(),
  "import-full": (panel) => panel.importFullOverride(),
  "import-body": (panel, key) => panel.importOverrideBody(key),
  "set-headers-view": (panel, key, data) =>
    panel.setHeadersViewMode(key, data.view),
  "add-header": (panel, key) => panel.addHeaderEntry(key),
  "remove-header": (panel, key, data) =>
    panel.removeHeaderEntry(key, parseInt(data.idx, 10)),
  "restore-header": (panel, key, data) =>
    panel.restoreHeaderEntry(key, parseInt(data.idx, 10)),
  "add-match": (panel, key, data) => panel.addMatchEntry(key, data.field),
  "remove-match": (panel, key, data) =>
    panel.removeMatchEntry(key, data.field, parseInt(data.idx, 10)),
  "restore-match": (panel, key, data) =>
    panel.restoreMatchEntry(key, data.field, parseInt(data.idx, 10)),
  "set-scope": (panel, key, data) =>
    panel.setRuleScope("overrides", key, data.scope),
  "set-scope-filter": (panel, key, data) => panel.setScopeFilter(data.filter),
};

const DELAY_ACTIONS = {
  "toggle-enabled": (panel, key) => panel.setRuleEnabled("delays", key),
  delete: (panel, key) => panel.setRuleDeleted("delays", key, true),
  restore: (panel, key) => panel.setRuleDeleted("delays", key, false),
  "permanent-delete": (panel, key) => panel.purgeRule("delays", key),
  "set-timing": (panel, key, data) =>
    panel.setDelayTiming(key, data.timing === "before"),
  "set-delay-scope": (panel, key, data) =>
    panel.setRuleScope("delays", key, data.scope),
  "set-scope-filter": (panel, key, data) => panel.setScopeFilter(data.filter),
};

class NetworkWizardPanel {
  constructor() {
    this.isRecording = true;
    this.calls = new Map();
    this.pendingRequests = new Map();
    this.overrides = new Map();
    this.intercepts = new Map();
    this.delays = new Map();
    this.blockedCalls = new Map();
    this.blockedListSnapshot = new Map();
    this.scopeFilter = "all";
    this.jsonEditors = new Map();
    this.callRowHtml = new Map();
    this.overrideRowHtml = new Map();
    this.expandedCall = null;
    this.expandedOverride = null;
    this.expandedDelay = null;
    this.expandedTables = new Set();
    this.activeTab = "headers";
    this.overrideHeadersView = new Map();
    this.filters = {
      search: "",
      type: "all",
      methods: new Set(),
      status: "all",
    };
    this.knownMethods = new Set(["GET", "POST", "PUT", "DELETE"]);
    this.events = [];
    this.maxEvents = 5;
    this.tabId = chrome.devtools.inspectedWindow.tabId;
    this.debuggerAttached = false;
    this.drawerExpanded = false;
    this.currentView = "network";
    this.currentOrigin = null;
    this.storeLoaded = false;
    this.pendingWrites = new Map();
    this.writeTimer = null;
    this.reportedCdpErrors = new Set();
    this.missingPostDataWarnings = new Set();
    this.elements = {
      clearBtn: document.getElementById("clearBtn"),
      recordToggle: document.getElementById("recordToggle"),
      searchInput: document.getElementById("searchInput"),
      filterBar: document.querySelector(".filter-bar"),
      statusText: document.getElementById("statusText"),
      statusDrawer: document.getElementById("statusDrawer"),
      statusDrawerToggle: document.getElementById("statusDrawerToggle"),
      eventList: document.getElementById("eventList"),
      networkBody: document.getElementById("networkBody"),
      emptyState: document.getElementById("emptyState"),
      methodFilter: document.getElementById("methodFilter"),
      headerTabs: document.getElementById("headerTabs"),
      networkView: document.getElementById("networkView"),
      blockedView: document.getElementById("blockedView"),
      blockedList: document.getElementById("blockedList"),
      blockedEmptyState: document.getElementById("blockedEmptyState"),
      overridesView: document.getElementById("overridesView"),
      overridesList: document.getElementById("overridesList"),
      overridesEmptyState: document.getElementById("overridesEmptyState"),
      delaysView: document.getElementById("delaysView"),
      delaysList: document.getElementById("delaysList"),
      delaysEmptyState: document.getElementById("delaysEmptyState"),
      callCount: document.getElementById("callCount"),
    };
    this.bindEvents();
    this.renderMethodFilter();
    this.connectToBackground();
    this.startCapture();
    this.loadPersistedState();
    this.addEvent("info", "NetworkWizard initialized");
  }

  loadPersistedState() {
    const flushed = this.flushWrites();
    this.storeLoaded = false;
    this.currentOrigin = null;

    flushed
      .then(() => this.readOrigin())
      .then((origin) => {
        this.currentOrigin = origin;
        return Promise.all([
          this.loadStore("blocked", (raw, scope) =>
            this.normalizeScopedEntry(raw, scope),
          ),
          this.loadStore("overrides", (raw, scope) =>
            this.normalizeOverride(raw, scope),
          ),
          this.loadStore("delays", (raw, scope) =>
            this.normalizeDelay(raw, scope),
          ),
        ]);
      })
      .then(([blocked, overrides, delays]) => {
        this.blockedCalls = blocked.entries;
        this.overrides = overrides.entries;
        this.delays = delays.entries;
        this.storeLoaded = true;

        if (blocked.migrated) {
          this.saveBlockedCalls();
        }
        if (overrides.migrated) {
          this.saveOverrides();
        }
        if (delays.migrated) {
          this.saveDelays();
        }

        this.blockedListSnapshot = new Map(this.blockedCalls);
        this.renderCalls();
        this.renderScopedView();
        this.checkDebuggerNeeded();

        const restored = [
          blocked.count ? `${blocked.count} blocked call(s)` : null,
          overrides.count ? `${overrides.count} override(s)` : null,
          delays.count ? `${delays.count} delay(s)` : null,
        ].filter(Boolean);
        if (restored.length > 0) {
          this.addEvent("info", `Restored ${restored.join(", ")}`);
        }
      })
      .catch(() => {
        this.addEvent("error", "Failed to load saved state");
      });
  }

  readOrigin() {
    return new Promise((resolve) => {
      chrome.devtools.inspectedWindow.eval(
        "window.location.origin",
        (origin, error) => {
          const usable = !error && origin && origin !== "null";
          resolve(usable ? origin : null);
        },
      );
    });
  }

  saveBlockedCalls() {
    this.saveStore("blocked", this.blockedCalls);
  }

  storeKeysFor(store) {
    return {
      blocked: { site: "blockedCalls", global: "blockedCallsGlobal" },
      overrides: { site: "overrides", global: "overridesGlobal" },
      delays: { site: "delays", global: "delaysGlobal" },
    }[store];
  }

  loadStore(store, normalize) {
    const keys = this.storeKeysFor(store);

    return chrome.storage.local.get([keys.site, keys.global]).then((result) => {
      const bySite = result[keys.site] || {};
      const globalEntries = result[keys.global] || [];
      const siteEntries =
        (this.currentOrigin && bySite[this.currentOrigin]) || [];
      const target = new Map();
      let migrated = false;

      const add = (raw, scope) => {
        const entry = normalize(raw, scope);
        if (!entry.key || typeof entry.key !== "string") {
          return;
        }
        if (this.isOldKeyFormat(entry.key)) {
          entry.key = this.migrateOldKey(entry.key);
          migrated = true;
        }
        if (entry.migrated) {
          migrated = true;
          delete entry.migrated;
        }
        this.setRule(target, entry);
      };

      globalEntries.forEach((raw) => add(raw, "global"));
      siteEntries.forEach((raw) => add(raw, "site"));

      return { entries: target, count: target.size, migrated };
    });
  }

  saveStore(store, source) {
    if (!this.storeLoaded) {
      return;
    }

    this.pendingWrites.set(store, { source, origin: this.currentOrigin });

    if (this.writeTimer !== null) {
      return;
    }

    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flushWrites();
    }, WRITE_DEBOUNCE_MS);
  }

  flushWrites() {
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }

    const writes = [];
    this.pendingWrites.forEach(({ source, origin }, store) => {
      writes.push(this.writeStore(store, source, origin).catch(() => {}));
    });
    this.pendingWrites.clear();

    return Promise.all(writes);
  }

  writeStore(store, source, origin) {
    const keys = this.storeKeysFor(store);

    return chrome.storage.local.get([keys.site, keys.global]).then((result) => {
      const bySite = result[keys.site] || {};
      const globalEntries = [];
      const siteEntries = [];

      source.forEach((entry) => {
        if (entry.scope === "global") {
          const { scopeOrigin, ...rest } = entry;
          globalEntries.push({ ...rest, scope: "global" });
          return;
        }
        if (!entry.scopeOrigin || entry.scopeOrigin === origin) {
          siteEntries.push({ ...entry, scope: "site", scopeOrigin: origin });
        }
      });

      const payload = { [keys.global]: globalEntries };

      if (origin) {
        if (siteEntries.length > 0) {
          bySite[origin] = siteEntries;
        } else {
          delete bySite[origin];
        }
        payload[keys.site] = bySite;
      }

      return chrome.storage.local.set(payload);
    });
  }

  saveOverrides() {
    this.saveStore("overrides", this.overrides);
  }

  saveDelays() {
    this.saveStore("delays", this.delays);
  }

  normalizeScopedEntry(raw, scope) {
    const entry = typeof raw === "string" ? { key: raw } : { ...raw };

    if (scope === "global") {
      entry.scope = "global";
      delete entry.scopeOrigin;
    } else {
      entry.scope = "site";
      entry.scopeOrigin = entry.scopeOrigin || this.currentOrigin;
    }

    return entry;
  }

  normalizeOverride(raw, scope) {
    const entry = this.normalizeScopedEntry(raw, scope);

    if (entry.enabled === undefined) {
      entry.enabled = true;
    }
    if (entry.responseBodyOverrideEnabled === undefined) {
      entry.responseBodyOverrideEnabled = true;
      entry.migrated = true;
    }
    if (entry.requestBodyOverrideEnabled === undefined) {
      entry.requestBodyOverrideEnabled = false;
    }

    return entry;
  }

  normalizeDelay(raw, scope) {
    const entry = this.normalizeScopedEntry(raw, scope);

    if (entry.enabled === undefined) {
      entry.enabled = true;
    }
    if (typeof entry.delayMs !== "number") {
      entry.delayMs = 15000;
    }
    if (entry.delayBefore === undefined) {
      entry.delayBefore = true;
    }

    return entry;
  }

  renderScopedView() {
    if (this.currentView === "blocked") {
      this.renderBlockedList();
    } else if (this.currentView === "overrides") {
      this.renderOverridesList();
    } else if (this.currentView === "delays") {
      this.renderDelaysList();
    }
  }

  connectToBackground() {
    try {
      this.port = chrome.runtime.connect({ name: "networkwizard" });
      this.port.postMessage({ type: "init", tabId: this.tabId });

      this.port.onMessage.addListener((msg) => {
        if (msg.type === "requestStart") {
          if (!this.isRecording) {
            return;
          }
          this.addPendingRequest(msg);
        } else if (msg.type === "requestEnd") {
          this.completePendingRequest(msg.requestId, msg.statusCode);
        } else if (msg.type === "requestError") {
          this.failPendingRequest(msg.requestId);
        }
      });

      this.port.onDisconnect.addListener(() => {
        this.addEvent("warning", "Background connection lost");
      });
    } catch (e) {
      this.addEvent("error", "Failed to connect to background");
    }
  }

  addPendingRequest(msg) {
    const url = this.stripQueryParams(msg.url);
    const isGql = url.includes("/graphql");
    const gqlOperation = isGql ? this.extractGqlOperation(msg.bodyText) : null;
    const callName = gqlOperation || url;

    const variablesOrParams = isGql
      ? this.extractGqlVariables(msg.bodyText)
      : msg.bodyText || this.parseUrlParams(msg.url);

    const callKey = this.generateCallKey(
      isGql,
      gqlOperation,
      url,
      variablesOrParams,
    );

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
      type: isGql ? "GQL" : "REST",
      callName,
      method,
      fullUrl: msg.url,
      status: null,
      statusText: "",
      hasError: false,
      requestHeaders: {},
      responseHeaders: {},
      requestBody: msg.bodyText,
      matchParams: isGql ? variablesOrParams : this.parseUrlParams(msg.url),
      pending: true,
    });

    this.appendCallRow(callKey);
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
      this.updateCallRow(callKey);
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
      call.status = "Failed";
      call.hasError = true;
      call.pending = false;
    }

    this.pendingRequests.delete(requestId);
    this.updateCallRow(callKey);
  }

  bindEvents() {
    this.elements.clearBtn.addEventListener("click", () => this.clear());
    this.elements.recordToggle.addEventListener("change", (e) =>
      this.toggleRecording(e.target.checked),
    );
    this.elements.statusDrawerToggle.addEventListener("click", () =>
      this.toggleDrawer(),
    );
    this.elements.networkBody.addEventListener("click", (e) =>
      this.handleTableClick(e),
    );
    this.elements.searchInput.addEventListener("input", (e) =>
      this.updateFilter("search", e.target.value),
    );
    this.elements.filterBar.addEventListener("click", (e) =>
      this.handleFilterClick(e),
    );
    this.elements.headerTabs.addEventListener("click", (e) =>
      this.handleHeaderTabClick(e),
    );
    this.elements.blockedList.addEventListener("click", (e) =>
      this.handleBlockedListClick(e),
    );
    this.elements.overridesList.addEventListener("click", (e) =>
      this.handleOverridesListClick(e),
    );
    this.elements.overridesList.addEventListener("input", (e) =>
      this.handleOverridesListInput(e),
    );
    this.elements.overridesList.addEventListener("change", (e) =>
      this.handleOverridesListChange(e),
    );
    this.elements.delaysList.addEventListener("click", (e) =>
      this.handleDelaysListClick(e),
    );
    this.elements.delaysList.addEventListener("input", (e) =>
      this.handleDelaysListInput(e),
    );
    window.addEventListener("pagehide", () => this.flushWrites());
    window.addEventListener("beforeunload", () => this.flushWrites());
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".kebab-menu")) {
        document
          .querySelectorAll(".kebab-menu.open")
          .forEach((m) => m.classList.remove("open"));
      }
      if (!e.target.closest(".chip-add-menu")) {
        document
          .querySelectorAll(".chip-add-menu.open")
          .forEach((m) => m.classList.remove("open"));
      }
    });
  }

  handleHeaderTabClick(e) {
    const tab = e.target.closest(".header-tab");
    if (!tab) {
      return;
    }
    this.switchView(tab.dataset.view);
  }

  switchView(view) {
    this.currentView = view;
    this.scopeFilter = "all";

    this.elements.headerTabs.querySelectorAll(".header-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.view === view);
    });

    this.elements.networkView.classList.toggle("hidden", view !== "network");
    this.elements.blockedView.classList.toggle("hidden", view !== "blocked");
    this.elements.overridesView.classList.toggle(
      "hidden",
      view !== "overrides",
    );
    this.elements.delaysView.classList.toggle("hidden", view !== "delays");

    if (view === "blocked") {
      this.blockedListSnapshot = new Map(this.blockedCalls);
      this.renderBlockedList();
    } else if (view === "overrides") {
      this.renderOverridesList();
    } else if (view === "delays") {
      this.renderDelaysList();
    }
  }

  renderScopeFilterToolbar() {
    return `
      <div class="scope-filter-toolbar">
        <span class="scope-filter-label">Show:</span>
        <div class="scope-filter-group">
          <button class="scope-filter-btn${this.scopeFilter === "all" ? " active" : ""}" data-action="set-scope-filter" data-filter="all">All</button>
          <button class="scope-filter-btn${this.scopeFilter === "global" ? " active" : ""}" data-action="set-scope-filter" data-filter="global">Global Only</button>
          <button class="scope-filter-btn${this.scopeFilter === "site" ? " active" : ""}" data-action="set-scope-filter" data-filter="site">This Site Only</button>
        </div>
      </div>
    `;
  }

  setScopeFilter(filter) {
    this.scopeFilter = filter;
    if (this.currentView === "blocked") {
      this.renderBlockedList();
    } else if (this.currentView === "overrides") {
      this.renderOverridesList();
    } else if (this.currentView === "delays") {
      this.renderDelaysList();
    }
  }

  filterByScope(entries) {
    const pairs = Array.from(entries);

    if (this.scopeFilter === "all") {
      return pairs;
    }

    return pairs.filter(([, item]) => {
      const scope = item.scope || "site";
      if (this.scopeFilter === "global") {
        return scope === "global";
      }
      return (
        scope === "site" &&
        (!item.scopeOrigin || item.scopeOrigin === this.currentOrigin)
      );
    });
  }

  renderBlockedList() {
    const snapshot = this.blockedListSnapshot || new Map();
    const filtered = this.filterByScope(snapshot.entries());

    if (snapshot.size === 0) {
      this.elements.blockedList.innerHTML = this.renderScopeFilterToolbar();
      this.elements.blockedEmptyState.style.display = "flex";
      return;
    }

    this.elements.blockedEmptyState.style.display = "none";

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
          ${!hasFilteredResults ? `<tr><td colspan="4" class="no-filter-results">No ${this.scopeFilter === "global" ? "global" : "site-specific"} blocked calls</td></tr>` : ""}
          ${filtered
            .map(([key, block]) => {
              const isGql = block.key.startsWith("gql:");
              const name = this.getDisplayName(block.key);
              const isWildcard = this.isWildcardKey(block.key);
              const badgeClass = isGql ? "badge-gql" : "badge-rest";
              const wildcardBadge = isWildcard
                ? '<span class="badge badge-wildcard">All Vars</span>'
                : "";
              const isCurrentlyBlocked = this.blockedCalls.has(key);
              const btnClass = isCurrentlyBlocked
                ? "btn btn-sm btn-unblock"
                : "btn btn-sm btn-danger";
              const btnText = isCurrentlyBlocked ? "Un-Block" : "Block";
              const action = isCurrentlyBlocked ? "unblock" : "block";
              const scope = block.scope || "site";
              const scopeLabel =
                scope === "global"
                  ? "All Sites"
                  : this.truncateScopeOrigin(
                      block.scopeOrigin || this.currentOrigin,
                    );
              const scopeBadgeClass =
                scope === "global" ? "scope-badge-global" : "scope-badge-site";
              return `
              <tr>
                <td>
                  <span class="badge ${badgeClass}">${isGql ? "GQL" : "REST"}</span>${wildcardBadge}
                </td>
                <td class="call-name" title="${this.escapeHtml(name)}">${this.escapeHtml(this.truncateCallName(name))}</td>
                <td>
                  <span class="scope-badge ${scopeBadgeClass}" title="${this.escapeHtml(scope === "global" ? "Applies to all sites" : block.scopeOrigin || this.currentOrigin)}">${scopeLabel}</span>
                  <button class="btn btn-sm btn-secondary btn-scope-toggle" data-action="toggle-scope" data-key="${this.escapeHtml(key)}" title="Toggle scope">${scope === "global" ? "🌐→📍" : "📍→🌐"}</button>
                </td>
                <td>
                  <button class="${btnClass}" data-action="${action}" data-key="${this.escapeHtml(key)}">${btnText}</button>
                </td>
              </tr>
            `;
            })
            .join("")}
        </tbody>
      </table>
    `;
  }

  truncateScopeOrigin(origin) {
    if (!origin) {
      return "This Site";
    }
    try {
      const url = new URL(origin);
      return url.hostname.length > 25
        ? url.hostname.substring(0, 22) + "..."
        : url.hostname;
    } catch (e) {
      return origin.length > 25 ? origin.substring(0, 22) + "..." : origin;
    }
  }

  handleBlockedListClick(e) {
    const btn = e.target.closest(".btn[data-action]");
    if (!btn) {
      return;
    }

    if (btn.dataset.action === "unblock" || btn.dataset.action === "block") {
      this.toggleBlockEntry(btn.dataset.key).then(() => {
        this.renderBlockedList();
      });
    } else if (btn.dataset.action === "toggle-scope") {
      this.toggleBlockedScope(btn.dataset.key);
    } else if (btn.dataset.action === "set-scope-filter") {
      this.setScopeFilter(btn.dataset.filter);
    }
  }

  toggleBlockedScope(ruleId) {
    const block = this.blockedCalls.get(ruleId);
    if (!block) {
      return;
    }

    const nextScope = this.ruleScope(block) === "global" ? "site" : "global";
    if (!this.applyRuleScope(this.blockedCalls, ruleId, block, nextScope)) {
      return;
    }

    this.blockedListSnapshot = new Map(this.blockedCalls);
    this.saveBlockedCalls();
    this.renderBlockedList();
    this.addEvent(
      "info",
      `Block scope changed to ${nextScope === "global" ? "All Sites" : "This Site"}`,
    );
  }

  applyRuleScope(source, ruleId, entry, scope) {
    const target = `${scope}|${entry.key}`;
    if (target !== ruleId && source.has(target)) {
      this.addEvent(
        "warning",
        `A ${scope === "global" ? "All Sites" : "This Site"} rule already exists for ${this.getDisplayName(entry.key)}`,
      );
      return false;
    }

    entry.scope = scope;
    if (scope === "site") {
      entry.scopeOrigin = this.currentOrigin;
    } else {
      delete entry.scopeOrigin;
    }
    this.rekeyRule(source, ruleId, entry);
    return true;
  }

  renderOverridesList() {
    const overrides = Array.from(this.overrides.entries());

    if (overrides.length === 0) {
      this.elements.overridesList.innerHTML = this.renderScopeFilterToolbar();
      this.elements.overridesEmptyState.style.display = "flex";
      this.overrideRowHtml.clear();
      return;
    }

    this.elements.overridesEmptyState.style.display = "none";

    const body = this.ensureOverridesShell();
    this.syncOverrideRows(body, this.filterByScope(overrides));
    this.initJsonEditors();
  }

  ensureOverridesShell() {
    const list = this.elements.overridesList;
    const existing = list.querySelector("[data-overrides-body]");

    if (existing) {
      this.refreshScopeFilter(list);
      return existing;
    }

    list.innerHTML = `
      ${this.renderScopeFilterToolbar()}
      <div class="overrides-toolbar">
        <button class="btn btn-sm btn-secondary" data-action="import-full">Import Override</button>
        <button class="btn btn-sm btn-secondary" data-action="export-all">Export All</button>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Call Name</th>
            <th>Scope</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody data-overrides-body></tbody>
      </table>
    `;

    this.overrideRowHtml.clear();
    return list.querySelector("[data-overrides-body]");
  }

  refreshScopeFilter(container) {
    container
      .querySelectorAll("[data-action='set-scope-filter']")
      .forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.filter === this.scopeFilter);
      });
  }

  overrideDetailsFor(row) {
    const next = row.nextElementSibling;
    return next && next.classList.contains("override-details") ? next : null;
  }

  syncNoResultsRow(body, show) {
    const existing = body.querySelector("tr.no-filter-results-row");

    if (!show) {
      if (existing) {
        existing.remove();
      }
      return null;
    }

    const label = `No ${this.scopeFilter === "global" ? "global" : "site-specific"} overrides`;
    const row = this.elementFromHtml(
      `<tr class="no-filter-results-row"><td colspan="4" class="no-filter-results">${label}</td></tr>`,
    );

    if (existing) {
      existing.replaceWith(row);
    } else {
      body.insertBefore(row, body.firstElementChild);
    }
    return row;
  }

  syncOverrideRows(body, filtered) {
    const wanted = new Set(filtered.map(([key]) => key));
    const existing = new Map();

    Array.from(body.querySelectorAll("tr.override-row")).forEach((row) => {
      const key = row.dataset.key;
      if (wanted.has(key)) {
        existing.set(key, row);
        return;
      }
      this.discardOverrideRow(row, key);
    });

    let anchor = this.syncNoResultsRow(body, filtered.length === 0);

    filtered.forEach(([key, override]) => {
      const found = existing.get(key);
      const row = found
        ? this.refreshOverrideRowElement(found, key, override)
        : this.createOverrideRowElement(key, override);

      const target = anchor ? anchor.nextElementSibling : body.firstElementChild;
      if (target !== row) {
        const details = this.overrideDetailsFor(row);
        body.insertBefore(row, target);
        if (details) {
          body.insertBefore(details, row.nextSibling);
        }
      }

      anchor = this.syncOverrideDetails(body, row, key, override) || row;
    });
  }

  createOverrideRowElement(key, override) {
    const html = this.renderOverrideRow(key, override);
    this.overrideRowHtml.set(key, html);
    return this.elementFromHtml(html);
  }

  refreshOverrideRowElement(row, key, override) {
    const html = this.renderOverrideRow(key, override);
    if (this.overrideRowHtml.get(key) === html) {
      return row;
    }

    const replacement = this.elementFromHtml(html);
    this.overrideRowHtml.set(key, html);
    row.replaceWith(replacement);
    return replacement;
  }

  discardOverrideRow(row, key) {
    const details = this.overrideDetailsFor(row);
    if (details) {
      details.remove();
    }
    this.destroyOverrideEditors(key);
    this.overrideRowHtml.delete(key);
    row.remove();
  }

  destroyOverrideEditors(key) {
    OVERRIDE_EDITOR_FIELDS.forEach((field) => {
      const editorKey = `${key}-${field}`;
      const editor = this.jsonEditors.get(editorKey);
      if (editor) {
        editor.destroy();
        this.jsonEditors.delete(editorKey);
      }
    });
  }

  syncOverrideDetails(body, row, key, override) {
    const details = this.overrideDetailsFor(row);
    const wanted = this.expandedOverride === key && !override.deleted;

    if (!wanted) {
      if (details) {
        this.destroyOverrideEditors(key);
        details.remove();
      }
      return null;
    }

    if (details) {
      return details;
    }

    const created = this.elementFromHtml(
      `<tr class="override-details visible"><td colspan="4">${this.renderOverrideForm(override, key)}</td></tr>`,
    );
    body.insertBefore(created, row.nextSibling);
    this.autoSizeIn(created);
    return created;
  }

  autoSizeIn(root) {
    root
      .querySelectorAll(".override-textarea.auto-size")
      .forEach((textarea) => this.autoSizeTextarea(textarea));
  }

  expandedOverrideDetails(key) {
    if (this.expandedOverride !== key) {
      return null;
    }
    const row = this.elements.overridesList.querySelector(
      `tr.override-row[data-key="${CSS.escape(key)}"]`,
    );
    return row ? this.overrideDetailsFor(row) : null;
  }

  patchOverrideMatch(key) {
    const details = this.expandedOverrideDetails(key);
    const override = this.overrides.get(key);
    if (!details || !override) {
      return;
    }

    const isGql = override.type === "GQL";
    const enabled = isGql
      ? override.matchVariablesEnabled
      : override.matchParamsEnabled;

    const section = details.querySelector(
      `[data-match-section="${CSS.escape(key)}"]`,
    );
    if (section) {
      section.classList.toggle("hidden", !enabled);
    }

    const content = details.querySelector(
      `[data-match-content="${CSS.escape(key)}"]`,
    );
    if (content) {
      content.innerHTML = isGql
        ? this.renderMatchEditorJson(override.matchVariables, "matchVariables", key)
        : this.renderMatchEditor(override.matchParams, "matchParams", key);
      this.autoSizeIn(content);
    }
  }

  patchOverrideHeaders(key) {
    const details = this.expandedOverrideDetails(key);
    const override = this.overrides.get(key);
    if (!details || !override) {
      return;
    }

    const content = details.querySelector(
      `[data-headers-content="${CSS.escape(key)}"]`,
    );
    if (content) {
      content.innerHTML = this.renderHeadersEditor(
        override.responseHeaders,
        this.overrideHeadersView.get(key) || "keyvalue",
        key,
      );
    }
  }

  patchOverrideSection(key, attribute, visible) {
    const details = this.expandedOverrideDetails(key);
    if (!details) {
      return;
    }
    const section = details.querySelector(
      `[${attribute}="${CSS.escape(key)}"]`,
    );
    if (section) {
      section.classList.toggle("hidden", !visible);
    }
  }

  renderOverrideRow(key, override) {
    const isExpanded = this.expandedOverride === key && !override.deleted;
    const isDeleted = override.deleted === true;
    const badgeClass = override.type === "GQL" ? "badge-gql" : "badge-rest";
    const wildcardBadge = this.isWildcardKey(override.key)
      ? '<span class="badge badge-wildcard">All Vars</span>'
      : "";
    const rowClass = `override-row${isExpanded ? " expanded" : ""}${isDeleted ? " deleted" : ""}`;
    const scope = override.scope || "site";
    const scopeOrigin = override.scopeOrigin || this.currentOrigin;
    const scopeLabel =
      scope === "global" ? "All Sites" : this.truncateScopeOrigin(scopeOrigin);
    const scopeBadgeClass =
      scope === "global" ? "scope-badge-global" : "scope-badge-site";

    const actionsHtml = isDeleted
      ? `
          <button class="btn btn-sm btn-unblock" data-action="restore" data-key="${this.escapeHtml(key)}">Restore</button>
          <button class="btn btn-sm btn-danger" data-action="permanent-delete" data-key="${this.escapeHtml(key)}">Remove</button>
        `
      : `
          <button class="${override.enabled ? "btn btn-sm btn-unblock" : "btn btn-sm btn-secondary"}" data-action="toggle-enabled" data-key="${this.escapeHtml(key)}">${override.enabled ? "Enabled" : "Disabled"}</button>
          <button class="btn btn-sm btn-secondary" data-action="export" data-key="${this.escapeHtml(key)}">Export</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-key="${this.escapeHtml(key)}">Delete</button>
        `;

    return `
        <tr class="${rowClass}" data-key="${this.escapeHtml(key)}">
          <td><span class="expand-icon">${isDeleted ? "" : "▶"}</span> <span class="badge ${badgeClass}">${override.type}</span>${wildcardBadge}</td>
          <td class="call-name" title="${this.escapeHtml(override.callName)}">${this.escapeHtml(this.truncateCallName(override.callName))}</td>
          <td><span class="scope-badge ${scopeBadgeClass}" title="${this.escapeHtml(scope === "global" ? "Applies to all sites" : scopeOrigin)}">${scopeLabel}</span></td>
          <td class="actions-cell">${actionsHtml}</td>
        </tr>
      `;
  }

  initJsonEditors() {
    const activeKeys = new Set();

    this.elements.overridesList
      .querySelectorAll('.json-editor-container[data-field="requestBody"]')
      .forEach((container) => {
        const key = container.dataset.key;
        const editorKey = `${key}-request`;
        const override = this.overrides.get(key);
        activeKeys.add(editorKey);

        if (!override) {
          return;
        }

        const existingEditor = this.jsonEditors.get(editorKey);
        if (existingEditor) {
          if (existingEditor.container.isConnected) {
            return;
          }
          existingEditor.destroy();
          this.jsonEditors.delete(editorKey);
        }

        const editor = new JsonEditor(container, {
          placeholder: "Enter request body JSON...",
          onChange: (newValue) => {
            const o = this.overrides.get(key);
            if (o) {
              o.requestBody = newValue || null;
              this.saveOverrides();
            }
          },
        });

        editor.setValue(override.requestBody || "");
        this.jsonEditors.set(editorKey, editor);
      });

    this.elements.overridesList
      .querySelectorAll('.json-editor-container[data-field="responseBody"]')
      .forEach((container) => {
        const key = container.dataset.key;
        const editorKey = `${key}-response`;
        const override = this.overrides.get(key);
        activeKeys.add(editorKey);

        if (!override) {
          return;
        }

        const existingEditor = this.jsonEditors.get(editorKey);
        if (existingEditor) {
          if (existingEditor.container.isConnected) {
            return;
          }
          existingEditor.destroy();
          this.jsonEditors.delete(editorKey);
        }

        const editor = new JsonEditor(container, {
          placeholder: "Enter response body JSON...",
          onChange: (newValue) => {
            const o = this.overrides.get(key);
            if (o) {
              o.responseBody = newValue || null;
              this.saveOverrides();
            }
          },
        });

        editor.setValue(override.responseBody || "");
        this.jsonEditors.set(editorKey, editor);
      });

    this.jsonEditors.forEach((editor, editorKey) => {
      if (!activeKeys.has(editorKey)) {
        editor.destroy();
        this.jsonEditors.delete(editorKey);
      }
    });
  }

  autoSizeTextarea(textarea) {
    textarea.style.height = "auto";
    const maxHeight = window.innerHeight * 0.4;
    const contentHeight = textarea.scrollHeight;
    textarea.style.height = Math.min(contentHeight, maxHeight) + "px";
  }

  renderOverrideForm(override, key) {
    const headersViewMode = this.overrideHeadersView.get(key) || "keyvalue";
    const isGql = override.type === "GQL";

    const matchTerm = isGql ? "variables" : "params";
    const matchLabel = isGql ? "Match Variables" : "Match Params";
    const matchValue = isGql ? override.matchVariables : override.matchParams;
    const matchEnabled = isGql
      ? override.matchVariablesEnabled
      : override.matchParamsEnabled;
    const matchField = isGql ? "matchVariables" : "matchParams";

    const matchHtml = isGql
      ? this.renderMatchEditorJson(matchValue, matchField, key)
      : this.renderMatchEditor(matchValue, matchField, key);
    const headersHtml = this.renderHeadersEditor(
      override.responseHeaders,
      headersViewMode,
      key,
    );

    const scope = override.scope || "site";
    const scopeOrigin = override.scopeOrigin || this.currentOrigin;

    return `
      <div class="override-form">
        <div class="override-section">
          <div class="override-section-header">
            <span class="override-section-title">Scope</span>
          </div>
          <div class="scope-toggle-row">
            <div class="scope-toggle-group">
              <button class="scope-toggle-btn${scope === "site" ? " active" : ""}" data-action="set-scope" data-scope="site" data-key="${this.escapeHtml(key)}">This Site Only</button>
              <button class="scope-toggle-btn${scope === "global" ? " active" : ""}" data-action="set-scope" data-scope="global" data-key="${this.escapeHtml(key)}">All Sites</button>
            </div>
            <span class="scope-origin-label ${scope === "global" ? "hidden" : ""}" data-scope-origin="${this.escapeHtml(key)}">${this.escapeHtml(scopeOrigin)}</span>
            <label class="override-match-toggle" title="${matchEnabled ? `Only fires when the request's ${matchTerm} match below` : `Fires on every request to this ${isGql ? "operation" : "endpoint"}, whatever the ${matchTerm} are`}">
              <input type="checkbox" data-field="${matchField}-enabled" data-key="${this.escapeHtml(key)}" ${matchEnabled ? "checked" : ""}>
              <span>Match ${matchTerm}</span>
            </label>
          </div>
        </div>

        <div class="override-section ${!matchEnabled ? "hidden" : ""}" data-match-section="${this.escapeHtml(key)}">
          <div class="override-section-header">
            <span class="override-section-title">${matchLabel}</span>
          </div>
          <div class="override-match-content" data-match-content="${this.escapeHtml(key)}">
            ${matchHtml}
          </div>
        </div>

        <div class="override-section">
          <div class="override-section-header">
            <span class="override-section-title">Override Request</span>
            <label class="override-toggle">
              <input type="checkbox" data-field="requestBodyOverrideEnabled" data-key="${this.escapeHtml(key)}" ${override.requestBodyOverrideEnabled ? "checked" : ""}>
              <span>Modify outgoing request body</span>
            </label>
          </div>
          <div class="override-request-content ${!override.requestBodyOverrideEnabled ? "hidden" : ""}" data-request-content="${this.escapeHtml(key)}">
            <div class="json-editor-container" data-field="requestBody" data-key="${this.escapeHtml(key)}"></div>
          </div>
        </div>

        <div class="override-section">
          <div class="override-section-header">
            <span class="override-section-title">Override Response</span>
            <label class="override-toggle">
              <input type="checkbox" data-field="responseBodyOverrideEnabled" data-key="${this.escapeHtml(key)}" ${override.responseBodyOverrideEnabled ? "checked" : ""}>
              <span>Return custom response</span>
            </label>
          </div>
          <div class="override-response-content ${!override.responseBodyOverrideEnabled ? "hidden" : ""}" data-response-content="${this.escapeHtml(key)}">
            <div class="override-status-row">
              <label class="override-field">
                <span class="override-field-label">Status Code</span>
                <input type="number" class="override-input override-input-sm" data-field="statusCode" data-key="${this.escapeHtml(key)}" value="${override.statusCode || ""}" placeholder="200">
              </label>
              <label class="override-field">
                <span class="override-field-label">Status Text</span>
                <input type="text" class="override-input" data-field="statusText" data-key="${this.escapeHtml(key)}" value="${this.escapeHtml(override.statusText || "")}" placeholder="OK">
              </label>
            </div>
            <div class="override-section-subheader">
              <span>Response Body</span>
              <button class="btn btn-sm btn-secondary" data-action="import-body" data-key="${this.escapeHtml(key)}">Import JSON</button>
            </div>
            <div class="json-editor-container" data-field="responseBody" data-key="${this.escapeHtml(key)}"></div>
            <div class="override-section-subheader">
              <span>Response Headers</span>
              <div class="override-view-toggle">
                <button class="view-toggle-btn${headersViewMode === "keyvalue" ? " active" : ""}" data-action="set-headers-view" data-view="keyvalue" data-key="${this.escapeHtml(key)}">Key-Value</button>
                <button class="view-toggle-btn${headersViewMode === "json" ? " active" : ""}" data-action="set-headers-view" data-view="json" data-key="${this.escapeHtml(key)}">JSON</button>
              </div>
            </div>
            <div class="override-headers-content" data-headers-content="${this.escapeHtml(key)}">
              ${headersHtml}
            </div>
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

    html += `<div class="match-add-sticky"><button class="btn btn-sm btn-secondary" data-action="add-match" data-field="${field}" data-key="${this.escapeHtml(key)}">+ Add</button></div>`;
    html += '<div class="match-scroll-area">';

    entries.forEach((entry, idx) => {
      const isDeleted = entry.deleted === true;
      const isAdded = entry.added === true;
      const entryClass = `match-entry${isDeleted ? " deleted" : ""}${isAdded ? " added" : ""}`;
      const toggleBtn = isDeleted
        ? `<button class="btn btn-sm btn-unblock" data-action="restore-match" data-field="${field}" data-idx="${idx}" data-key="${this.escapeHtml(key)}">Restore</button>`
        : `<button class="btn btn-sm btn-danger" data-action="remove-match" data-field="${field}" data-idx="${idx}" data-key="${this.escapeHtml(key)}">×</button>`;
      const statusIcon = isAdded
        ? '<span class="header-status-icon added" title="Added">+</span>'
        : '<span class="header-status-icon original" title="Original">●</span>';

      html += `
        <div class="${entryClass}">
          ${statusIcon}
          <input type="text" class="override-input" data-match-key="${idx}" data-field="${field}" data-key="${this.escapeHtml(key)}" value="${this.escapeHtml(entry.name)}" placeholder="Key"${isDeleted ? " disabled" : ""}>
          <input type="text" class="override-input" data-match-value="${idx}" data-field="${field}" data-key="${this.escapeHtml(key)}" value="${this.escapeHtml(String(entry.value))}" placeholder="Value"${isDeleted ? " disabled" : ""}>
          ${toggleBtn}
        </div>
      `;
    });

    html += "</div></div>";

    return html;
  }

  renderMatchEditorJson(matchObj, field, key) {
    if (!matchObj) {
      return '<div class="text-muted">Matching any request to this endpoint</div>';
    }

    const jsonStr =
      typeof matchObj === "string"
        ? matchObj
        : JSON.stringify(matchObj, null, 2);

    return `
      <div class="match-json-editor">
        <textarea class="override-textarea auto-size" data-field="${field}-json" data-key="${this.escapeHtml(key)}" placeholder='{"variableName": "value"}'>${this.escapeHtml(jsonStr)}</textarea>
      </div>
    `;
  }

  getMatchAsArray(matchObj) {
    if (!matchObj) {
      return [];
    }
    if (Array.isArray(matchObj)) {
      return matchObj.map((m) => ({
        name: m.name,
        value: m.value,
        deleted: m.deleted || false,
        added: m.added || false,
      }));
    }
    return Object.entries(matchObj).map(([name, value]) => ({
      name,
      value,
      deleted: false,
      added: false,
    }));
  }

  renderHeadersEditor(headers, viewMode, key) {
    if (viewMode === "json") {
      const headersArray = this.getHeadersAsArray(headers);
      const activeHeaders = {};
      headersArray
        .filter((h) => !h.deleted && h.name)
        .forEach((h) => {
          activeHeaders[h.name] = h.value;
        });
      const jsonStr =
        Object.keys(activeHeaders).length > 0
          ? JSON.stringify(activeHeaders, null, 2)
          : "";
      return `<textarea class="override-textarea override-textarea-sm" data-field="responseHeaders-json" data-key="${this.escapeHtml(key)}" placeholder='{"Content-Type": "application/json"}'>${this.escapeHtml(jsonStr)}</textarea>`;
    }

    const entries = this.getHeadersAsArray(headers);
    let html = '<div class="headers-entries">';

    html += `<div class="headers-add-sticky"><button class="btn btn-sm btn-secondary" data-action="add-header" data-key="${this.escapeHtml(key)}">+ Add Header</button></div>`;
    html += '<div class="headers-scroll-area">';

    entries.forEach((header, idx) => {
      const isDeleted = header.deleted === true;
      const isAdded = header.added === true;
      const entryClass = `header-entry${isDeleted ? " deleted" : ""}${isAdded ? " added" : ""}`;
      const toggleBtn = isDeleted
        ? `<button class="btn btn-sm btn-unblock" data-action="restore-header" data-idx="${idx}" data-key="${this.escapeHtml(key)}">Restore</button>`
        : `<button class="btn btn-sm btn-danger" data-action="remove-header" data-idx="${idx}" data-key="${this.escapeHtml(key)}">×</button>`;
      const statusIcon = isAdded
        ? '<span class="header-status-icon added" title="Added">+</span>'
        : '<span class="header-status-icon original" title="Original">●</span>';

      html += `
        <div class="${entryClass}">
          ${statusIcon}
          <input type="text" class="override-input" data-header-key="${idx}" data-key="${this.escapeHtml(key)}" value="${this.escapeHtml(header.name)}" placeholder="Header name"${isDeleted ? " disabled" : ""}>
          <input type="text" class="override-input" data-header-value="${idx}" data-key="${this.escapeHtml(key)}" value="${this.escapeHtml(header.value)}" placeholder="Value"${isDeleted ? " disabled" : ""}>
          ${toggleBtn}
        </div>
      `;
    });

    html += "</div></div>";

    return html;
  }

  getHeadersAsArray(headers) {
    if (!headers) {
      return [];
    }
    if (Array.isArray(headers)) {
      return headers.map((h) => ({
        name: h.name,
        value: h.value,
        deleted: h.deleted || false,
        added: h.added || false,
      }));
    }
    return Object.entries(headers).map(([name, value]) => ({
      name,
      value,
      deleted: false,
      added: false,
    }));
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
    const btn = e.target.closest("button[data-action]");
    if (btn) {
      const action = OVERRIDE_ACTIONS[btn.dataset.action];
      if (action) {
        action(this, btn.dataset.key, btn.dataset);
      }
      return;
    }

    const row = e.target.closest(".override-row");
    if (row && !e.target.closest(".actions-cell")) {
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

    if (target.dataset.field === "responseHeaders-json") {
      try {
        const parsed = target.value ? JSON.parse(target.value) : null;
        if (parsed) {
          override.responseHeaders = Object.entries(parsed).map(
            ([name, value]) => ({
              name,
              value: String(value),
              deleted: false,
            }),
          );
        } else {
          override.responseHeaders = null;
        }
        target.classList.remove("invalid");
        this.saveOverrides();
      } catch (e) {
        target.classList.add("invalid");
      }
    } else if (target.dataset.field === "matchVariables-json") {
      try {
        override.matchVariables = target.value
          ? JSON.parse(target.value)
          : null;
        target.classList.remove("invalid");
        this.saveOverrides();
      } catch (e) {
        target.classList.add("invalid");
      }
    } else if (target.dataset.headerKey !== undefined) {
      this.updateHeaderKey(
        key,
        parseInt(target.dataset.headerKey),
        target.value,
      );
    } else if (target.dataset.headerValue !== undefined) {
      this.updateHeaderValue(
        key,
        parseInt(target.dataset.headerValue),
        target.value,
      );
    } else if (target.dataset.matchKey !== undefined) {
      this.updateMatchKey(
        key,
        target.dataset.field,
        parseInt(target.dataset.matchKey),
        target.value,
      );
    } else if (target.dataset.matchValue !== undefined) {
      this.updateMatchValue(
        key,
        target.dataset.field,
        parseInt(target.dataset.matchValue),
        target.value,
      );
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

    if (field === "statusCode") {
      override.statusCode = target.value ? parseInt(target.value) : null;
      this.saveOverrides();
    } else if (field === "statusText") {
      override.statusText = target.value || null;
      this.saveOverrides();
    } else if (field === "matchVariables-enabled") {
      override.matchVariablesEnabled = target.checked;
      if (target.checked && !override.matchVariables) {
        override.matchVariables = {};
      }
      this.saveOverrides();
      this.patchOverrideMatch(key);
    } else if (field === "matchParams-enabled") {
      override.matchParamsEnabled = target.checked;
      if (target.checked && !override.matchParams) {
        override.matchParams = [];
      }
      this.saveOverrides();
      this.patchOverrideMatch(key);
    } else if (field === "requestBodyOverrideEnabled") {
      override.requestBodyOverrideEnabled = target.checked;
      this.saveOverrides();
      this.patchOverrideSection(key, "data-request-content", target.checked);
    } else if (field === "responseBodyOverrideEnabled") {
      override.responseBodyOverrideEnabled = target.checked;
      this.saveOverrides();
      this.patchOverrideSection(key, "data-response-content", target.checked);
    }
  }

  setHeadersViewMode(key, view) {
    this.overrideHeadersView.set(key, view);
    this.patchOverrideHeaders(key);
  }

  addHeaderEntry(key) {
    const override = this.overrides.get(key);
    if (!override) {
      return;
    }
    override.responseHeaders = this.getHeadersAsArray(override.responseHeaders);
    override.responseHeaders.push({
      name: "",
      value: "",
      deleted: false,
      added: true,
    });
    this.saveOverrides();
    this.patchOverrideHeaders(key);
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
      this.patchOverrideHeaders(key);
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
      this.patchOverrideHeaders(key);
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
    override[field].push({ name: "", value: "", deleted: false, added: true });
    this.saveOverrides();
    this.patchOverrideMatch(key);
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
      this.patchOverrideMatch(key);
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
      this.patchOverrideMatch(key);
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
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
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

            const editor = this.jsonEditors.get(`${key}-response`);
            if (editor && editor.container.isConnected) {
              editor.setValue(formatted);
            }

            this.addEvent("success", "Imported response body");
          }
        } catch (err) {
          this.addEvent("error", "Invalid JSON file: " + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  importFullOverride() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
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

          overrides.forEach((o) => {
            if (!o.key || !o.type || !o.callName) {
              return;
            }

            const entry = this.normalizeOverride(
              {
                key: o.key,
                type: o.type,
                callName: o.callName,
                enabled: o.enabled !== false,
                scopeOrigin: o.scopeOrigin,
                matchParams: o.matchParams || null,
                matchParamsEnabled: o.matchParamsEnabled || false,
                matchVariables: o.matchVariables || null,
                matchVariablesEnabled: o.matchVariablesEnabled || false,
                requestBodyOverrideEnabled:
                  o.requestBodyOverrideEnabled || false,
                requestBody: o.requestBody || null,
                responseBodyOverrideEnabled:
                  o.responseBodyOverrideEnabled !== false,
                statusCode: this.validStatusCode(o.statusCode),
                statusText: o.statusText || null,
                responseHeaders: o.responseHeaders || null,
                responseBody: o.responseBody || null,
              },
              o.scope === "global" ? "global" : "site",
            );

            if (this.isOldKeyFormat(entry.key)) {
              entry.key = this.migrateOldKey(entry.key);
            }

            this.setRule(this.overrides, entry);
            imported++;
          });

          if (imported > 0) {
            this.attachDebugger()
              .then(() => {
                this.saveOverrides();
                this.renderOverridesList();
                this.addEvent("success", `Imported ${imported} override(s)`);
              })
              .catch(() => {});
          } else {
            this.addEvent("error", "No valid overrides found in file");
          }
        } catch (err) {
          this.addEvent("error", "Invalid JSON file: " + err.message);
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
    this.downloadJson(
      `override-${String(override.callName).replace(/[^a-z0-9]/gi, "_")}.json`,
      override,
    );
    this.addEvent("success", "Exported override");
  }

  exportAllOverrides() {
    if (this.overrides.size === 0) {
      this.addEvent("warning", "No overrides to export");
      return;
    }
    this.downloadJson(
      `overrides-${this.currentOrigin?.replace(/[^a-z0-9]/gi, "_") || "export"}.json`,
      Array.from(this.overrides.values()),
    );
    this.addEvent("success", `Exported ${this.overrides.size} override(s)`);
  }

  downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  handleFilterClick(e) {
    const addBtn = e.target.closest(".chip-add-btn");
    if (addBtn) {
      e.stopPropagation();
      if (addBtn.classList.contains("disabled")) {
        return;
      }
      const menu = addBtn.closest(".chip-add-menu");
      menu.classList.toggle("open");
      return;
    }

    const chipRemove = e.target.closest(".chip-remove");
    if (chipRemove) {
      this.updateFilter(chipRemove.dataset.filter, chipRemove.dataset.value);
      return;
    }

    const addOption = e.target.closest(".chip-add-option");
    if (addOption) {
      this.updateFilter(addOption.dataset.filter, addOption.dataset.value);
      return;
    }

    const btn = e.target.closest(".filter-btn");
    if (!btn) {
      return;
    }

    const filterType = btn.dataset.filter;
    const value = btn.dataset.value;

    btn.parentElement
      .querySelectorAll(".filter-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    this.updateFilter(filterType, value);
  }

  updateFilter(filterType, value) {
    if (filterType === "method") {
      this.toggleMethodFilter(value);
      return;
    }
    this.filters[filterType] = value;
    this.renderCalls();
  }

  toggleMethodFilter(value) {
    if (value === "all") {
      this.filters.methods.clear();
    } else if (this.filters.methods.has(value)) {
      this.filters.methods.delete(value);
    } else {
      if (value === "NOT_OPTIONS") {
        this.filters.methods.delete("OPTIONS");
      } else if (value === "OPTIONS") {
        this.filters.methods.delete("NOT_OPTIONS");
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
      html += Array.from(selected)
        .map(
          (m) =>
            `<span class="filter-chip"><span class="chip-text">${this.escapeHtml(m === "NOT_OPTIONS" ? "!OPTIONS" : m)}</span><button class="chip-remove" data-filter="method" data-value="${this.escapeHtml(m)}">×</button></span>`,
        )
        .join("");
    }

    const available = methods.filter((m) => !selected.has(m));
    const showNotOptions =
      this.knownMethods.has("OPTIONS") && !selected.has("NOT_OPTIONS");
    const hasOptions = available.length > 0 || showNotOptions;

    html += `<div class="chip-add-menu">
      <button class="chip-add-btn${hasOptions ? "" : " disabled"}">+</button>
      ${
        hasOptions
          ? `<div class="chip-add-dropdown">
        ${showNotOptions ? '<button class="chip-add-option" data-filter="method" data-value="NOT_OPTIONS">!OPTIONS</button>' : ""}
        ${available.map((m) => `<button class="chip-add-option" data-filter="method" data-value="${this.escapeHtml(m)}">${this.escapeHtml(m)}</button>`).join("")}
      </div>`
          : ""
      }
    </div>`;

    this.elements.methodFilter.innerHTML = html;
  }

  matchesFilter(call) {
    if (this.filters.type !== "all" && call.type !== this.filters.type) {
      return false;
    }
    const methods = this.filters.methods;
    if (methods.size > 0) {
      const excludesOptions = methods.has("NOT_OPTIONS");
      if (excludesOptions && call.method === "OPTIONS") {
        return false;
      }
      const hasIncludes = methods.size > (excludesOptions ? 1 : 0);
      if (hasIncludes && !methods.has(call.method)) {
        return false;
      }
    }
    if (this.filters.status === "success" && call.hasError) {
      return false;
    }
    if (this.filters.status === "error" && !call.hasError) {
      return false;
    }
    if (this.filters.search) {
      const searchLower = this.filters.search.toLowerCase();
      const matchesName = call.callName.toLowerCase().includes(searchLower);
      const matchesUrl = call.fullUrl?.toLowerCase().includes(searchLower);
      if (!matchesName && !matchesUrl) {
        return false;
      }
    }
    return true;
  }

  getFilteredCalls() {
    const filtered = [];
    this.calls.forEach((call, key) => {
      if (this.matchesFilter(call)) {
        filtered.push([key, call]);
      }
    });
    return filtered;
  }

  startCapture() {
    chrome.devtools.network.getHAR((har) => {
      har.entries.forEach((entry) => this.processEntry(entry));
      this.addEvent("info", `Loaded ${har.entries.length} previous requests`);
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
      this.intercepts.clear();
      this.expandedCall = null;
      this.renderCalls();
      this.addEvent("info", "Page navigated - cleared calls");
      this.loadPersistedState();
    });

    this.updateStatus("Recording");
    this.addEvent("success", "Network capture started");
  }

  getPostDataText(postData) {
    if (postData?.params) {
      const opsParam = postData.params.find((p) => p.name === "operations");
      if (opsParam?.value) {
        return opsParam.value;
      }
    }
    return postData?.text || null;
  }

  processEntry(entry) {
    const { request, response } = entry;
    const url = this.stripQueryParams(request.url);
    const isGql = url.includes("/graphql");
    const postDataText = this.getPostDataText(request.postData);
    const gqlOperation = isGql
      ? this.extractGqlOperation(postDataText)
      : null;
    const callName = gqlOperation || url;

    const variablesOrParams = isGql
      ? this.extractGqlVariables(postDataText)
      : request.postData?.text || this.parseUrlParams(request.url);

    const callKey = this.generateCallKey(
      isGql,
      gqlOperation,
      url,
      variablesOrParams,
    );

    const method = request.method;
    const methodAdded = !this.knownMethods.has(method);
    if (methodAdded) {
      this.knownMethods.add(method);
      this.renderMethodFilter();
    }

    const callData = {
      type: isGql ? "GQL" : "REST",
      callName,
      method,
      fullUrl: request.url,
      status: response.status,
      statusText: response.statusText,
      hasError: response.status >= 400,
      requestHeaders: this.headersToObject(request.headers),
      responseHeaders: this.headersToObject(response.headers),
      requestBody: request.postData?.text || null,
      matchParams: isGql
        ? variablesOrParams
        : this.parseUrlParams(request.url),
      mimeType: response.content?.mimeType,
      entry,
      pending: false,
    };

    if (isGql && response.status === 200) {
      entry.getContent((body) => {
        callData.responseBody = body;
        this.checkGqlErrors(callData, body);
        this.calls.set(callKey, callData);
        this.updateCallRow(callKey);
      });
    } else {
      this.calls.set(callKey, callData);
      if (this.expandedCall === callKey) {
        this.fetchResponseBody(callKey);
      }
      this.updateCallRow(callKey);
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
        callData.status = "200 (GQL Error)";
      }
    } catch (e) {}
  }

  handleTableClick(e) {
    const tab = e.target.closest(".details-tab");
    if (tab) {
      e.stopPropagation();
      this.switchTab(tab.dataset.tab);
      return;
    }

    const headersToggle = e.target.closest(".headers-toggle-btn");
    if (headersToggle) {
      e.stopPropagation();
      this.toggleHeadersTable(headersToggle.dataset.tableId);
      return;
    }

    const cardHeader = e.target.closest(".details-card-header[data-table-id]");
    if (cardHeader) {
      e.stopPropagation();
      this.toggleHeadersTable(cardHeader.dataset.tableId);
      return;
    }

    const copyBtn = e.target.closest(".copy-btn");
    if (copyBtn) {
      e.stopPropagation();
      this.copyContent(copyBtn.dataset.copy, copyBtn.dataset.key);
      return;
    }

    const kebabBtn = e.target.closest(".kebab-btn");
    if (kebabBtn) {
      e.stopPropagation();
      if (kebabBtn.disabled) {
        return;
      }
      this.toggleKebabMenu(kebabBtn);
      return;
    }

    const kebabOption = e.target.closest(".kebab-option");
    if (kebabOption) {
      e.stopPropagation();
      this.handleKebabAction(
        kebabOption.dataset.action,
        kebabOption.dataset.key,
      );
      return;
    }

    const actionBtn = e.target.closest(".btn[data-action]");
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      const callKey = actionBtn.dataset.key;
      if (action === "block" || action === "unblock") {
        this.toggleBlock(callKey);
      } else if (action === "override") {
        this.createOrEditOverride(callKey);
      } else if (action === "delay") {
        this.createOrEditDelay(callKey);
      }
      return;
    }

    if (e.target.closest(".btn")) {
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }

    const row = e.target.closest(".call-row");
    if (row && !row.classList.contains("pending")) {
      this.toggleCallExpansion(row.dataset.callKey);
    }
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll(".details-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === tabName);
    });
    document.querySelectorAll(".details-panel").forEach((p) => {
      p.classList.toggle("active", p.dataset.panel === tabName);
    });
  }

  toggleHeadersTable(tableId) {
    if (this.expandedTables.has(tableId)) {
      this.expandedTables.delete(tableId);
    } else {
      this.expandedTables.add(tableId);
    }

    const side = tableId.endsWith("-req") ? "req" : "res";
    const callKey = tableId.slice(0, -4);
    const call = this.calls.get(callKey);
    if (!call) {
      return;
    }

    const container = this.elements.networkBody.querySelector(
      `[data-headers-body="${CSS.escape(tableId)}"]`,
    );
    if (container) {
      container.innerHTML = this.renderHeaders(
        this.callHeaders(call, side),
        tableId,
      );
    }
  }

  copyContent(type, callKey) {
    const call = this.calls.get(callKey);
    if (!call) {
      return;
    }

    let content = "";
    let label = `${type} body`;

    if (type === "request") {
      content = call.requestBody || "";
    } else if (type === "response") {
      content = call.responseBody || "";
    } else if (type === "requestOverride") {
      const override = this.getOverrideForCurrentSite(callKey);
      if (override) {
        content = override.requestBody || "";
      }
      label = "overridden request body";
    }

    this.copyToClipboard(content, label);
  }

  toggleKebabMenu(btn) {
    const menu = btn.closest(".kebab-menu");
    const wasOpen = menu.classList.contains("open");

    document
      .querySelectorAll(".kebab-menu.open")
      .forEach((m) => m.classList.remove("open"));

    if (!wasOpen) {
      menu.classList.add("open");
    }
  }

  handleKebabAction(action, callKey) {
    document
      .querySelectorAll(".kebab-menu.open")
      .forEach((m) => m.classList.remove("open"));

    if (action === "copy-curl") {
      this.copyCurl(callKey);
    }
  }

  copyCurl(callKey) {
    const call = this.calls.get(callKey);
    if (!call) {
      return;
    }

    let curl = `curl '${call.fullUrl}'`;

    if (call.method !== "GET") {
      curl += ` -X ${call.method}`;
    }

    Object.entries(call.requestHeaders).forEach(([name, value]) => {
      curl += ` -H '${name}: ${value.replace(/'/g, "'\\''")}'`;
    });

    if (call.requestBody) {
      curl += ` --data-raw '${call.requestBody.replace(/'/g, "'\\''")}'`;
    }

    this.copyToClipboard(curl, "cURL");
  }

  copyToClipboard(text, label) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        this.addEvent("success", `Copied ${label} to clipboard`);
      })
      .catch(() => {
        this.addEvent("error", `Failed to copy ${label}`);
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
      this.updateEditorValue(callKey, "responseBodyView", "");
      return;
    }

    call.entry.getContent((body) => {
      call.responseBody = body;
      this.updateEditorValue(callKey, "responseBodyView", body || "");
    });
  }

  toggleDrawer() {
    this.drawerExpanded = !this.drawerExpanded;
    this.elements.statusDrawer.classList.toggle(
      "collapsed",
      !this.drawerExpanded,
    );
    this.elements.statusDrawer.classList.toggle(
      "expanded",
      this.drawerExpanded,
    );
  }

  addEvent(type, message) {
    this.events.unshift({ type, message, time: new Date() });
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }
    this.renderEvents();
  }

  renderEvents() {
    const icons = { info: "●", success: "✓", warning: "⚠", error: "✕" };
    const colors = {
      info: "text-muted",
      success: "text-success",
      warning: "text-warning",
      error: "text-error",
    };

    this.elements.eventList.innerHTML = this.events
      .map(
        (event) => `
      <li class="event-item">
        <span class="event-time">${event.time.toLocaleTimeString()}</span>
        <span class="event-icon ${colors[event.type]}">${icons[event.type]}</span>
        <span class="event-message">${this.escapeHtml(event.message)}</span>
      </li>
    `,
      )
      .join("");
  }

  initDebuggerListeners() {
    if (this.debuggerEventHandler) {
      return;
    }

    this.debuggerEventHandler = (source, method, params) => {
      if (source.tabId !== this.tabId || method !== "Fetch.requestPaused") {
        return;
      }
      this.handlePausedRequest(params);
    };

    this.debuggerDetachHandler = (source, reason) => {
      if (source.tabId === this.tabId) {
        this.debuggerAttached = false;
        this.addEvent("warning", "Debugger detached: " + reason);
        this.renderCalls();
      }
    };
  }

  attachDebugger() {
    if (this.debuggerAttached) {
      return Promise.resolve();
    }

    this.initDebuggerListeners();

    return new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId: this.tabId }, "1.3", () => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || "Unknown error";
          this.addEvent("error", "Debugger attach failed: " + msg);
          reject(new Error(msg));
          return;
        }

        this.debuggerAttached = true;
        chrome.debugger.onEvent.addListener(this.debuggerEventHandler);
        chrome.debugger.onDetach.addListener(this.debuggerDetachHandler);

        chrome.debugger.sendCommand(
          { tabId: this.tabId },
          "Fetch.enable",
          {
            patterns: [
              { requestStage: "Request" },
              { requestStage: "Response" },
            ],
          },
          () => {
            if (chrome.runtime.lastError) {
              const msg = chrome.runtime.lastError.message || "Unknown error";
              this.addEvent("error", "Fetch enable failed: " + msg);
              this.detachDebugger();
              reject(new Error(msg));
              return;
            }
            this.addEvent("success", "Debugger attached for interception");
            resolve();
          },
        );
      });
    });
  }

  describeRequest(request) {
    const url = this.stripQueryParams(request.url);
    const isGql = url.includes("/graphql");
    const postData = request.postData || null;

    if (!postData && request.hasPostData) {
      this.warnMissingPostData(url);
    }

    if (isGql) {
      const operation = this.extractGqlOperation(postData);
      const variables = this.extractGqlVariables(postData);
      return {
        isGql,
        matchParams: variables,
        callKey: operation
          ? this.generateCallKey(true, operation, null, variables)
          : null,
      };
    }

    const urlParams = this.parseUrlParams(request.url);
    return {
      isGql,
      matchParams: urlParams,
      callKey: this.generateCallKey(
        false,
        null,
        url,
        postData || urlParams,
      ),
    };
  }

  warnMissingPostData(url) {
    if (this.missingPostDataWarnings.has(url)) {
      return;
    }
    this.missingPostDataWarnings.add(url);
    this.addEvent(
      "warning",
      `Request body too large to inspect - cannot match ${url}`,
    );
  }

  handlePausedRequest(params) {
    const { requestId, request, responseStatusCode } = params;
    const traceIds = [params.networkId, requestId];

    if (responseStatusCode !== undefined) {
      this.handlePausedResponse(requestId, traceIds, request);
      return;
    }

    const { isGql, matchParams, callKey } = this.describeRequest(request);

    if (!callKey) {
      this.continueRequest(requestId);
      return;
    }

    if (this.isBlockedForCurrentSite(callKey)) {
      this.sendCdp("Fetch.failRequest", {
        requestId,
        errorReason: "BlockedByClient",
      });
      return;
    }

    const delay = this.getActiveDelay(callKey);
    const delayBeforeMs = delay && delay.delayBefore ? delay.delayMs : 0;
    const delaysResponse = Boolean(delay && !delay.delayBefore);
    const override = this.findMatchingOverride(
      callKey,
      matchParams,
      isGql,
      true,
    );

    const overridesRequest =
      override && override.requestBodyOverrideEnabled && override.requestBody;
    const overridesResponse =
      override && override.responseBodyOverrideEnabled !== false;

    if (overridesRequest) {
      if (overridesResponse || delaysResponse) {
        this.rememberIntercept(traceIds, {
          callKey,
          responseOverride: overridesResponse ? override : null,
        });
      }
      this.continueWithModifiedBody(
        requestId,
        override.requestBody,
        delayBeforeMs,
      );
      return;
    }

    if (overridesResponse) {
      this.fulfillWithOverride(requestId, override, delayBeforeMs);
      return;
    }

    if (delaysResponse) {
      this.rememberIntercept(traceIds, { callKey, responseOverride: null });
    }
    this.continueRequest(requestId, delayBeforeMs);
  }

  handlePausedResponse(requestId, traceIds, request) {
    const tracked = this.takeIntercept(traceIds);

    let callKey = tracked ? tracked.callKey : null;
    if (!callKey && this.delays.size > 0) {
      callKey = this.describeRequest(request).callKey;
    }

    const delay = callKey ? this.getActiveDelay(callKey) : null;
    const delayAfterMs = delay && !delay.delayBefore ? delay.delayMs : 0;

    if (tracked && tracked.responseOverride) {
      this.fulfillWithOverride(
        requestId,
        tracked.responseOverride,
        delayAfterMs,
      );
      return;
    }

    this.continueResponse(requestId, delayAfterMs);
  }

  rememberIntercept(ids, data) {
    const keys = Array.from(new Set(ids.filter(Boolean)));
    const entry = { ...data, keys };

    keys.forEach((id) => {
      if (this.intercepts.size >= MAX_TRACKED_INTERCEPTS) {
        this.intercepts.delete(this.intercepts.keys().next().value);
      }
      this.intercepts.set(id, entry);
    });
  }

  takeIntercept(ids) {
    for (const id of ids) {
      const entry = id ? this.intercepts.get(id) : null;
      if (entry) {
        entry.keys.forEach((key) => this.intercepts.delete(key));
        return entry;
      }
    }
    return null;
  }

  isInScope(entry) {
    if (!entry || entry.deleted) {
      return false;
    }
    if (entry.scope === "global") {
      return true;
    }
    return !entry.scopeOrigin || entry.scopeOrigin === this.currentOrigin;
  }

  ruleSpecificity(entry, callKey, baseKey) {
    if (entry.key === callKey) {
      return 0;
    }
    if (entry.key === `${baseKey}:*`) {
      return 1;
    }
    return 2;
  }

  candidateEntries(source, callKey) {
    const baseKey = this.getBaseKey(callKey);
    const matches = [];

    source.forEach((entry) => {
      if (this.getBaseKey(entry.key) !== baseKey || !this.isInScope(entry)) {
        return;
      }
      matches.push(entry);
    });

    return matches.sort((a, b) => {
      const scopeRank =
        (this.ruleScope(a) === "global" ? 1 : 0) -
        (this.ruleScope(b) === "global" ? 1 : 0);
      if (scopeRank !== 0) {
        return scopeRank;
      }
      return (
        this.ruleSpecificity(a, callKey, baseKey) -
        this.ruleSpecificity(b, callKey, baseKey)
      );
    });
  }

  getActiveDelay(callKey) {
    return (
      this.candidateEntries(this.delays, callKey).find(
        (delay) => delay.enabled,
      ) || null
    );
  }

  getDelayForCurrentSite(callKey) {
    return this.candidateEntries(this.delays, callKey)[0] || null;
  }

  attachedRule(source, callKey, appliedRule) {
    const own = this.ownRule(source, callKey);
    if (own && !own.deleted) {
      return own;
    }
    return appliedRule || own || null;
  }

  getOverrideForCurrentSite(callKey) {
    const call = this.calls.get(callKey);
    const isGql = callKey.startsWith("gql:");
    return this.findMatchingOverride(
      callKey,
      call ? this.callMatchParams(call, isGql) : null,
      isGql,
    );
  }

  callMatchParams(call, isGql) {
    if (call.matchParams !== undefined) {
      return call.matchParams;
    }
    if (isGql) {
      return this.extractGqlVariables(call.requestBody);
    }
    return this.parseUrlParams(call.fullUrl);
  }

  findMatchingOverride(callKey, params, isGql, enabledOnly = false) {
    const candidates = this.candidateEntries(this.overrides, callKey);

    for (const override of candidates) {
      if (enabledOnly && !override.enabled) {
        continue;
      }

      const matchEnabled = isGql
        ? override.matchVariablesEnabled
        : override.matchParamsEnabled;

      if (!matchEnabled) {
        return override;
      }

      const criteria = isGql ? override.matchVariables : override.matchParams;
      if (this.matchesCriteria(criteria, params, isGql)) {
        return override;
      }
    }

    return null;
  }

  matchesCriteria(criteria, params, isGql) {
    if (!params) {
      return false;
    }

    const isPlainObject =
      criteria !== null && typeof criteria === "object" && !Array.isArray(criteria);
    const entries =
      isGql && isPlainObject
        ? Object.entries(criteria)
        : this.getMatchAsArray(criteria)
            .filter((match) => !match.deleted && match.name)
            .map((match) => [match.name, match.value]);

    if (entries.length === 0) {
      return true;
    }

    return entries.every(([name, value]) =>
      this.valuesMatch(params[name], value),
    );
  }

  valuesMatch(actual, expected) {
    if (
      (actual !== null && typeof actual === "object") ||
      (expected !== null && typeof expected === "object")
    ) {
      return (
        JSON.stringify(this.sortObjectKeys(actual)) ===
        JSON.stringify(this.sortObjectKeys(expected))
      );
    }
    return String(actual) === String(expected);
  }

  fulfillWithOverride(requestId, override, delayMs = 0) {
    const responseCode = this.validStatusCode(override.statusCode) || 200;
    const responsePhrase = override.statusText || "OK";

    let responseHeaders = [];
    if (override.responseHeaders) {
      const headersArray = this.getHeadersAsArray(override.responseHeaders);
      responseHeaders = headersArray
        .filter((h) => !h.deleted && h.name)
        .map((h) => ({ name: h.name, value: String(h.value) }));
    }

    const hasContentType = responseHeaders.some(
      (h) => h.name.toLowerCase() === "content-type",
    );
    if (!hasContentType) {
      responseHeaders.push({ name: "Content-Type", value: "application/json" });
    }

    this.sendCdp(
      "Fetch.fulfillRequest",
      {
        requestId,
        responseCode,
        responsePhrase,
        responseHeaders,
        body: this.toBase64(override.responseBody || "{}"),
      },
      delayMs,
    );
  }

  continueWithModifiedBody(requestId, requestBody, delayMs = 0) {
    this.sendCdp(
      "Fetch.continueRequest",
      {
        requestId,
        postData: this.toBase64(requestBody || ""),
      },
      delayMs,
    );
  }

  validStatusCode(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 100 || parsed > 599) {
      return null;
    }
    return parsed;
  }

  toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    const chunkSize = 8192;
    let binary = "";

    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }

    return btoa(binary);
  }

  sendCdp(command, params, delayMs = 0) {
    const send = () => {
      chrome.debugger.sendCommand({ tabId: this.tabId }, command, params, () => {
        if (chrome.runtime.lastError) {
          this.reportCdpError(command, chrome.runtime.lastError.message);
        }
      });
    };

    if (delayMs > 0) {
      setTimeout(send, delayMs);
      return;
    }
    send();
  }

  reportCdpError(command, message) {
    const signature = `${command}:${message}`;
    if (this.reportedCdpErrors.has(signature)) {
      return;
    }
    this.reportedCdpErrors.add(signature);
    this.addEvent("error", `${command} failed: ${message}`);
  }

  continueRequest(requestId, delayMs = 0) {
    this.sendCdp("Fetch.continueRequest", { requestId }, delayMs);
  }

  continueResponse(requestId, delayMs = 0) {
    const send = () => {
      chrome.debugger.sendCommand(
        { tabId: this.tabId },
        "Fetch.continueResponse",
        { requestId },
        () => {
          if (chrome.runtime.lastError) {
            this.continueRequest(requestId);
          }
        },
      );
    };

    if (delayMs > 0) {
      setTimeout(send, delayMs);
      return;
    }
    send();
  }

  isBlockedForCurrentSite(callKey) {
    return this.candidateEntries(this.blockedCalls, callKey).length > 0;
  }

  toggleBlock(callKey) {
    const entry = this.candidateEntries(this.blockedCalls, callKey)[0];
    if (entry) {
      return this.removeBlock(entry);
    }
    return this.addBlock(callKey);
  }

  toggleBlockEntry(ruleId) {
    const entry = this.blockedCalls.get(ruleId);
    if (entry) {
      return this.removeBlock(entry);
    }
    const template = this.blockedListSnapshot.get(ruleId);
    return template ? this.addBlock(template.key, template) : Promise.resolve();
  }

  removeBlock(entry) {
    this.blockedCalls.delete(this.ruleId(entry));
    this.addEvent("info", `Un-Blocked: ${entry.key}`);
    this.saveBlockedCalls();
    this.checkDebuggerNeeded();
    this.renderCalls();
    return Promise.resolve();
  }

  addBlock(callKey, template = null) {
    return this.attachDebugger()
      .then(() => {
        this.setRule(
          this.blockedCalls,
          template
            ? { ...template, key: callKey }
            : { key: callKey, scope: "site", scopeOrigin: this.currentOrigin },
        );
        this.addEvent("success", `Blocking: ${callKey}`);
        this.saveBlockedCalls();
        this.renderCalls();
      })
      .catch(() => {});
  }

  createOrEditOverride(callKey) {
    const call = this.calls.get(callKey);
    if (!call) {
      return;
    }

    const existing = this.attachedRule(
      this.overrides,
      callKey,
      this.getOverrideForCurrentSite(callKey),
    );

    if (existing) {
      this.expandedOverride = this.ruleId(existing);
      this.switchView("overrides");
      return;
    }

    const isGql = callKey.startsWith("gql:");
    const urlParams = isGql ? null : this.parseUrlParams(call.fullUrl);
    const matchParams = isGql
      ? null
      : Object.entries(urlParams || {}).map(([name, value]) => ({
          name,
          value,
          deleted: false,
          added: false,
        }));
    const matchVariables = isGql
      ? this.extractGqlVariables(call.requestBody) || {}
      : null;
    const matchParamsEnabled = !isGql;
    const matchVariablesEnabled = isGql;

    let responseHeaders = null;
    if (call.responseHeaders && Object.keys(call.responseHeaders).length > 0) {
      responseHeaders = Object.entries(call.responseHeaders).map(
        ([name, value]) => ({
          name,
          value: String(value),
          deleted: false,
          added: false,
        }),
      );
    }

    const entry = this.setRule(this.overrides, {
      key: callKey,
      type: call.type,
      callName: call.callName,
      enabled: true,
      scope: "site",
      scopeOrigin: this.currentOrigin,
      matchParams,
      matchParamsEnabled,
      matchVariables,
      matchVariablesEnabled,
      requestBodyOverrideEnabled: false,
      requestBody: this.formatJsonString(call.requestBody),
      responseBodyOverrideEnabled: true,
      statusCode: this.numericStatus(call),
      statusText: call.statusText || "",
      responseHeaders,
      responseBody: this.formatJsonString(call.responseBody),
    });

    this.attachDebugger()
      .then(() => {
        this.saveOverrides();
        this.addEvent("success", `Created override for: ${call.callName}`);
      })
      .catch(() => {});

    this.expandedOverride = this.ruleId(entry);
    this.switchView("overrides");
  }

  numericStatus(call) {
    if (typeof call.status === "number") {
      return call.status;
    }
    if (typeof call.statusCode === "number") {
      return call.statusCode;
    }
    return null;
  }

  ruleStore(name) {
    if (name === "overrides") {
      return {
        source: this.overrides,
        label: "Override",
        save: () => this.saveOverrides(),
        render: () => this.renderOverridesList(),
        expandedField: "expandedOverride",
      };
    }
    return {
      source: this.delays,
      label: "Delay",
      save: () => this.saveDelays(),
      render: () => this.renderDelaysList(),
      expandedField: "expandedDelay",
    };
  }

  collapseRule(store, ruleId) {
    if (this[store.expandedField] === ruleId) {
      this[store.expandedField] = null;
    }
  }

  commitRule(store) {
    store.save();
    store.render();
    this.renderCalls();
  }

  setRuleEnabled(name, ruleId) {
    const store = this.ruleStore(name);
    const rule = store.source.get(ruleId);
    if (!rule) {
      return;
    }
    rule.enabled = !rule.enabled;
    this.commitRule(store);
    this.addEvent(
      "info",
      `${store.label} ${rule.enabled ? "enabled" : "disabled"}: ${rule.callName}`,
    );
    this.checkDebuggerNeeded();
  }

  setRuleDeleted(name, ruleId, deleted) {
    const store = this.ruleStore(name);
    const rule = store.source.get(ruleId);
    if (!rule) {
      return;
    }
    rule.deleted = deleted;
    if (deleted) {
      this.collapseRule(store, ruleId);
    }
    this.commitRule(store);
    this.addEvent(
      "info",
      `${deleted ? "Deleted" : "Restored"} ${store.label.toLowerCase()}: ${rule.callName}`,
    );
  }

  purgeRule(name, ruleId) {
    const store = this.ruleStore(name);
    const rule = store.source.get(ruleId);
    if (!rule) {
      return;
    }
    store.source.delete(ruleId);
    this.collapseRule(store, ruleId);
    this.commitRule(store);
    this.addEvent(
      "info",
      `Permanently deleted ${store.label.toLowerCase()}: ${rule.callName}`,
    );
    this.checkDebuggerNeeded();
  }

  setRuleScope(name, ruleId, scope) {
    const store = this.ruleStore(name);
    const rule = store.source.get(ruleId);
    if (!rule) {
      return;
    }
    if (!this.applyRuleScope(store.source, ruleId, rule, scope)) {
      store.render();
      return;
    }
    if (this[store.expandedField] === ruleId) {
      this[store.expandedField] = this.ruleId(rule);
    }
    store.save();
    store.render();
    this.addEvent(
      "info",
      `${store.label} scope changed to ${scope === "global" ? "All Sites" : "This Site"}`,
    );
  }

  createOrEditDelay(callKey) {
    const call = this.calls.get(callKey);
    if (!call) {
      return;
    }

    const existing = this.attachedRule(
      this.delays,
      callKey,
      this.getDelayForCurrentSite(callKey),
    );

    if (existing) {
      this.expandedDelay = this.ruleId(existing);
      this.switchView("delays");
      return;
    }

    const entry = this.setRule(this.delays, {
      key: callKey,
      type: call.type,
      callName: call.callName,
      enabled: true,
      scope: "site",
      scopeOrigin: this.currentOrigin,
      delayMs: 15000,
      delayBefore: true,
    });

    this.attachDebugger()
      .then(() => {
        this.saveDelays();
        this.addEvent("success", `Created delay for: ${call.callName}`);
      })
      .catch(() => {});

    this.expandedDelay = this.ruleId(entry);
    this.switchView("delays");
  }

  renderDelaysList() {
    const delays = Array.from(this.delays.entries());

    if (delays.length === 0) {
      this.elements.delaysList.innerHTML = this.renderScopeFilterToolbar();
      this.elements.delaysEmptyState.style.display = "flex";
      return;
    }

    this.elements.delaysEmptyState.style.display = "none";

    const filtered = this.filterByScope(delays);
    const hasFilteredResults = filtered.length > 0;

    const noResultsRow = !hasFilteredResults
      ? `<tr><td colspan="5" class="no-filter-results">No ${this.scopeFilter === "global" ? "global" : "site-specific"} delays</td></tr>`
      : "";

    const rows = filtered
      .map(([key, delay]) => {
        const isExpanded = this.expandedDelay === key && !delay.deleted;
        const isDeleted = delay.deleted === true;
        const badgeClass = delay.type === "GQL" ? "badge-gql" : "badge-rest";
        const isWildcard = this.isWildcardKey(delay.key);
        const wildcardBadge = isWildcard
          ? '<span class="badge badge-wildcard">All Vars</span>'
          : "";
        const rowClass = `delay-row${isExpanded ? " expanded" : ""}${isDeleted ? " deleted" : ""}`;
        const scope = delay.scope || "site";
        const scopeLabel =
          scope === "global"
            ? "All Sites"
            : this.truncateScopeOrigin(delay.scopeOrigin || this.currentOrigin);
        const scopeBadgeClass =
          scope === "global" ? "scope-badge-global" : "scope-badge-site";

        let actionsHtml;
        if (isDeleted) {
          actionsHtml = `
          <button class="btn btn-sm btn-unblock" data-action="restore" data-key="${this.escapeHtml(key)}">Restore</button>
          <button class="btn btn-sm btn-danger" data-action="permanent-delete" data-key="${this.escapeHtml(key)}">Remove</button>
        `;
        } else {
          const toggleClass = delay.enabled
            ? "btn btn-sm btn-unblock"
            : "btn btn-sm btn-secondary";
          const toggleText = delay.enabled ? "Enabled" : "Disabled";
          actionsHtml = `
          <button class="${toggleClass}" data-action="toggle-enabled" data-key="${this.escapeHtml(key)}">${toggleText}</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-key="${this.escapeHtml(key)}">Delete</button>
        `;
        }

        let rowHtml = `
        <tr class="${rowClass}" data-key="${this.escapeHtml(key)}">
          <td><span class="expand-icon">${isDeleted ? "" : "▶"}</span> <span class="badge ${badgeClass}">${delay.type}</span>${wildcardBadge}</td>
          <td class="call-name" title="${this.escapeHtml(delay.callName)}">${this.escapeHtml(this.truncateCallName(delay.callName))}</td>
          <td><span class="scope-badge ${scopeBadgeClass}" title="${this.escapeHtml(scope === "global" ? "Applies to all sites" : delay.scopeOrigin || this.currentOrigin)}">${scopeLabel}</span></td>
          <td>${delay.delayMs / 1000}s ${delay.delayBefore ? "before" : "after"}</td>
          <td class="actions-cell">${actionsHtml}</td>
        </tr>
      `;

        if (isExpanded) {
          rowHtml += `<tr class="delay-details visible"><td colspan="5">${this.renderDelayForm(delay, key)}</td></tr>`;
        }

        return rowHtml;
      })
      .join("");

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
    const scope = delay.scope || "site";
    const scopeOrigin = delay.scopeOrigin || this.currentOrigin;

    return `
      <div class="delay-form">
        <div class="delay-form-row">
          <div class="delay-field">
            <span class="delay-field-label">Scope:</span>
            <div class="scope-toggle-group">
              <button class="scope-toggle-btn${scope === "site" ? " active" : ""}" data-action="set-delay-scope" data-scope="site" data-key="${this.escapeHtml(key)}">This Site Only</button>
              <button class="scope-toggle-btn${scope === "global" ? " active" : ""}" data-action="set-delay-scope" data-scope="global" data-key="${this.escapeHtml(key)}">All Sites</button>
            </div>
            <span class="scope-origin-label ${scope === "global" ? "hidden" : ""}">${this.escapeHtml(scopeOrigin)}</span>
          </div>
        </div>
        <div class="delay-form-row">
          <div class="delay-field">
            <span class="delay-field-label">Delay Duration:</span>
            <input type="number" class="delay-input" data-field="delaySeconds" data-key="${this.escapeHtml(key)}" value="${delay.delayMs / 1000}" min="1" max="300">
            <span class="delay-unit">seconds</span>
          </div>
        </div>
        <div class="delay-form-row">
          <div class="delay-field">
            <span class="delay-field-label">Delay Timing:</span>
            <div class="delay-toggle-group">
              <button class="delay-toggle-btn${delay.delayBefore ? " active" : ""}" data-action="set-timing" data-timing="before" data-key="${this.escapeHtml(key)}">Before Request</button>
              <button class="delay-toggle-btn${!delay.delayBefore ? " active" : ""}" data-action="set-timing" data-timing="after" data-key="${this.escapeHtml(key)}">After Response</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  handleDelaysListClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (btn) {
      const action = DELAY_ACTIONS[btn.dataset.action];
      if (action) {
        action(this, btn.dataset.key, btn.dataset);
      }
      return;
    }

    const row = e.target.closest(".delay-row");
    if (row && !e.target.closest(".actions-cell")) {
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

    if (target.dataset.field === "delaySeconds") {
      const seconds = parseInt(target.value) || 15;
      delay.delayMs = Math.max(1, Math.min(300, seconds)) * 1000;
      this.saveDelays();
      this.renderCalls();
    }
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

  checkDebuggerNeeded() {
    const activeOverrides = Array.from(this.overrides.values()).filter(
      (o) => !o.deleted && o.enabled,
    );
    const activeDelays = Array.from(this.delays.values()).filter(
      (d) => !d.deleted && d.enabled,
    );
    const needed =
      this.blockedCalls.size > 0 ||
      activeOverrides.length > 0 ||
      activeDelays.length > 0;

    if (needed && !this.debuggerAttached) {
      this.attachDebugger().catch(() => {});
    } else if (!needed && this.debuggerAttached) {
      this.detachDebugger();
    }
  }

  detachDebugger() {
    if (this.debuggerAttached) {
      if (this.debuggerEventHandler) {
        chrome.debugger.onEvent.removeListener(this.debuggerEventHandler);
      }
      if (this.debuggerDetachHandler) {
        chrome.debugger.onDetach.removeListener(this.debuggerDetachHandler);
      }
      chrome.debugger.detach({ tabId: this.tabId });
      this.debuggerAttached = false;
      this.intercepts.clear();
      this.addEvent("info", "Debugger detached");
    }
  }

  stripQueryParams(url) {
    const idx = url.indexOf("?");
    return idx === -1 ? url : url.substring(0, idx);
  }

  truncateCallName(name) {
    if (name.length <= 150) {
      return name;
    }
    return name.slice(0, 150) + "...";
  }

  parseGqlBody(postData) {
    if (!postData) {
      return null;
    }
    try {
      const data = JSON.parse(postData);
      if (data.operationName || data.query) {
        return data;
      }
      if (data.operations) {
        const ops = Array.isArray(data.operations)
          ? data.operations[0]
          : data.operations;
        return typeof ops === "string" ? JSON.parse(ops) : ops;
      }
      return data;
    } catch (e) {
      return this.parseMultipartGqlBody(postData);
    }
  }

  parseMultipartGqlBody(postData) {
    const operations = this.extractMultipartField(postData, "operations");
    if (!operations) {
      return null;
    }
    try {
      return JSON.parse(operations);
    } catch (e) {
      return null;
    }
  }

  extractMultipartField(raw, fieldName) {
    const marker = `name="${fieldName}"`;
    const markerIndex = raw.indexOf(marker);
    if (markerIndex === -1) {
      return null;
    }

    const headerEnd = raw.indexOf("\r\n\r\n", markerIndex);
    if (headerEnd === -1) {
      return null;
    }

    const valueStart = headerEnd + 4;
    const valueEnd = raw.indexOf("\r\n--", valueStart);
    return raw.substring(valueStart, valueEnd === -1 ? undefined : valueEnd);
  }

  parseUrlParams(url) {
    if (!url) {
      return null;
    }
    try {
      const params = Object.fromEntries(new URL(url).searchParams.entries());
      return Object.keys(params).length > 0 ? params : null;
    } catch (e) {
      return null;
    }
  }

  extractGqlOperation(postData) {
    if (!postData) {
      return null;
    }
    try {
      const data = this.parseGqlBody(postData);
      if (!data) {
        return null;
      }
      if (data.operationName) {
        return data.operationName;
      }
      const match = (data.query || "").match(
        /(?:query|mutation|subscription)\s+(\w+)/,
      );
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  extractGqlVariables(postData) {
    if (!postData) {
      return null;
    }
    try {
      const data = this.parseGqlBody(postData);
      return data?.variables || null;
    } catch (e) {
      return null;
    }
  }

  hasActiveFilters() {
    return (
      this.filters.search !== "" ||
      this.filters.type !== "all" ||
      this.filters.methods.size > 0 ||
      this.filters.status !== "all"
    );
  }

  updateCallCount(filtered, total) {
    const el = this.elements.callCount;
    if (!el) {
      return;
    }

    if (total === 0) {
      el.textContent = "";
    } else if (this.hasActiveFilters()) {
      el.textContent = `${filtered} of ${total}`;
    } else {
      el.textContent = `${total} calls`;
    }
  }

  hashString(str) {
    if (!str) {
      return "00000000";
    }
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  sortObjectKeys(obj) {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sortObjectKeys(item));
    }
    const sorted = {};
    Object.keys(obj)
      .sort()
      .forEach((key) => {
        sorted[key] = this.sortObjectKeys(obj[key]);
      });
    return sorted;
  }

  generateCallKey(isGql, operation, url, variablesOrParams) {
    const base = isGql ? `gql:${operation}` : `rest:${url}`;
    let hashInput = "";
    if (variablesOrParams) {
      if (typeof variablesOrParams === "string") {
        try {
          const parsed = JSON.parse(variablesOrParams);
          hashInput = JSON.stringify(this.sortObjectKeys(parsed));
        } catch (e) {
          hashInput = variablesOrParams;
        }
      } else {
        hashInput = JSON.stringify(this.sortObjectKeys(variablesOrParams));
      }
    }
    const hash = this.hashString(hashInput);
    return `${base}:${hash}`;
  }

  ruleScope(entry) {
    return entry.scope === "global" ? "global" : "site";
  }

  ruleId(entry) {
    return `${this.ruleScope(entry)}|${entry.key}`;
  }

  setRule(source, entry) {
    source.set(this.ruleId(entry), entry);
    return entry;
  }

  rekeyRule(source, previousId, entry) {
    source.delete(previousId);
    source.set(this.ruleId(entry), entry);
    return this.ruleId(entry);
  }

  getRule(source, callKey, scope) {
    return source.get(`${scope}|${callKey}`) || null;
  }

  ownRule(source, callKey) {
    return (
      this.getRule(source, callKey, "site") ||
      this.getRule(source, callKey, "global")
    );
  }

  getBaseKey(callKey) {
    const lastColon = callKey.lastIndexOf(":");
    if (lastColon === -1) {
      return callKey;
    }
    const suffix = callKey.substring(lastColon + 1);
    if (suffix === "*" || /^[0-9a-f]{8}$/.test(suffix)) {
      return callKey.substring(0, lastColon);
    }
    return callKey;
  }

  isWildcardKey(callKey) {
    return callKey.endsWith(":*");
  }

  isOldKeyFormat(callKey) {
    const lastColon = callKey.lastIndexOf(":");
    if (lastColon === -1) {
      return true;
    }
    const suffix = callKey.substring(lastColon + 1);
    return suffix !== "*" && !/^[0-9a-f]{8}$/.test(suffix);
  }

  migrateOldKey(oldKey) {
    return `${oldKey}:*`;
  }

  getDisplayName(callKey) {
    const baseKey = this.getBaseKey(callKey);
    return baseKey.replace(/^(gql:|rest:)/, "");
  }

  appendCallRow(key) {
    const call = this.calls.get(key);
    if (!call || !this.matchesFilter(call)) {
      this.refreshCallCount();
      return;
    }

    this.elements.emptyState.style.display = "none";
    this.elements.networkBody.appendChild(this.createCallRowElement(key, call));
    this.refreshCallCount();
  }

  updateCallRow(key) {
    const call = this.calls.get(key);
    const existingRow = this.elements.networkBody.querySelector(
      `tr.call-row[data-call-key="${CSS.escape(key)}"]`,
    );

    if (!existingRow) {
      if (call && this.matchesFilter(call)) {
        this.appendCallRow(key);
      }
      return;
    }

    if (!call || !this.matchesFilter(call)) {
      this.discardCallRow(existingRow, key);
      if (this.elements.networkBody.children.length === 0) {
        this.elements.emptyState.style.display = "flex";
      }
      this.refreshCallCount();
      return;
    }

    const row = this.refreshCallRowElement(existingRow, key, call);
    if (this.syncDetailRow(row, key, call)) {
      this.initNetworkJsonEditors();
    }
    this.refreshCallCount();
  }

  elementFromHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    return template.content.firstChild;
  }

  detailRowFor(row) {
    const next = row.nextElementSibling;
    return next && next.classList.contains("call-details") ? next : null;
  }

  createCallRowElement(key, call) {
    const html = this.renderCallRow(key, call);
    this.callRowHtml.set(key, html);
    return this.elementFromHtml(html);
  }

  createDetailRowElement(key, call) {
    return this.elementFromHtml(
      `<tr class="call-details visible"><td colspan="5">${this.renderCallDetails(call, key)}</td></tr>`,
    );
  }

  refreshCallRowElement(row, key, call) {
    const html = this.renderCallRow(key, call);
    if (this.callRowHtml.get(key) === html) {
      return row;
    }

    const replacement = this.elementFromHtml(html);
    this.callRowHtml.set(key, html);
    row.replaceWith(replacement);
    return replacement;
  }

  discardCallRow(row, key) {
    const details = this.detailRowFor(row);
    if (details) {
      details.remove();
    }
    this.cleanupDetailRowEditors(key);
    this.callRowHtml.delete(key);
    row.remove();
  }

  syncDetailRow(row, key, call) {
    const details = this.detailRowFor(row);
    const wanted = this.expandedCall === key && !call.pending;

    if (!wanted) {
      if (details) {
        this.cleanupDetailRowEditors(key);
        details.remove();
      }
      return null;
    }

    if (!details) {
      const created = this.createDetailRowElement(key, call);
      this.elements.networkBody.insertBefore(created, row.nextSibling);
      return created;
    }

    this.patchDetailRow(details, key, call);
    return details;
  }

  patchDetailRow(details, key, call) {
    const generalBody = details.querySelector("[data-general-body]");
    if (generalBody) {
      generalBody.innerHTML = this.renderGeneralGrid(call);
    }

    HEADER_SIDES.forEach((side) => {
      const tableId = `${key}-${side}`;
      const headersBody = details.querySelector(
        `[data-headers-body="${CSS.escape(tableId)}"]`,
      );
      if (headersBody) {
        headersBody.innerHTML = this.renderHeaders(
          this.callHeaders(call, side),
          tableId,
        );
      }
    });

    this.patchRequestPanel(details, key);
  }

  patchRequestPanel(details, key) {
    const panel = details.querySelector('.details-panel[data-panel="request"]');
    if (!panel) {
      return;
    }

    const wantsComparison = this.activeRequestOverride(key) !== null;
    const showsComparison = panel.querySelector(".request-comparison") !== null;
    if (wantsComparison === showsComparison) {
      return;
    }

    this.cleanupDetailRowEditors(key, REQUEST_EDITOR_FIELDS);
    panel.innerHTML = this.renderRequestPanel(key);

    const tab = details.querySelector('.details-tab[data-tab="request"]');
    if (tab) {
      tab.innerHTML = this.renderRequestTabLabel(key);
    }
  }

  cleanupDetailRowEditors(callKey, fields = DETAIL_EDITOR_FIELDS) {
    fields.forEach((field) => {
      const editorKey = `${callKey}-${field}`;
      const editor = this.jsonEditors.get(editorKey);
      if (editor) {
        editor.destroy();
        this.jsonEditors.delete(editorKey);
      }
    });
  }

  refreshCallCount() {
    const filtered = this.getFilteredCalls();
    this.updateCallCount(filtered.length, this.calls.size);
  }

  updateEditorValue(callKey, field, value) {
    const editorKey = `${callKey}-${field}`;
    const editor = this.jsonEditors.get(editorKey);
    if (editor) {
      editor.updateValue(value);
    }
  }

  clearCallRows() {
    const body = this.elements.networkBody;
    body.querySelectorAll("tr.call-row").forEach((row) => {
      this.cleanupDetailRowEditors(row.dataset.callKey);
    });
    this.callRowHtml.clear();
    body.innerHTML = "";
  }

  syncCallRows(filtered) {
    const body = this.elements.networkBody;
    const wanted = new Set(filtered.map(([key]) => key));
    const existing = new Map();

    Array.from(body.querySelectorAll("tr.call-row")).forEach((row) => {
      const key = row.dataset.callKey;
      if (wanted.has(key)) {
        existing.set(key, row);
        return;
      }
      this.discardCallRow(row, key);
    });

    let anchor = null;

    filtered.forEach(([key, call]) => {
      const found = existing.get(key);
      const row = found
        ? this.refreshCallRowElement(found, key, call)
        : this.createCallRowElement(key, call);

      const target = anchor ? anchor.nextElementSibling : body.firstElementChild;
      if (target !== row) {
        const details = this.detailRowFor(row);
        body.insertBefore(row, target);
        if (details) {
          body.insertBefore(details, row.nextSibling);
        }
      }

      anchor = this.syncDetailRow(row, key, call) || row;
    });
  }

  renderCalls() {
    const { emptyState } = this.elements;
    const filtered = this.getFilteredCalls();

    this.updateCallCount(filtered.length, this.calls.size);

    if (filtered.length === 0) {
      this.clearCallRows();
      emptyState.style.display = "flex";
      return;
    }

    emptyState.style.display = "none";
    this.syncCallRows(filtered);
    this.initNetworkJsonEditors();
  }

  initNetworkJsonEditors() {
    const activeKeys = new Set();

    this.elements.networkBody
      .querySelectorAll(".json-editor-container[data-callkey]")
      .forEach((container) => {
        const callKey = container.dataset.callkey;
        const field = container.dataset.field;
        const editorKey = `${callKey}-${field}`;
        const call = this.calls.get(callKey);
        activeKeys.add(editorKey);

        if (!call) {
          return;
        }

        let value = "";
        let placeholder = "";

        if (field === "requestBody") {
          value = call.requestBody || "";
          placeholder = "No request body";
        } else if (field === "responseBodyView") {
          if (call.responseBody === undefined) {
            placeholder = "Loading response...";
          } else if (call.responseBody === null && !call.entry) {
            placeholder =
              "Response not captured (request started before DevTools)";
          } else {
            value = call.responseBody || "";
            placeholder = "No response body";
          }
        } else if (field === "requestBodyOverride") {
          const overrideKey = container.dataset.overrideKey;
          const override = this.overrides.get(overrideKey);
          if (override && override.requestBody) {
            value = override.requestBody;
          }
          placeholder = "No override body";
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
          readOnly: true,
        });

        editor.setValue(value);
        this.jsonEditors.set(editorKey, editor);
      });

    this.jsonEditors.forEach((editor, key) => {
      const isDetailEditor = DETAIL_EDITOR_FIELDS.some((field) =>
        key.endsWith(`-${field}`),
      );
      if (isDetailEditor && !activeKeys.has(key)) {
        editor.destroy();
        this.jsonEditors.delete(key);
      }
    });
  }

  renderCallRow(key, call) {
    const isExpanded = this.expandedCall === key;
    const isPending = call.pending;
    const isBlocked = this.isBlockedForCurrentSite(key);
    const appliedOverride = this.getOverrideForCurrentSite(key);
    const appliedDelay = this.getDelayForCurrentSite(key);
    const override = this.attachedRule(this.overrides, key, appliedOverride);
    const delay = this.attachedRule(this.delays, key, appliedDelay);
    const hasOverride = override !== null;
    const overrideEnabled = Boolean(appliedOverride && appliedOverride.enabled);
    const hasDelay = delay !== null;
    const delayEnabled = Boolean(appliedDelay && appliedDelay.enabled);
    const badgeClass = call.type === "GQL" ? "badge-gql" : "badge-rest";
    const statusClass = isPending
      ? "text-muted"
      : call.hasError
        ? "text-error"
        : "text-success";
    const rowClass = `call-row${isExpanded ? " expanded" : ""}${isPending ? " pending" : ""}${isBlocked ? " blocked" : ""}${overrideEnabled ? " overridden" : ""}${delayEnabled ? " delayed" : ""}`;
    const blockBtnClass = isBlocked
      ? "btn btn-sm btn-unblock"
      : "btn btn-sm btn-danger";
    const blockBtnText = isBlocked ? "Un-Block" : "Block";
    const blockAction = isBlocked ? "unblock" : "block";
    const overrideBtnClass = hasOverride
      ? "btn btn-sm btn-override-active"
      : "btn btn-sm btn-primary";
    const overrideBtnText = hasOverride ? "Edit Override" : "Override";
    const delayBtnClass = hasDelay
      ? "btn btn-sm btn-delay-active"
      : "btn btn-sm btn-delay";
    const delayBtnText = hasDelay ? "Edit Delay" : "Delay";
    let statusIndicators = "";
    if (overrideEnabled) {
      statusIndicators +=
        '<span class="override-indicator" title="Override active">⚡</span>';
    }
    if (delayEnabled) {
      statusIndicators += `<span class="delay-indicator" title="Delay active: ${appliedDelay.delayMs / 1000}s ${appliedDelay.delayBefore ? "before" : "after"}">⏱</span>`;
    }

    return `
      <tr class="${rowClass}" data-call-key="${this.escapeHtml(key)}">
        <td><span class="expand-icon">${isPending ? '<span class="spinner"></span>' : "▶"}</span> <span class="badge ${badgeClass}">${call.type}</span></td>
        <td class="method-cell">${call.method}</td>
        <td class="call-name" title="${this.escapeHtml(call.callName)}">${this.escapeHtml(this.truncateCallName(call.callName))}</td>
        <td><span class="font-semibold ${statusClass}">${isPending ? "Loading..." : call.status}</span>${statusIndicators}</td>
        <td class="actions-cell">
          <button class="${overrideBtnClass}" data-action="override" data-key="${this.escapeHtml(key)}"${isPending ? " disabled" : ""}>${overrideBtnText}</button>
          <button class="${delayBtnClass}" data-action="delay" data-key="${this.escapeHtml(key)}"${isPending ? " disabled" : ""}>${delayBtnText}</button>
          <button class="${blockBtnClass}" data-action="${blockAction}" data-key="${this.escapeHtml(key)}"${isPending ? " disabled" : ""}>${blockBtnText}</button>
          <div class="kebab-menu">
            <button class="kebab-btn" data-key="${this.escapeHtml(key)}"${isPending ? " disabled" : ""}>⋮</button>
            <div class="kebab-dropdown">
              <button class="kebab-option" data-action="copy-curl" data-key="${this.escapeHtml(key)}">Copy cURL</button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  callHeaders(call, side) {
    const own = side === "req" ? call.requestHeaders : call.responseHeaders;
    if ((own && Object.keys(own).length > 0) || !call.entry) {
      return own;
    }
    return this.headersToObject(
      side === "req"
        ? call.entry.request?.headers
        : call.entry.response?.headers,
    );
  }

  activeRequestOverride(callKey) {
    const override = this.getOverrideForCurrentSite(callKey);
    const active =
      override &&
      override.enabled &&
      override.requestBodyOverrideEnabled &&
      override.requestBody;
    return active ? override : null;
  }

  renderGeneralGrid(call) {
    const statusClass = call.hasError ? "text-error" : "text-success";
    return `
      <div class="info-grid">
        <span class="info-label">URL</span>
        <span class="info-value">${this.escapeHtml(call.fullUrl || "")}</span>
        <span class="info-label">Method</span>
        <span class="info-value">${this.escapeHtml(call.method || "")}</span>
        <span class="info-label">Status</span>
        <span class="info-value ${statusClass}" data-general-status>${call.status} ${this.escapeHtml(call.statusText || "")}</span>
      </div>
    `;
  }

  renderRequestTabLabel(callKey) {
    const badge = this.activeRequestOverride(callKey)
      ? ' <span class="override-badge">Override</span>'
      : "";
    return `Request${badge}`;
  }

  renderRequestPanel(callKey) {
    const override = this.activeRequestOverride(callKey);

    if (!override) {
      return `
      <div class="panel-toolbar">
        <button class="btn btn-sm btn-secondary copy-btn" data-copy="request" data-key="${this.escapeHtml(callKey)}">Copy</button>
      </div>
      <div class="json-editor-container" data-field="requestBody" data-callkey="${this.escapeHtml(callKey)}" data-readonly="true"></div>
    `;
    }

    return `
      <div class="request-comparison">
        <div class="request-comparison-side">
          <div class="request-comparison-header">
            <span class="request-comparison-title">Original Request</span>
            <button class="btn btn-sm btn-secondary copy-btn" data-copy="request" data-key="${this.escapeHtml(callKey)}">Copy</button>
          </div>
          <div class="json-editor-container" data-field="requestBody" data-callkey="${this.escapeHtml(callKey)}" data-readonly="true"></div>
        </div>
        <div class="request-comparison-side">
          <div class="request-comparison-header">
            <span class="request-comparison-title overridden">Overridden Request</span>
            <button class="btn btn-sm btn-secondary copy-btn" data-copy="requestOverride" data-key="${this.escapeHtml(callKey)}">Copy</button>
          </div>
          <div class="json-editor-container" data-field="requestBodyOverride" data-callkey="${this.escapeHtml(callKey)}" data-override-key="${this.escapeHtml(this.ruleId(override))}" data-readonly="true"></div>
        </div>
      </div>
    `;
  }

  renderCallDetails(call, callKey) {
    return `
      <div class="details-content">
        <nav class="details-tabs">
          <button class="details-tab${this.activeTab === "headers" ? " active" : ""}" data-tab="headers">Headers</button>
          <button class="details-tab${this.activeTab === "request" ? " active" : ""}" data-tab="request">${this.renderRequestTabLabel(callKey)}</button>
          <button class="details-tab${this.activeTab === "response" ? " active" : ""}" data-tab="response">Response</button>
        </nav>
        <section class="details-panel${this.activeTab === "headers" ? " active" : ""}" data-panel="headers">
          <div class="details-card">
            <div class="details-card-header">General</div>
            <div class="details-card-body" data-general-body>${this.renderGeneralGrid(call)}</div>
          </div>
          <div class="details-card">
            <div class="details-card-header clickable" data-table-id="${callKey}-req">Request Headers</div>
            <div class="details-card-body" data-headers-body="${callKey}-req">${this.renderHeaders(this.callHeaders(call, "req"), `${callKey}-req`)}</div>
          </div>
          <div class="details-card">
            <div class="details-card-header clickable" data-table-id="${callKey}-res">Response Headers</div>
            <div class="details-card-body" data-headers-body="${callKey}-res">${this.renderHeaders(this.callHeaders(call, "res"), `${callKey}-res`)}</div>
          </div>
        </section>
        <section class="details-panel${this.activeTab === "request" ? " active" : ""}" data-panel="request">
          ${this.renderRequestPanel(callKey)}
        </section>
        <section class="details-panel${this.activeTab === "response" ? " active" : ""}" data-panel="response">
          <div class="panel-toolbar">
            <button class="btn btn-sm btn-secondary copy-btn" data-copy="response" data-key="${this.escapeHtml(callKey)}">Copy</button>
          </div>
          <div class="json-editor-container" data-field="responseBodyView" data-callkey="${this.escapeHtml(callKey)}" data-readonly="true"></div>
        </section>
      </div>
    `;
  }

  renderHeaders(headers, tableId) {
    if (!headers || Object.keys(headers).length === 0) {
      return '<div class="text-muted" style="padding: 8px 16px;">Headers not captured</div>';
    }

    const entries = Object.entries(headers);
    const maxVisible = 7;
    const needsCollapse = entries.length > maxVisible;
    const isExpanded = this.expandedTables?.has(tableId);

    const visibleEntries =
      needsCollapse && !isExpanded ? entries.slice(0, maxVisible) : entries;
    const hiddenCount = entries.length - maxVisible;

    let html = `<div class="headers-list" data-table-id="${this.escapeHtml(tableId)}">`;
    html += visibleEntries
      .map(
        ([name, value]) =>
          `<div class="headers-row"><span class="headers-label">${this.escapeHtml(name)}</span><span class="headers-value">${this.escapeHtml(value)}</span></div>`,
      )
      .join("");
    html += "</div>";

    if (needsCollapse) {
      if (isExpanded) {
        html += `<button class="headers-toggle-btn" data-table-id="${this.escapeHtml(tableId)}">Show less</button>`;
      } else {
        html += `<button class="headers-toggle-btn" data-table-id="${this.escapeHtml(tableId)}">Show ${hiddenCount} more...</button>`;
      }
    }

    return html;
  }

  escapeHtml(str) {
    if (str === null || str === undefined) {
      return "";
    }
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  clear() {
    const count = this.calls.size;
    this.calls.clear();
    this.expandedCall = null;
    this.renderCalls();
    this.updateStatus("Cleared");
    this.addEvent("info", `Cleared ${count} captured calls`);
  }

  toggleRecording(enabled) {
    this.isRecording = enabled;
    this.updateStatus(enabled ? "Recording" : "Paused");
    this.addEvent("info", enabled ? "Recording resumed" : "Recording paused");
  }

  updateStatus(message) {
    this.elements.statusText.textContent = message;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.networkWizard = new NetworkWizardPanel();
});
