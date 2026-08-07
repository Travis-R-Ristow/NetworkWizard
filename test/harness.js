const fs = require('fs');
const path = require('node:path').join(__dirname, '..', 'panel', 'panel.js');
const src = fs.readFileSync(path, 'utf8')
  .replace(/document\.addEventListener\("DOMContentLoaded"[\s\S]*$/, '');

const noop = () => {};
const listener = { addListener: noop, removeListener: noop };
global.chrome = {
  devtools: {
    inspectedWindow: { tabId: 1, eval: (expr, cb) => cb('https://site-a.test', null) },
    network: { getHAR: (cb) => cb({ entries: [] }), onRequestFinished: listener, onNavigated: listener },
    panels: {},
  },
  runtime: { connect: () => ({ postMessage: noop, onMessage: listener, onDisconnect: listener }), lastError: null },
  storage: { local: { get: () => Promise.resolve({}), set: noop } },
  debugger: { attach: noop, detach: noop, sendCommand: noop, onEvent: listener, onDetach: listener },
};

const stubEl = () => ({
  addEventListener: noop, querySelectorAll: () => [], querySelector: () => null,
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  style: {}, dataset: {}, insertAdjacentHTML: noop, children: [],
  set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
  set textContent(v) { this._text = v; }, get textContent() { return this._text || ''; },
});
global.document = {
  getElementById: stubEl, querySelector: stubEl, querySelectorAll: () => [],
  addEventListener: noop, createElement: () => stubEl(), body: stubEl(), documentElement: {},
};
const windowListeners = new Map();
global.window = {
  innerHeight: 800,
  getSelection: () => null,
  addEventListener: (name, fn) => {
    if (!windowListeners.has(name)) {
      windowListeners.set(name, []);
    }
    windowListeners.get(name).push(fn);
  },
  removeEventListener: noop,
};
const fireWindowEvent = (name) => {
  (windowListeners.get(name) || []).forEach((fn) => fn());
};
global.CSS = { escape: (s) => s };
global.JsonEditor = class { constructor() {} setValue() {} destroy() {} };

const NetworkWizardPanel = eval(src + '; NetworkWizardPanel');

const p = new NetworkWizardPanel();
p.currentOrigin = 'https://site-a.test';
p.storeLoaded = true;
p.renderCalls = noop; p.renderOverridesList = noop; p.renderBlockedList = noop;
p.renderDelaysList = noop; p.renderScopedView = noop; p.addEvent = noop;
p.saveOverrides = noop; p.saveBlockedCalls = noop; p.saveDelays = noop;

module.exports = { p, NetworkWizardPanel, fireWindowEvent };
