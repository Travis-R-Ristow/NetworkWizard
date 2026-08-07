const TEXT_VIEW_MAX_RATIO = 0.4;
const TEXT_VIEW_MIN_HEIGHT = 120;

class JsonEditor {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.options = {
      onChange: null,
      readOnly: false,
      placeholder: 'Enter JSON...',
      ...options
    };
    
    this.value = '';
    this.parsedJson = null;
    this.parseError = null;
    this.mode = 'tree';
    this.collapsedPaths = new Set();
    this.pathMeta = new Map();
    this.searchState = {
      query: '',
      matches: [],
      currentIndex: -1
    };
    
    this.init();
  }

  init() {
    this.container.classList.add('json-editor');
    this.render();
    this.bindEvents();
  }

  render() {
    this.container.innerHTML = `
      <div class="json-editor-toolbar">
        <div class="json-editor-mode-toggle">
          <button type="button" class="json-editor-mode-btn active" data-mode="tree">Tree</button>
          <button type="button" class="json-editor-mode-btn" data-mode="text">Text</button>
        </div>
        <div class="json-editor-search">
          <input type="text" class="json-editor-search-input" placeholder="Search...">
          <span class="json-editor-search-count"></span>
          <button type="button" class="json-editor-search-btn" data-action="prev" title="Previous match">▲</button>
          <button type="button" class="json-editor-search-btn" data-action="next" title="Next match">▼</button>
          <button type="button" class="json-editor-search-btn" data-action="clear" title="Clear search">×</button>
        </div>
        <div class="json-editor-actions">
          <button type="button" class="json-editor-action-btn" data-action="expand-all" title="Expand all">⊞</button>
          <button type="button" class="json-editor-action-btn" data-action="collapse-all" title="Collapse all">⊟</button>
          <button type="button" class="json-editor-action-btn" data-action="format" title="Format JSON">{ }</button>
        </div>
      </div>
      <div class="json-editor-content">
        <div class="json-editor-tree-view"></div>
        <textarea class="json-editor-text-view hidden" placeholder="${this.options.placeholder}"></textarea>
      </div>
      <div class="json-editor-status"></div>
      <div class="json-editor-resize-handle"></div>
    `;

    this.elements = {
      toolbar: this.container.querySelector('.json-editor-toolbar'),
      modeButtons: this.container.querySelectorAll('.json-editor-mode-btn'),
      searchInput: this.container.querySelector('.json-editor-search-input'),
      searchCount: this.container.querySelector('.json-editor-search-count'),
      content: this.container.querySelector('.json-editor-content'),
      treeView: this.container.querySelector('.json-editor-tree-view'),
      textView: this.container.querySelector('.json-editor-text-view'),
      status: this.container.querySelector('.json-editor-status'),
      resizeHandle: this.container.querySelector('.json-editor-resize-handle')
    };

    if (this.options.readOnly) {
      this.elements.textView.readOnly = true;
      this.container.setAttribute('data-readonly', 'true');
    }
  }

  bindEvents() {
    this.elements.toolbar.addEventListener('click', (e) => this.handleToolbarClick(e));
    this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
    this.elements.searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));
    this.elements.treeView.addEventListener('click', (e) => this.handleTreeClick(e));
    this.elements.textView.addEventListener('input', () => this.handleTextInput());
    this.elements.textView.addEventListener('keydown', (e) => this.handleTextKeydown(e));

    this.container.setAttribute('tabindex', '-1');
    this.container.addEventListener('keydown', (e) => {
      if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        this.elements.searchInput.focus();
        this.elements.searchInput.select();
      }
    });

    this.elements.treeView.addEventListener('click', (e) => {
      if (!e.target.closest('.json-value') && !e.target.closest('.json-inline-edit')) {
        this.container.focus();
      }
    });

    this.bindResize();
  }

  bindResize() {
    const handle = this.elements.resizeHandle;
    let startY = 0;
    let startHeight = 0;

    const onMouseMove = (e) => {
      const delta = e.clientY - startY;
      const newHeight = Math.max(100, startHeight + delta) + "px";
      this.container.style.maxHeight = newHeight;
      this.container.style.height = newHeight;
      this.fitTextView();
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      this.container.classList.remove("resizing");
    };

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startY = e.clientY;
      startHeight = this.container.offsetHeight;
      this.container.classList.add("resizing");
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    handle.addEventListener("dblclick", () => {
      this.container.style.maxHeight = "";
      this.container.style.height = "";
      this.fitTextView();
    });
  }

  handleToolbarClick(e) {
    const modeBtn = e.target.closest('.json-editor-mode-btn');
    if (modeBtn) {
      this.setMode(modeBtn.dataset.mode);
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      if (action === 'prev') {
        this.navigateSearch(-1);
      } else if (action === 'next') {
        this.navigateSearch(1);
      } else if (action === 'clear') {
        this.clearSearch();
      } else if (action === 'expand-all') {
        this.expandAll();
      } else if (action === 'collapse-all') {
        this.collapseAll();
      } else if (action === 'format') {
        this.formatJson();
      }
    }
  }

  handleTreeClick(e) {
    const toggle = e.target.closest('.json-node-toggle');
    if (toggle) {
      const path = toggle.dataset.path;
      this.toggleCollapse(path);
      return;
    }

    if (this.options.readOnly) {
      return;
    }

    const valueEl = e.target.closest('.json-value');
    if (valueEl && !valueEl.classList.contains('editing')) {
      const node = valueEl.closest('.json-node');
      if (node) {
        this.startInlineEdit(node, valueEl);
      }
    }
  }

  startInlineEdit(node, valueEl) {
    const path = node.dataset.path;
    const currentValue = this.getValueAtPath(path);
    const type = this.getType(currentValue);

    if (type === 'object' || type === 'array') {
      return;
    }

    valueEl.classList.add('editing');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'json-inline-edit';

    if (type === 'string') {
      input.value = currentValue;
    } else if (type === 'null') {
      input.value = 'null';
    } else {
      input.value = String(currentValue);
    }

    input.dataset.originalType = type;
    input.dataset.path = path;

    const originalHtml = valueEl.innerHTML;
    valueEl.innerHTML = '';
    valueEl.appendChild(input);
    input.focus();
    input.select();

    const finishEdit = (save) => {
      if (!valueEl.contains(input)) {
        return;
      }

      if (save) {
        const newValue = this.parseInputValue(input.value, input.dataset.originalType);
        this.setValueAtPath(path, newValue);
        this.value = JSON.stringify(this.parsedJson, null, 2);
        this.renderTree();

        if (this.options.onChange) {
          this.options.onChange(this.value);
        }
      } else {
        valueEl.innerHTML = originalHtml;
        valueEl.classList.remove('editing');
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishEdit(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finishEdit(false);
      }
    });

    input.addEventListener('blur', () => {
      finishEdit(true);
    });
  }

  parseInputValue(inputValue, originalType) {
    const trimmed = inputValue.trim();

    if (trimmed === 'null') {
      return null;
    }
    if (trimmed === 'true') {
      return true;
    }
    if (trimmed === 'false') {
      return false;
    }

    const num = Number(trimmed);
    if (!isNaN(num) && trimmed !== '' && originalType === 'number') {
      return num;
    }

    return inputValue;
  }

  getValueAtPath(path) {
    const meta = this.pathMeta.get(path);
    if (!meta) {
      return undefined;
    }

    let current = this.parsedJson;

    for (const part of meta.parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  setValueAtPath(path, value) {
    const meta = this.pathMeta.get(path);
    if (!meta) {
      return;
    }

    const parts = meta.parts;

    if (parts.length === 0) {
      this.parsedJson = value;
      return;
    }

    let current = this.parsedJson;

    for (let i = 0; i < parts.length - 1; i++) {
      current = current[parts[i]];
      if (current === null || current === undefined) {
        return;
      }
    }

    current[parts[parts.length - 1]] = value;
  }

  handleTextInput() {
    this.value = this.elements.textView.value;
    this.parseJson();
    this.updateStatus();
    this.fitTextView();

    if (this.options.onChange) {
      this.options.onChange(this.value);
    }
  }

  handleTextKeydown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = this.elements.textView.selectionStart;
      const end = this.elements.textView.selectionEnd;
      const value = this.elements.textView.value;
      this.elements.textView.value = value.substring(0, start) + '  ' + value.substring(end);
      this.elements.textView.selectionStart = this.elements.textView.selectionEnd = start + 2;
      this.handleTextInput();
    }
  }

  handleSearch(query) {
    this.searchState.query = query.toLowerCase();
    this.searchState.matches = [];
    this.searchState.currentIndex = -1;

    if (this.mode === 'tree') {
      this.renderTree();
    } else {
      this.highlightTextMatches();
    }

    this.updateSearchCount();
  }

  handleSearchKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.navigateSearch(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      this.clearSearch();
      this.elements.searchInput.blur();
    }
  }

  setMode(mode) {
    if (this.mode === mode) {
      return;
    }

    if (this.mode === 'text') {
      this.value = this.elements.textView.value;
      this.parseJson();
    }

    this.mode = mode;
    this.elements.modeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    if (mode === 'tree') {
      this.elements.treeView.classList.remove('hidden');
      this.elements.textView.classList.add('hidden');
      this.renderTree();
    } else {
      this.elements.treeView.classList.add('hidden');
      this.elements.textView.classList.remove('hidden');
      this.elements.textView.value = this.value;
      this.formatJson();
      this.fitTextView();
      if (this.searchState.query) {
        this.highlightTextMatches();
      }
    }
  }

  setValue(value) {
    if (typeof value === 'object') {
      this.value = JSON.stringify(value, null, 2);
    } else {
      this.value = value || '';
    }

    this.parseJson();

    if (this.mode === 'tree') {
      this.renderTree();
    } else {
      this.elements.textView.value = this.value;
      this.fitTextView();
    }

    this.updateStatus();
  }

  updateValue(value) {
    const scrollTop = this.elements.treeView.scrollTop;
    const searchQuery = this.searchState.query;
    const searchCurrentIndex = this.searchState.currentIndex;
    const preservedCollapsedPaths = new Set(this.collapsedPaths);

    if (typeof value === 'object') {
      this.value = JSON.stringify(value, null, 2);
    } else {
      this.value = value || '';
    }

    this.parseJson();
    this.collapsedPaths = preservedCollapsedPaths;

    if (this.mode === 'tree') {
      this.renderTree();
      this.elements.treeView.scrollTop = scrollTop;
    } else {
      this.elements.textView.value = this.value;
      this.fitTextView();
    }

    if (searchQuery) {
      this.searchState.query = searchQuery;
      this.searchState.currentIndex = searchCurrentIndex;
      this.handleSearch(searchQuery);
      if (searchCurrentIndex >= 0 && searchCurrentIndex < this.searchState.matches.length) {
        this.searchState.currentIndex = searchCurrentIndex;
        this.updateSearchCount();
      }
    }

    this.updateStatus();
  }

  getValue() {
    if (this.mode === 'text') {
      return this.elements.textView.value;
    }
    return this.value;
  }

  parseJson() {
    if (!this.value || !this.value.trim()) {
      this.parsedJson = null;
      this.parseError = null;
      return;
    }

    try {
      this.parsedJson = JSON.parse(this.value);
      this.parseError = null;
    } catch (e) {
      this.parsedJson = null;
      this.parseError = e.message;
    }
  }

  renderTree() {
    if (this.parseError) {
      this.elements.treeView.innerHTML = `<div class="json-editor-error">${this.escapeHtml(this.parseError)}</div>`;
      return;
    }

    if (this.parsedJson === null && !this.value.trim()) {
      this.elements.treeView.innerHTML = `<div class="json-editor-empty">${this.options.placeholder}</div>`;
      return;
    }

    this.searchState.matches = [];
    this.pathMeta = new Map();
    const html = this.renderNode(this.parsedJson, '$', null, 0);
    this.elements.treeView.innerHTML = html;
    this.updateSearchCount();
  }

  renderNode(value, path, key, depth, trailingComma = false, parts = [], parentPath = null) {
    const type = this.getType(value);
    const isCollapsed = this.collapsedPaths.has(path);
    const commaHtml = trailingComma ? '<span class="json-comma">,</span>' : '';
    const safePath = this.escapeHtml(path);

    this.pathMeta.set(path, { parts, parentPath });

    const keyMatches = this.doesKeyMatch(key);
    const valueMatches = this.doesValueMatch(value, type);

    if (keyMatches) {
      this.searchState.matches.push({ path, type: 'key' });
    }
    if (valueMatches) {
      this.searchState.matches.push({ path, type: 'value' });
    }

    const keyHtml = key !== null
      ? `<span class="json-key${keyMatches ? ' search-match' : ''}">"${this.escapeHtml(String(key))}"</span><span class="json-colon">: </span>`
      : '';

    if (type === 'object' || type === 'array') {
      const entries = type === 'object' ? Object.entries(value) : value.map((v, i) => [i, v]);
      const bracketOpen = type === 'object' ? '{' : '[';
      const bracketClose = type === 'object' ? '}' : ']';
      const isEmpty = entries.length === 0;

      if (isEmpty) {
        return `<div class="json-node" data-path="${safePath}">
          ${keyHtml}<span class="json-bracket">${bracketOpen}${bracketClose}</span>${commaHtml}
        </div>`;
      }

      const toggleIcon = isCollapsed ? '▶' : '▼';
      const preview = isCollapsed ? this.getCollapsedPreview(value, type) : '';

      let html = `<div class="json-node json-node-expandable${isCollapsed ? ' collapsed' : ''}" data-path="${safePath}">
        <span class="json-node-toggle" data-path="${safePath}">${toggleIcon}</span>
        ${keyHtml}<span class="json-bracket">${bracketOpen}</span>`;

      if (isCollapsed) {
        html += `<span class="json-collapsed-preview">${preview}</span>`;
        html += `<span class="json-bracket">${bracketClose}</span>${commaHtml}`;
      }

      html += '</div>';

      if (!isCollapsed) {
        html += `<div class="json-node-children">`;
        entries.forEach(([k, v], index) => {
          const childPath = type === 'object' ? `${path}.${k}` : `${path}[${k}]`;
          const hasTrailingComma = index < entries.length - 1;
          html += `<div class="json-node-child">${this.renderNode(v, childPath, k, depth + 1, hasTrailingComma, parts.concat([k]), path)}</div>`;
        });
        html += `</div>`;
        html += `<div class="json-node"><span class="json-bracket">${bracketClose}</span>${commaHtml}</div>`;
      }

      return html;
    }

    const valueClass = `json-value json-${type}${valueMatches ? ' search-match' : ''}`;
    let displayValue;

    if (type === 'string') {
      displayValue = `"${this.escapeHtml(value)}"`;
    } else if (type === 'null') {
      displayValue = 'null';
    } else {
      displayValue = this.escapeHtml(String(value));
    }

    return `<div class="json-node" data-path="${safePath}">${keyHtml}<span class="${valueClass}">${displayValue}</span>${commaHtml}</div>`;
  }

  getType(value) {
    if (value === null) {
      return 'null';
    }
    if (Array.isArray(value)) {
      return 'array';
    }
    return typeof value;
  }

  getCollapsedPreview(value, type) {
    if (type === 'array') {
      return `${value.length} items...`;
    }
    const keys = Object.keys(value);
    if (keys.length <= 3) {
      return keys.map(k => `"${this.escapeHtml(k)}"`).join(', ') + '...';
    }
    return `${keys.length} properties...`;
  }

  toggleCollapse(path) {
    if (this.collapsedPaths.has(path)) {
      this.collapsedPaths.delete(path);
    } else {
      this.collapsedPaths.add(path);
    }
    this.renderTree();
  }

  expandAll() {
    this.collapsedPaths.clear();
    this.renderTree();
  }

  collapseAll() {
    this.collapsedPaths.clear();
    this.collectAllPaths(this.parsedJson, '$');
    this.renderTree();
  }

  collectAllPaths(value, path) {
    const type = this.getType(value);
    if (type === 'object' || type === 'array') {
      const entries = type === 'object' ? Object.entries(value) : value.map((v, i) => [i, v]);
      if (entries.length > 0) {
        this.collapsedPaths.add(path);
        entries.forEach(([k, v]) => {
          const childPath = type === 'object' ? `${path}.${k}` : `${path}[${k}]`;
          this.collectAllPaths(v, childPath);
        });
      }
    }
  }

  doesKeyMatch(key) {
    if (!this.searchState.query || key === null) {
      return false;
    }
    return String(key).toLowerCase().includes(this.searchState.query);
  }

  doesValueMatch(value, type) {
    if (!this.searchState.query) {
      return false;
    }
    if (type === 'object' || type === 'array') {
      return false;
    }
    return String(value).toLowerCase().includes(this.searchState.query);
  }

  highlightTextMatches() {
    this.searchState.matches = [];
    if (!this.searchState.query) {
      return;
    }

    const text = this.elements.textView.value.toLowerCase();
    const query = this.searchState.query;
    let index = 0;

    while ((index = text.indexOf(query, index)) !== -1) {
      this.searchState.matches.push(index);
      index += query.length;
    }

    this.updateSearchCount();
    
    if (this.searchState.matches.length > 0 && this.searchState.currentIndex === -1) {
      this.navigateSearch(1);
    }
  }

  navigateSearch(direction) {
    if (this.searchState.matches.length === 0) {
      return;
    }

    this.searchState.currentIndex += direction;

    if (this.searchState.currentIndex >= this.searchState.matches.length) {
      this.searchState.currentIndex = 0;
    } else if (this.searchState.currentIndex < 0) {
      this.searchState.currentIndex = this.searchState.matches.length - 1;
    }

    this.updateSearchCount();

    if (this.mode === 'tree') {
      this.scrollToTreeMatch();
    } else {
      this.scrollToTextMatch();
    }
  }

  scrollToTreeMatch() {
    const match = this.searchState.matches[this.searchState.currentIndex];
    if (!match) {
      return;
    }

    this.expandPathToNode(match.path);

    const allMatches = this.elements.treeView.querySelectorAll('.search-match');
    allMatches.forEach(el => el.classList.remove('search-current'));

    const targetNode = this.elements.treeView.querySelector(`[data-path="${CSS.escape(match.path)}"]`);
    if (targetNode) {
      const selector = match.type === 'key' ? '.json-key.search-match' : '.json-value.search-match';
      const targetElement = targetNode.querySelector(selector);
      if (targetElement) {
        targetElement.classList.add('search-current');
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  expandPathToNode(path) {
    let meta = this.pathMeta.get(path);

    while (meta && meta.parentPath) {
      this.collapsedPaths.delete(meta.parentPath);
      meta = this.pathMeta.get(meta.parentPath);
    }

    this.renderTree();
  }

  scrollToTextMatch() {
    const position = this.searchState.matches[this.searchState.currentIndex];
    if (position === undefined) {
      return;
    }

    const searchHasFocus = document.activeElement === this.elements.searchInput;
    if (!searchHasFocus) {
      this.elements.textView.focus();
      this.elements.textView.setSelectionRange(position, position + this.searchState.query.length);
    }

    const lineHeight = parseInt(getComputedStyle(this.elements.textView).lineHeight) || 18;
    const textBeforeMatch = this.elements.textView.value.substring(0, position);
    const lineNumber = textBeforeMatch.split('\n').length;
    this.elements.textView.scrollTop = (lineNumber - 3) * lineHeight;
  }

  clearSearch() {
    this.searchState.query = '';
    this.searchState.matches = [];
    this.searchState.currentIndex = -1;
    this.elements.searchInput.value = '';
    this.updateSearchCount();
    
    if (this.mode === 'tree') {
      this.renderTree();
    }
  }

  updateSearchCount() {
    const { matches, currentIndex, query } = this.searchState;
    
    if (!query) {
      this.elements.searchCount.textContent = '';
      return;
    }

    if (matches.length === 0) {
      this.elements.searchCount.textContent = 'No matches';
      return;
    }

    this.elements.searchCount.textContent = `${currentIndex + 1} of ${matches.length}`;
  }

  formatJson() {
    if (this.parseError || !this.parsedJson) {
      return;
    }

    this.value = JSON.stringify(this.parsedJson, null, 2);

    if (this.mode === 'text') {
      this.elements.textView.value = this.value;
      this.fitTextView();
    }

    if (this.options.onChange) {
      this.options.onChange(this.value);
    }
  }

  fitTextView() {
    if (this.mode !== 'text') {
      return;
    }

    const textView = this.elements.textView;

    if (this.container.style.height) {
      textView.style.height = `${this.elements.content.clientHeight}px`;
      return;
    }

    const maxHeight = Math.max(
      TEXT_VIEW_MIN_HEIGHT,
      window.innerHeight * TEXT_VIEW_MAX_RATIO,
    );

    textView.style.height = 'auto';
    textView.style.height = `${Math.min(textView.scrollHeight, maxHeight)}px`;
  }

  updateStatus() {
    if (this.parseError) {
      this.elements.status.textContent = `Error: ${this.parseError}`;
      this.elements.status.className = 'json-editor-status error';
    } else if (this.parsedJson) {
      const size = this.value.length;
      const sizeStr = size > 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} bytes`;
      this.elements.status.textContent = `Valid JSON • ${sizeStr}`;
      this.elements.status.className = 'json-editor-status valid';
    } else {
      this.elements.status.textContent = '';
      this.elements.status.className = 'json-editor-status';
    }
  }

  escapeHtml(str) {
    if (str === null || str === undefined) {
      return '';
    }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  setReadOnly(readOnly) {
    this.options.readOnly = readOnly;
    this.elements.textView.readOnly = readOnly;
    if (readOnly) {
      this.container.setAttribute('data-readonly', 'true');
    } else {
      this.container.removeAttribute('data-readonly');
    }
  }

  focus() {
    if (this.mode === 'text') {
      this.elements.textView.focus();
    } else {
      this.elements.searchInput.focus();
    }
  }

  destroy() {
    this.container.innerHTML = '';
    this.container.classList.remove('json-editor');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = JsonEditor;
}
