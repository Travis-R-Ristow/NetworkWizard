const { p, NetworkWizardPanel } = require('./harness.js');

let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
};

p.renderCalls = NetworkWizardPanel.prototype.renderCalls;
const body = p.elements.networkBody;

const call = (name, extra = {}) => ({
  type: 'REST', callName: name, method: 'GET', fullUrl: `https://site-a.test/${name}`,
  status: 200, statusText: 'OK', hasError: false, pending: false,
  requestHeaders: {}, responseHeaders: {}, requestBody: null, ...extra,
});

const seed = () => {
  p.calls.clear();
  p.overrides.clear();
  p.blockedCalls.clear();
  p.delays.clear();
  p.expandedCall = null;
  p.filters.search = '';
  body.children.slice().forEach((c) => c.remove());
  p.callRowHtml.clear();
  ['alpha', 'beta', 'gamma'].forEach((n) => p.calls.set(`rest:${n}:aaaaaaaa`, call(n)));
};

const rowKeys = () => body.children
  .filter((c) => c.classList.contains('call-row'))
  .map((c) => c.dataset.callKey);
const layout = () => body.children.map((c) =>
  c.classList.contains('call-details') ? 'details' : c.dataset.callKey);

// --- baseline render ---
seed();
p.renderCalls();
t('renders one row per filtered call', rowKeys(), ['rest:alpha:aaaaaaaa', 'rest:beta:aaaaaaaa', 'rest:gamma:aaaaaaaa']);

// --- an unchanged row is not replaced ---
const alphaRow = body.children[0];
p.renderCalls();
t('unchanged row keeps its DOM node', body.children[0] === alphaRow, true);

// --- a changed row IS replaced ---
p.setRule(p.blockedCalls, { key: 'rest:alpha:aaaaaaaa', scope: 'site', scopeOrigin: p.currentOrigin });
p.renderCalls();
t('changed row is re-rendered', body.children[0] !== alphaRow, true);
t('re-rendered row reflects the change', body.children[0].innerHTML.includes('Un-Block'), true);
p.blockedCalls.clear();

// --- expanding inserts the detail row in the right place ---
p.expandedCall = 'rest:beta:aaaaaaaa';
p.renderCalls();
t('detail row sits directly after its call row',
  layout(), ['rest:alpha:aaaaaaaa', 'rest:beta:aaaaaaaa', 'details', 'rest:gamma:aaaaaaaa']);

// --- THE POINT: the detail row survives re-renders untouched ---
const detail = body.children[2];
p.renderCalls();
t('detail row keeps its DOM node across a re-render', body.children[2] === detail, true);
t('detail row is never detached', detail.parent === body, true);

p.calls.get('rest:alpha:aaaaaaaa').hasError = true;
p.calls.get('rest:alpha:aaaaaaaa').status = 500;
p.renderCalls();
t('detail row survives a sibling row changing', body.children[2] === detail, true);

p.setRule(p.delays, { key: 'rest:gamma:aaaaaaaa', scope: 'site', scopeOrigin: p.currentOrigin, enabled: true, delayMs: 2000, delayBefore: true });
p.renderCalls();
t('detail row survives a rule being attached elsewhere', body.children[2] === detail, true);
p.delays.clear();

// --- a new call appends without disturbing the open panel ---
p.calls.set('rest:delta:aaaaaaaa', call('delta'));
p.renderCalls();
t('new call is appended in order',
  layout(), ['rest:alpha:aaaaaaaa', 'rest:beta:aaaaaaaa', 'details', 'rest:gamma:aaaaaaaa', 'rest:delta:aaaaaaaa']);
t('detail row still the same node after an append', body.children[2] === detail, true);

// --- filtering the expanded row out, then back in ---
p.filters.search = 'gamma';
p.renderCalls();
t('filter hides non-matching rows', rowKeys(), ['rest:gamma:aaaaaaaa']);
t('expansion is remembered while filtered out', p.expandedCall, 'rest:beta:aaaaaaaa');

p.filters.search = '';
p.renderCalls();
t('row returns in its last state (still expanded)',
  layout(), ['rest:alpha:aaaaaaaa', 'rest:beta:aaaaaaaa', 'details', 'rest:gamma:aaaaaaaa', 'rest:delta:aaaaaaaa']);

// --- collapsing removes the detail row ---
p.expandedCall = null;
p.renderCalls();
t('collapsing drops the detail row',
  layout(), ['rest:alpha:aaaaaaaa', 'rest:beta:aaaaaaaa', 'rest:gamma:aaaaaaaa', 'rest:delta:aaaaaaaa']);

// --- a pending call never gets a detail row ---
seed();
p.calls.set('rest:pending:aaaaaaaa', call('pending', { pending: true, status: null }));
p.expandedCall = 'rest:pending:aaaaaaaa';
p.renderCalls();
t('a pending row has no detail panel', layout().includes('details'), false);

// --- removed calls take their row, detail row and editors with them ---
seed();
p.expandedCall = 'rest:beta:aaaaaaaa';
p.renderCalls();
p.jsonEditors.set('rest:beta:aaaaaaaa-requestBody', { destroy() { this.destroyed = true; }, container: {} });
const editor = p.jsonEditors.get('rest:beta:aaaaaaaa-requestBody');
p.calls.delete('rest:beta:aaaaaaaa');
p.renderCalls();
t('removed call drops its row and detail row', layout(), ['rest:alpha:aaaaaaaa', 'rest:gamma:aaaaaaaa']);
t('removed call destroys its editors', editor.destroyed, true);
t('removed call is forgotten by the html cache', p.callRowHtml.has('rest:beta:aaaaaaaa'), false);

// --- empty result clears everything ---
p.filters.search = 'nothing-matches';
p.renderCalls();
t('no matches clears the table', body.children.length, 0);
t('no matches shows the empty state', p.elements.emptyState.style.display, 'flex');

// --- the open panel is patched in place, not rebuilt ---
seed();
const KEY = 'rest:beta:aaaaaaaa';
p.expandedCall = KEY;
p.renderCalls();
const panelDetail = p.elements.networkBody.children[2];
const requestPanel = () => panelDetail.querySelector('.details-panel[data-panel="request"]');
const requestTab = () => panelDetail.querySelector('.details-tab[data-tab="request"]');

t('request panel starts as a single editor', requestPanel().querySelector('.request-comparison'), null);
t('request tab starts without an Override badge', requestTab().querySelector('.override-badge'), null);

const responseEditor = p.jsonEditors.get(`${KEY}-responseBodyView`);
const firstRequestEditor = p.jsonEditors.get(`${KEY}-requestBody`);
t('response editor mounted', Boolean(responseEditor), true);
t('request editor mounted', Boolean(firstRequestEditor), true);

p.setRule(p.overrides, {
  key: KEY, callName: 'beta', type: 'REST', enabled: true,
  scope: 'site', scopeOrigin: p.currentOrigin, matchParamsEnabled: false,
  requestBodyOverrideEnabled: true, requestBody: '{"patched":true}',
  responseBodyOverrideEnabled: true,
});
p.renderCalls();

t('attaching a request override does NOT rebuild the panel row',
  p.elements.networkBody.children[2] === panelDetail, true);
t('request panel switches to the side-by-side diff',
  requestPanel().querySelector('.request-comparison') !== null, true);
t('request tab gains the Override badge',
  requestTab().querySelector('.override-badge') !== null, true);
t('the overridden-request editor is mounted',
  Boolean(p.jsonEditors.get(`${KEY}-requestBodyOverride`)), true);
t('the overridden-request editor holds the override body',
  p.jsonEditors.get(`${KEY}-requestBodyOverride`).getValue(), '{"patched":true}');

t('the request editor was torn down and remounted',
  p.jsonEditors.get(`${KEY}-requestBody`) !== firstRequestEditor, true);
t('the old request editor was destroyed', firstRequestEditor.destroyed, true);
t('the response editor was left alone',
  p.jsonEditors.get(`${KEY}-responseBodyView`) === responseEditor, true);
t('the response editor was not destroyed', responseEditor.destroyed, undefined);

p.overrides.clear();
p.renderCalls();
t('removing the override reverts to a single editor',
  requestPanel().querySelector('.request-comparison'), null);
t('removing the override drops the badge', requestTab().querySelector('.override-badge'), null);
t('panel row still never rebuilt', p.elements.networkBody.children[2] === panelDetail, true);

// --- General grid and header cards pick up late data ---
const status = () => panelDetail.querySelector('[data-general-status]').textContent;
t('status starts as captured', status().includes('200'), true);
p.calls.get(KEY).status = 503;
p.calls.get(KEY).statusText = 'Service Unavailable';
p.calls.get(KEY).hasError = true;
p.renderCalls();
t('General grid patches to the new status', status().includes('503'), true);
t('General grid patches the status text', status().includes('Service Unavailable'), true);

const reqHeaders = () => panelDetail.querySelector('[data-headers-body="' + KEY + '-req"]').textContent;
t('headers start uncaptured', reqHeaders().includes('Headers not captured'), true);
p.calls.get(KEY).requestHeaders = { 'X-Trace': 'abc123' };
p.renderCalls();
t('header card picks up headers that arrive late', reqHeaders().includes('X-Trace'), true);
t('panel row survived every patch', p.elements.networkBody.children[2] === panelDetail, true);


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
