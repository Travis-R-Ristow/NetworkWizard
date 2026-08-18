const { p, NetworkWizardPanel, El, OVERRIDE_ACTIONS, DELAY_ACTIONS } = require('./harness.js');

let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
};

p.renderOverridesList = NetworkWizardPanel.prototype.renderOverridesList;
p.elements.overridesList = new El('div');
p.elements.overridesEmptyState = { style: {} };

const ORIGIN = 'https://site-a.test';
p.currentOrigin = ORIGIN;

const override = (name, extra = {}) => ({
  key: `rest:${name}:aaaaaaaa`, callName: name, type: 'REST', enabled: true,
  scope: 'site', scopeOrigin: ORIGIN,
  matchParamsEnabled: true,
  matchParams: [{ name: 'page', value: '1', deleted: false, added: false }],
  requestBodyOverrideEnabled: false, requestBody: null,
  responseBodyOverrideEnabled: true, responseBody: '{}',
  responseHeaders: [{ name: 'X-One', value: '1', deleted: false, added: false }],
  ...extra,
});

const seed = () => {
  p.overrides.clear();
  p.jsonEditors.clear();
  p.overrideRowHtml.clear();
  p.overrideHeadersView.clear();
  p.expandedOverride = null;
  p.scopeFilter = 'all';
  p.elements.overridesList.innerHTML = '';
  ['alpha', 'beta', 'gamma'].forEach((n) => p.setRule(p.overrides, override(n)));
};

const tbody = () => p.elements.overridesList.querySelector('[data-overrides-body]');
const layout = () => tbody().children.map((c) =>
  c.classList.contains('override-details') ? 'details' : c.dataset.key || 'no-results');

const KEY = 'site|rest:beta:aaaaaaaa';

// --- baseline ---
seed();
p.renderOverridesList();
t('renders one row per override',
  layout(), ['site|rest:alpha:aaaaaaaa', KEY, 'site|rest:gamma:aaaaaaaa']);

const alphaRow = tbody().children[0];
p.renderOverridesList();
t('unchanged row keeps its DOM node', tbody().children[0] === alphaRow, true);

// --- expanding builds the form in place ---
p.expandedOverride = KEY;
p.renderOverridesList();
t('form row sits directly after its override row',
  layout(), ['site|rest:alpha:aaaaaaaa', KEY, 'details', 'site|rest:gamma:aaaaaaaa']);

const form = tbody().children[2];
const editor = p.jsonEditors.get(`${KEY}-response`);
t('response body editor mounted', Boolean(editor), true);

// --- THE POINT: the open form survives re-renders ---
p.renderOverridesList();
t('form keeps its DOM node across a re-render', tbody().children[2] === form, true);
t('form is never detached', form.parent === tbody(), true);
t('its JSON editor is never rebuilt', p.jsonEditors.get(`${KEY}-response`) === editor, true);

p.overrides.get('site|rest:alpha:aaaaaaaa').enabled = false;
p.renderOverridesList();
t('form survives a sibling row changing', tbody().children[2] === form, true);
t('sibling row reflects its change',
  tbody().children[0].textContent.includes('Disabled'), true);

// --- adding a header patches only the headers editor ---
const headerCount = () => form.querySelectorAll('.header-entry').length;
t('starts with one header entry', headerCount(), 1);
p.addHeaderEntry(KEY);
t('adding a header adds one entry', headerCount(), 2);
t('adding a header does not rebuild the form', tbody().children[2] === form, true);
t('adding a header does not rebuild the editor',
  p.jsonEditors.get(`${KEY}-response`) === editor, true);

p.removeHeaderEntry(KEY, 0);
t('removing a header marks it deleted, keeping the row',
  form.querySelectorAll('.header-entry.deleted').length, 1);
t('removing a header does not rebuild the form', tbody().children[2] === form, true);

p.restoreHeaderEntry(KEY, 0);
t('restoring a header clears the deleted state',
  form.querySelectorAll('.header-entry.deleted').length, 0);

// --- headers view toggle patches in place ---
p.setHeadersViewMode(KEY, 'json');
t('json view swaps in a textarea',
  form.querySelector('[data-field="responseHeaders-json"]') !== null, true);
t('switching header view does not rebuild the form', tbody().children[2] === form, true);
p.setHeadersViewMode(KEY, 'keyvalue');
t('switching back restores the key-value rows', headerCount(), 2);

// --- match entries patch in place ---
const matchCount = () => form.querySelectorAll('.match-entry').length;
t('starts with one match entry', matchCount(), 1);
p.addMatchEntry(KEY, 'matchParams');
t('adding a match entry patches the match editor', matchCount(), 2);
t('adding a match entry does not rebuild the form', tbody().children[2] === form, true);

// --- the ignore-params checkbox just hides the section ---
const matchSection = () => form.querySelector(`[data-match-section="${KEY}"]`);
t('match section starts visible', matchSection().classList.contains('hidden'), false);
p.handleOverridesListChange({ target: { dataset: { key: KEY, field: 'matchParams-enabled' }, checked: false } });
t('unchecking hides the match section', matchSection().classList.contains('hidden'), true);
t('unchecking does not rebuild the form', tbody().children[2] === form, true);
p.handleOverridesListChange({ target: { dataset: { key: KEY, field: 'matchParams-enabled' }, checked: true } });
t('rechecking shows it again', matchSection().classList.contains('hidden'), false);

// --- response/request section toggles ---
const responseContent = () => form.querySelector(`[data-response-content="${KEY}"]`);
t('response section starts visible', responseContent().classList.contains('hidden'), false);
p.handleOverridesListChange({ target: { dataset: { key: KEY, field: 'responseBodyOverrideEnabled' }, checked: false } });
t('unchecking hides the response section', responseContent().classList.contains('hidden'), true);
t('unchecking does not rebuild the form', tbody().children[2] === form, true);
t('the response editor is not destroyed', p.jsonEditors.get(`${KEY}-response`) === editor, true);

// --- collapsing tears the form down ---
p.expandedOverride = null;
p.renderOverridesList();
t('collapsing drops the form row',
  layout(), ['site|rest:alpha:aaaaaaaa', KEY, 'site|rest:gamma:aaaaaaaa']);
t('collapsing destroys the form editors', editor.destroyed, true);

// --- soft-deleting collapses and restyles ---
seed();
p.expandedOverride = KEY;
p.renderOverridesList();
p.setRuleDeleted('overrides', KEY, true);
t('deleting collapses the form', layout().includes('details'), false);
t('deleted row is marked',
  tbody().querySelector(`[data-key="${KEY}"]`).classList.contains('deleted'), true);

// --- scope filter drives which rows exist ---
seed();
p.setRule(p.overrides, override('global-one', { scope: 'global', scopeOrigin: undefined }));
p.renderOverridesList();
t('all scopes shown by default', layout().length, 4);
p.scopeFilter = 'global';
p.renderOverridesList();
t('global filter keeps only global rules', layout(), ['global|rest:global-one:aaaaaaaa']);
p.scopeFilter = 'site';
p.renderOverridesList();
t('site filter keeps only site rules', layout().length, 3);
p.scopeFilter = 'global';
p.overrides.clear();
p.setRule(p.overrides, override('alpha'));
p.renderOverridesList();
t('an empty filtered result shows the no-results row', layout(), ['no-results']);
p.scopeFilter = 'all';
p.renderOverridesList();
t('clearing the filter drops the no-results row', layout(), ['site|rest:alpha:aaaaaaaa']);

// --- every action the UI renders has a handler ---------------------------
const actionsIn = (html) =>
  Array.from(new Set(Array.from(String(html).matchAll(/data-action="([^"]+)"/g)).map((m) => m[1])));

const collectOverrideActions = () => {
  const seen = new Set();
  const sweep = () => actionsIn(p.elements.overridesList.innerHTML).forEach((a) => seen.add(a));

  seed();
  p.expandedOverride = KEY;
  p.renderOverridesList();
  sweep();

  // a soft-deleted header and match entry expose their Restore buttons
  p.removeHeaderEntry(KEY, 0);
  p.removeMatchEntry(KEY, 'matchParams', 0);
  sweep();

  // a soft-deleted override exposes Restore / Remove
  p.setRuleDeleted('overrides', KEY, true);
  sweep();

  return Array.from(seen);
};

const renderedOverrideActions = collectOverrideActions();
t('the overrides UI renders a meaningful number of actions',
  renderedOverrideActions.length >= 12, true);
t('every rendered override action has a handler',
  renderedOverrideActions.filter((a) => !OVERRIDE_ACTIONS[a]), []);
t('no handler is defined for an action the UI never renders',
  Object.keys(OVERRIDE_ACTIONS).filter((a) => !renderedOverrideActions.includes(a)), []);

p.renderDelaysList = NetworkWizardPanel.prototype.renderDelaysList;
p.elements.delaysList = new El('div');
p.elements.delaysEmptyState = { style: {} };
p.delays.clear();
const delayKey = 'site|rest:alpha:aaaaaaaa';
p.setRule(p.delays, {
  key: 'rest:alpha:aaaaaaaa', callName: 'alpha', type: 'REST', enabled: true,
  scope: 'site', scopeOrigin: ORIGIN, delayMs: 2000, delayBefore: true,
});
p.expandedDelay = delayKey;
p.renderDelaysList();
const delayActions = new Set(actionsIn(p.elements.delaysList.innerHTML));
p.setRuleDeleted('delays', delayKey, true);
p.renderDelaysList();
actionsIn(p.elements.delaysList.innerHTML).forEach((a) => delayActions.add(a));
const renderedDelayActions = Array.from(delayActions);
t('every rendered delay action has a handler',
  renderedDelayActions.filter((a) => !DELAY_ACTIONS[a]), []);
t('no delay handler is defined for an action the UI never renders',
  Object.keys(DELAY_ACTIONS).filter((a) => !renderedDelayActions.includes(a)), []);

// --- the dispatcher actually routes clicks -------------------------------
seed();
p.expandedOverride = KEY;
p.renderOverridesList();
const openForm = tbody().children[2];
const click = (dataset) => p.handleOverridesListClick({
  target: {
    closest: (sel) => (sel === 'button[data-action]' ? { dataset } : null),
  },
});

const entriesBefore = openForm.querySelectorAll('.header-entry').length;
click({ action: 'add-header', key: KEY });
t('clicking add-header routes to the header editor',
  openForm.querySelectorAll('.header-entry').length, entriesBefore + 1);

click({ action: 'remove-header', key: KEY, idx: '0' });
t('clicking remove-header passes the index through',
  openForm.querySelectorAll('.header-entry.deleted').length, 1);

click({ action: 'set-headers-view', key: KEY, view: 'json' });
t('clicking set-headers-view passes the view through',
  openForm.querySelector('[data-field="responseHeaders-json"]') !== null, true);

click({ action: 'set-scope-filter', filter: 'global' });
t('clicking set-scope-filter passes the filter through', p.scopeFilter, 'global');
p.scopeFilter = 'all';

t('an unknown action is ignored rather than throwing',
  click({ action: 'no-such-action', key: KEY }), undefined);


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
