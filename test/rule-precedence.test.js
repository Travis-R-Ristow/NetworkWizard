const { p } = require('./harness.js');
let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
};
const ORIGIN = 'https://site-a.test';
p.currentOrigin = ORIGIN;
p.attachDebugger = () => Promise.resolve();
p.detachDebugger = () => {};
p.checkDebuggerNeeded = () => {};
const reset = () => { p.overrides.clear(); p.delays.clear(); p.blockedCalls.clear(); p.calls.clear(); p.intercepts.clear(); };
const site = (key, extra = {}) => ({ key, scope: 'site', scopeOrigin: ORIGIN, ...extra });
const id = (key, scope = "site") => `${scope}|${key}`;

const hashKey = p.generateCallKey(true, 'GetUser', null, { id: 1 });
const otherKey = p.generateCallKey(true, 'GetUser', null, { id: 2 });
const wildKey = 'gql:GetUser:*';

reset();
p.setRule(p.blockedCalls, site(hashKey));
p.setRule(p.blockedCalls, site(wildKey));
p.blockedListSnapshot = new Map(p.blockedCalls);
p.toggleBlockEntry(id(hashKey));
t('blocked-tab unblock removes only the listed rule', Array.from(p.blockedCalls.keys()), [id(wildKey)]);
t('the other rule survives', p.blockedCalls.has(id(wildKey)), true);
p.toggleBlockEntry(id(wildKey));
t('the second rule can also be removed', p.blockedCalls.size, 0);

reset();
p.setRule(p.blockedCalls, { key: wildKey, scope: 'global' });
p.blockedListSnapshot = new Map(p.blockedCalls);
p.toggleBlockEntry(id(wildKey, "global"));
t('global rule removed', p.blockedCalls.size, 0);
Promise.resolve(p.toggleBlockEntry(id(wildKey, "global"))).then(() => {
  t('re-block preserves global scope', p.blockedCalls.get(id(wildKey, "global")).scope, 'global');
  t('re-block does not add a scopeOrigin', 'scopeOrigin' in p.blockedCalls.get(id(wildKey, "global")), false);

  reset();
  p.setRule(p.blockedCalls, site(wildKey));
  p.toggleBlock(hashKey);
  t('network-row unblock clears the wildcard rule', p.blockedCalls.size, 0);

  reset();
  p.setRule(p.overrides, site(hashKey, {
    enabled: true, matchVariablesEnabled: false,
    requestBodyOverrideEnabled: true, requestBody: '{"x":1}',
    responseBodyOverrideEnabled: true, responseBody: '{"mock":1}',
  }));
  let sent = [];
  chrome.debugger.sendCommand = (target, cmd, params, cb) => { sent.push({ cmd, params }); chrome.runtime.lastError = null; if (cb) cb(); };
  const gqlBody = JSON.stringify({ operationName: 'GetUser', variables: { id: 1 }, query: 'query GetUser { x }' });
  p.handlePausedRequest({ requestId: 'f1', networkId: 'keep-me', request: { url: 'https://site-a.test/graphql', postData: gqlBody } });
  t('pending override remembered', p.intercepts.has('keep-me'), true);
  for (let i = 0; i < 600; i++) {
    p.handlePausedRequest({ requestId: `p${i}`, networkId: `noise-${i}`, request: { url: `https://site-a.test/api/${i}` } });
  }
  t('only the tracked request is remembered (its networkId + requestId)', p.intercepts.size, 2);
  t('pending override survived 600 unrelated requests', p.intercepts.has('keep-me'), true);
  sent = [];
  p.handlePausedRequest({ requestId: 'f2', networkId: 'keep-me', responseStatusCode: 200, request: { url: 'https://site-a.test/graphql' } });
  t('mock still delivered at the response stage', sent[0].cmd, 'Fetch.fulfillRequest');

  reset();
  p.setRule(p.delays, site(wildKey, { enabled: true, delayMs: 1000, delayBefore: false }));
  p.handlePausedRequest({ requestId: 'f3', networkId: 'net-d', request: { url: 'https://site-a.test/graphql', postData: gqlBody } });
  t('after-delay is remembered for the response stage', p.intercepts.get('net-d').callKey, hashKey);

  reset();
  p.setRule(p.delays, site(wildKey, { enabled: true, delayMs: 1000, delayBefore: true }));
  p.handlePausedRequest({ requestId: 'f4', networkId: 'net-b', request: { url: 'https://site-a.test/graphql', postData: gqlBody } });
  t('before-delay is not remembered', p.intercepts.size, 0);

  reset();
  const events = [];
  const realAddEvent = p.addEvent;
  p.addEvent = (type, msg) => events.push(type);
  p.missingPostDataWarnings.clear();
  sent = [];
  p.handlePausedRequest({ requestId: 'f5', responseStatusCode: 200, request: { url: 'https://site-a.test/graphql', hasPostData: true } });
  t('no warning at the response stage when no delays exist', events.length, 0);
  t('response still continues', sent[0].cmd, 'Fetch.continueResponse');
  p.setRule(p.delays, site(wildKey, { enabled: true, delayMs: 500, delayBefore: false }));
  sent = [];
  p.handlePausedRequest({ requestId: 'f6', responseStatusCode: 200, request: { url: 'https://site-a.test/graphql', postData: gqlBody } });
  t('mid-flight after-delay still applies without tracking', sent.length, 0);
  p.addEvent = realAddEvent;

  reset();
  p.calls.set(hashKey, { type: 'GQL', callName: 'GetUser', method: 'POST', requestBody: gqlBody, matchParams: { id: 1 }, fullUrl: 'https://site-a.test/graphql' });
  p.setRule(p.overrides, site(hashKey, { enabled: true, deleted: true, matchVariablesEnabled: false, responseBodyOverrideEnabled: true }));
  p.setRule(p.overrides, site(wildKey, { enabled: true, matchVariablesEnabled: false, responseBodyOverrideEnabled: true }));
  t('deleted exact rule does not shadow an applicable rule',
    p.attachedRule(p.overrides, hashKey, p.getOverrideForCurrentSite(hashKey)).key, wildKey);
  p.overrides.delete(id(wildKey));
  t('deleted rule reachable when nothing applies',
    p.attachedRule(p.overrides, hashKey, p.getOverrideForCurrentSite(hashKey)).key, hashKey);
  reset();
  p.calls.set(hashKey, { type: 'GQL', callName: 'GetUser', method: 'POST', requestBody: gqlBody, matchParams: { id: 1 } });
  p.setRule(p.overrides, site(hashKey, { enabled: true, matchVariablesEnabled: true, matchVariables: { id: 777 }, responseBodyOverrideEnabled: true }));
  t('non-matching exact rule does not apply', p.getOverrideForCurrentSite(hashKey), null);
  t('non-matching exact rule is still attached to the row',
    p.attachedRule(p.overrides, hashKey, p.getOverrideForCurrentSite(hashKey)).key, hashKey);
  const row = p.renderCallRow(hashKey, p.calls.get(hashKey));
  t('row offers Edit Override, not a duplicate', row.includes('Edit Override'), true);
  t('row shows no active-override bolt', row.includes('override-indicator'), false);
  p.createOrEditOverride(hashKey);
  t('no duplicate rule created', p.overrides.size, 1);

  reset();
  p.calls.set(hashKey, { type: 'GQL', callName: 'GetUser', method: 'POST', requestBody: gqlBody, matchParams: { id: 1 } });
  p.setRule(p.delays, site(wildKey, { enabled: true, delayMs: 4000, delayBefore: false }));
  const row2 = p.renderCallRow(hashKey, p.calls.get(hashKey));
  t('tooltip shows the applied delay', row2.includes('4s after'), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
