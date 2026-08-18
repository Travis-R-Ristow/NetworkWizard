const { p, NetworkWizardPanel } = require('./harness.js');

let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
};

const ORIGIN = 'https://site-a.test';
const reset = () => { p.overrides.clear(); p.delays.clear(); p.blockedCalls.clear(); p.calls.clear(); };
p.currentOrigin = ORIGIN;
p.attachDebugger = () => Promise.resolve();
p.switchView = () => {};

const key = p.generateCallKey(true, 'GetUser', null, { id: 1 });
const other = p.generateCallKey(true, 'GetUser', null, { id: 2 });
const wild = 'gql:GetUser:*';
const rule = (extra) => ({ key, enabled: true, matchVariablesEnabled: false, responseBodyOverrideEnabled: true, ...extra });

// --- a site rule and a global rule for the SAME call no longer collide ---
reset();
p.setRule(p.overrides, rule({ callName: 'GLOBAL', scope: 'global' }));
p.setRule(p.overrides, rule({ callName: 'SITE', scope: 'site', scopeOrigin: ORIGIN }));
t('both scopes coexist for one call key', p.overrides.size, 2);
t('global rule survives the site rule',
  Array.from(p.overrides.values()).map(o => o.callName).sort(), ['GLOBAL', 'SITE']);

// --- site beats global ---
t('site rule wins over global', p.findMatchingOverride(key, { id: 1 }, true, true).callName, 'SITE');
p.currentOrigin = 'https://elsewhere.test';
t('global still applies on another origin', p.findMatchingOverride(key, { id: 1 }, true, true).callName, 'GLOBAL');
p.currentOrigin = ORIGIN;

// --- site beats global even when the global is the more specific key ---
reset();
p.setRule(p.overrides, rule({ key, callName: 'GLOBAL-EXACT', scope: 'global' }));
p.setRule(p.overrides, rule({ key: wild, callName: 'SITE-WILDCARD', scope: 'site', scopeOrigin: ORIGIN }));
t('scope outranks specificity', p.findMatchingOverride(key, { id: 1 }, true, true).callName, 'SITE-WILDCARD');

// --- within one scope, exact still beats wildcard ---
reset();
p.setRule(p.overrides, rule({ key, callName: 'EXACT', scope: 'site', scopeOrigin: ORIGIN }));
p.setRule(p.overrides, rule({ key: wild, callName: 'WILDCARD', scope: 'site', scopeOrigin: ORIGIN }));
t('exact beats wildcard in the same scope', p.findMatchingOverride(key, { id: 1 }, true, true).callName, 'EXACT');
t('wildcard serves a call with no exact rule', p.findMatchingOverride(other, { id: 2 }, true, true).callName, 'WILDCARD');

// --- scope changes re-key instead of clobbering ---
reset();
const a = p.setRule(p.overrides, rule({ callName: 'A', scope: 'site', scopeOrigin: ORIGIN }));
const b = p.setRule(p.overrides, rule({ callName: 'B', scope: 'global' }));
t('promoting onto an occupied scope is refused', p.applyRuleScope(p.overrides, p.ruleId(a), a, 'global'), false);
t('refused promotion leaves both rules intact', p.overrides.size, 2);
t('refused promotion leaves the scope unchanged', a.scope, 'site');
p.overrides.delete(p.ruleId(b));
t('promoting into a free scope succeeds', p.applyRuleScope(p.overrides, p.ruleId(a), a, 'global'), true);
t('promoted rule is reachable under its new id', p.getRule(p.overrides, key, 'global').callName, 'A');
t('promoted rule is gone from the old id', p.getRule(p.overrides, key, 'site'), null);
t('promoted rule dropped its scopeOrigin', 'scopeOrigin' in a, false);

// --- new overrides default to LISTENING to params/variables ---
reset();
p.calls.set(key, { type: 'GQL', callName: 'GetUser', method: 'POST',
  requestBody: JSON.stringify({ operationName: 'GetUser', variables: { id: 1 } }),
  fullUrl: 'https://site-a.test/graphql', status: 200, statusText: 'OK',
  requestHeaders: {}, responseHeaders: {} });
p.createOrEditOverride(key);
const gql = p.getRule(p.overrides, key, 'site');
t('new GQL override listens to variables by default', gql.matchVariablesEnabled, true);
t('new GQL override seeds the observed variables', gql.matchVariables, { id: 1 });

reset();
const restKey = p.generateCallKey(false, null, 'https://site-a.test/api/items', { page: '1' });
p.calls.set(restKey, { type: 'REST', callName: '/api/items', method: 'GET',
  fullUrl: 'https://site-a.test/api/items?page=1', status: 200, statusText: 'OK',
  requestHeaders: {}, responseHeaders: {} });
p.createOrEditOverride(restKey);
const rest = p.getRule(p.overrides, restKey, 'site');
t('new REST override listens to params by default', rest.matchParamsEnabled, true);
t('new REST override seeds the observed params', rest.matchParams, [{ name: 'page', value: '1', deleted: false, added: false }]);

// --- a param-less REST call still gets a working listen toggle ---
reset();
const bareKey = p.generateCallKey(false, null, 'https://site-a.test/api/ping', null);
p.calls.set(bareKey, { type: 'REST', callName: '/api/ping', method: 'GET',
  fullUrl: 'https://site-a.test/api/ping', status: 200, statusText: 'OK',
  requestHeaders: {}, responseHeaders: {} });
p.createOrEditOverride(bareKey);
t('param-less REST override still exposes the toggle', p.getRule(p.overrides, bareKey, 'site').matchParamsEnabled, true);

// --- unchecking "match params" widens the rule to every param set ---
reset();
const listen = p.setRule(p.overrides, { key: restKey, callName: 'R', scope: 'site', scopeOrigin: ORIGIN,
  enabled: true, matchParamsEnabled: true,
  matchParams: [{ name: 'page', value: '1', deleted: false }], responseBodyOverrideEnabled: true });
const page7 = p.describeRequest({ url: 'https://site-a.test/api/items?page=7' });
t('while listening, a different param set misses',
  p.findMatchingOverride(page7.callKey, page7.matchParams, false, true), null);
p.handleOverridesListChange({ target: { dataset: { key: p.ruleId(listen), field: 'matchParams-enabled' }, checked: false } });
t('after ignoring params, the same request hits',
  p.findMatchingOverride(page7.callKey, page7.matchParams, false, true).callName, 'R');
t('ignoring params is recorded on the rule', listen.matchParamsEnabled, false);

// --- the scope filter is reachable on an empty list ---
reset();
NetworkWizardPanel.prototype.renderOverridesList.call(p);
t('empty overrides list still renders the scope filter',
  p.elements.overridesList.innerHTML.includes('Global Only'), true);
NetworkWizardPanel.prototype.renderDelaysList.call(p);
t('empty delays list still renders the scope filter',
  p.elements.delaysList.innerHTML.includes('Global Only'), true);
p.blockedListSnapshot = new Map();
NetworkWizardPanel.prototype.renderBlockedList.call(p);
t('empty blocked list still renders the scope filter',
  p.elements.blockedList.innerHTML.includes('Global Only'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
