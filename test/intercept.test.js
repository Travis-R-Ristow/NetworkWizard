const { p } = require('./harness.js');
let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
};

let sent = [];
let now = 0;
const timers = [];
global.setTimeout = (fn, ms) => { timers.push({ at: now + ms, fn }); return timers.length; };
const advance = (ms) => {
  now += ms;
  timers.filter(x => !x.done && x.at <= now).sort((a,b)=>a.at-b.at).forEach(x => { x.done = true; x.fn(); });
};
chrome.debugger.sendCommand = (target, command, params, cb) => {
  sent.push({ command, params, at: now });
  chrome.runtime.lastError = null;
  if (cb) { cb(); }
};
const reset = () => {
  sent = []; now = 0; timers.length = 0;
  p.overrides.clear(); p.delays.clear(); p.blockedCalls.clear(); p.intercepts.clear();
};
const gql = (op, vars) => JSON.stringify({ operationName: op, variables: vars, query: `query ${op} { x }` });
const reqStage = (url, postData, networkId) => ({ requestId: 'fetch-1', networkId, request: { url, postData } });
const resStage = (url, postData, networkId) => ({ requestId: 'fetch-2', networkId, request: { url, postData }, responseStatusCode: 200 });

const GQL_URL = 'https://site-a.test/graphql';
const body = gql('GetUser', { id: 1 });
const key = p.generateCallKey(true, 'GetUser', null, { id: 1 });

reset();
p.handlePausedRequest(reqStage(GQL_URL, body, 'net-1'));
t('pass-through continues the request', sent.map(s => s.command), ['Fetch.continueRequest']);
t('no postData injected on pass-through', 'postData' in sent[0].params, false);

reset();
p.handlePausedRequest(resStage(GQL_URL, body, 'net-1'));
t('response stage uses continueResponse', sent.map(s => s.command), ['Fetch.continueResponse']);

reset();
p.blockedCalls.set('gql:GetUser:*', { key: 'gql:GetUser:*', scope: 'site', scopeOrigin: 'https://site-a.test' });
p.handlePausedRequest(reqStage(GQL_URL, body, 'net-1'));
t('wildcard block fails the request', [sent[0].command, sent[0].params.errorReason], ['Fetch.failRequest', 'BlockedByClient']);

reset();
p.overrides.set(key, {
  key, enabled: true, scope: 'global', matchVariablesEnabled: false,
  responseBodyOverrideEnabled: true, responseBody: '{"mock":1}', statusCode: 201, statusText: 'Created',
});
const otherBody = gql('GetUser', { id: 42 });
p.handlePausedRequest(reqStage(GQL_URL, otherBody, 'net-2'));
t('override fires for different variables', sent[0].command, 'Fetch.fulfillRequest');
t('override status honoured', [sent[0].params.responseCode, sent[0].params.responsePhrase], [201, 'Created']);
t('override body encoded', Buffer.from(sent[0].params.body, 'base64').toString(), '{"mock":1}');
t('content-type defaulted', sent[0].params.responseHeaders.some(h => h.name === 'Content-Type'), true);

reset();
p.overrides.set(key, { key, enabled: true, scope: 'global', matchVariablesEnabled: false, responseBodyOverrideEnabled: true, statusCode: 'Failed' });
p.handlePausedRequest(reqStage(GQL_URL, body, 'net-2b'));
t('invalid status falls back to 200', sent[0].params.responseCode, 200);
t('empty body defaults to {}', Buffer.from(sent[0].params.body, 'base64').toString(), '{}');

reset();
p.overrides.set(key, { key, enabled: false, scope: 'global', matchVariablesEnabled: false, responseBodyOverrideEnabled: true, responseBody: '{}' });
p.handlePausedRequest(reqStage(GQL_URL, body, 'net-3'));
t('disabled override does not fire', sent[0].command, 'Fetch.continueRequest');

reset();
p.overrides.set(key, { key, enabled: true, deleted: true, scope: 'global', matchVariablesEnabled: false, responseBodyOverrideEnabled: true, responseBody: '{}' });
p.handlePausedRequest(reqStage(GQL_URL, body, 'net-3b'));
t('deleted override does not fire', sent[0].command, 'Fetch.continueRequest');

reset();
p.overrides.set(key, {
  key, enabled: true, scope: 'site', scopeOrigin: 'https://site-a.test', matchVariablesEnabled: false,
  requestBodyOverrideEnabled: true, requestBody: '{"patched":true}',
  responseBodyOverrideEnabled: true, responseBody: '{"mockedResponse":1}',
});
p.handlePausedRequest(reqStage(GQL_URL, body, 'net-4'));
t('request body override continues with new postData', sent[0].command, 'Fetch.continueRequest');
t('patched body sent', Buffer.from(sent[0].params.postData, 'base64').toString(), '{"patched":true}');
t('pending response override tracked by networkId', p.intercepts.has('net-4'), true);
sent = [];
p.handlePausedRequest(resStage(GQL_URL, body, 'net-4'));
t('response stage fulfils the pending override (different fetch requestId)', sent[0].command, 'Fetch.fulfillRequest');
t('mocked response body delivered', Buffer.from(sent[0].params.body, 'base64').toString(), '{"mockedResponse":1}');
t('intercept entry cleaned up', p.intercepts.has('net-4'), false);

reset();
p.overrides.set(key, {
  key, enabled: true, scope: 'site', scopeOrigin: 'https://site-a.test', matchVariablesEnabled: false,
  requestBodyOverrideEnabled: true, requestBody: '{"patched":true}', responseBodyOverrideEnabled: false,
});
p.handlePausedRequest(reqStage(GQL_URL, body, 'net-5'));
t('request-only override still patches', Buffer.from(sent[0].params.postData, 'base64').toString(), '{"patched":true}');
sent = [];
p.handlePausedRequest(resStage(GQL_URL, body, 'net-5'));
t('response passes through untouched', sent[0].command, 'Fetch.continueResponse');

reset();
p.delays.set('gql:GetUser:*', { key: 'gql:GetUser:*', enabled: true, scope: 'site', scopeOrigin: 'https://site-a.test', delayMs: 3000, delayBefore: true });
p.handlePausedRequest(reqStage(GQL_URL, body, 'net-6'));
t('before-delay does not send immediately', sent.length, 0);
advance(2999);
t('still waiting just before the deadline', sent.length, 0);
advance(1);
t('before-delay continues after delayMs', [sent.length, sent[0].command, sent[0].at], [1, 'Fetch.continueRequest', 3000]);

reset();
p.delays.set('gql:GetUser:*', { key: 'gql:GetUser:*', enabled: true, scope: 'site', scopeOrigin: 'https://site-a.test', delayMs: 2000, delayBefore: false });
p.handlePausedRequest(reqStage(GQL_URL, body, 'net-7'));
t('after-delay does not delay the request stage', [sent.length, sent[0].command], [1, 'Fetch.continueRequest']);
sent = [];
p.handlePausedRequest(resStage(GQL_URL, body, 'net-7'));
t('after-delay holds the response', sent.length, 0);
advance(2000);
t('after-delay releases the response', [sent.length, sent[0].command], [1, 'Fetch.continueResponse']);

reset();
p.delays.set('gql:GetUser:*', { key: 'gql:GetUser:*', enabled: true, scope: 'site', scopeOrigin: 'https://site-a.test', delayMs: 1000, delayBefore: false });
p.handlePausedRequest(reqStage(GQL_URL, body, 'net-8'));
sent = [];
p.handlePausedRequest(resStage(GQL_URL, undefined, 'net-8'));
t('after-delay survives a body-less response stage', sent.length, 0);
advance(1000);
t('after-delay fired via tracked callKey', sent[0].command, 'Fetch.continueResponse');

reset();
p.delays.set('gql:GetUser:*', { key: 'gql:GetUser:*', enabled: false, scope: 'site', scopeOrigin: 'https://site-a.test', delayMs: 5000, delayBefore: true });
p.handlePausedRequest(reqStage(GQL_URL, body, 'net-9'));
t('disabled delay does not hold the request', [sent.length, sent[0].at], [1, 0]);

reset();
p.delays.set('gql:GetUser:*', { key: 'gql:GetUser:*', enabled: true, scope: 'site', scopeOrigin: 'https://site-a.test', delayMs: 1500, delayBefore: true });
p.overrides.set(key, { key, enabled: true, scope: 'global', matchVariablesEnabled: false, responseBodyOverrideEnabled: true, responseBody: '{"m":1}' });
p.handlePausedRequest(reqStage(GQL_URL, body, 'net-10'));
t('mock is held by the before-delay', sent.length, 0);
advance(1500);
t('mock delivered after the delay', sent[0].command, 'Fetch.fulfillRequest');

reset();
p.handlePausedRequest(reqStage(GQL_URL, 'not-json-at-all', 'net-11'));
t('unresolvable request still continues', sent[0].command, 'Fetch.continueRequest');

reset();
p.missingPostDataWarnings.clear();
const events = [];
p.addEvent = (type, msg) => events.push(type);
p.handlePausedRequest({ requestId: 'f', networkId: 'net-12', request: { url: GQL_URL, hasPostData: true } });
p.handlePausedRequest({ requestId: 'f', networkId: 'net-13', request: { url: GQL_URL, hasPostData: true } });
t('large-body warning surfaced once', events.filter(e => e === 'warning').length, 1);
t('unmatchable request still continues', sent.filter(s => s.command === 'Fetch.continueRequest').length, 2);
p.addEvent = () => {};

reset();
const restKey = p.generateCallKey(false, null, 'https://site-a.test/api/x', '{"a":1}');
p.overrides.set(restKey, {
  key: restKey, enabled: true, scope: 'site', scopeOrigin: 'https://site-a.test',
  matchParamsEnabled: true, matchParams: [{ name: 'foo', value: '1', deleted: false }],
  responseBodyOverrideEnabled: true, responseBody: '{"rest":1}',
});
p.handlePausedRequest(reqStage('https://site-a.test/api/x?foo=1', '{"a":1}', 'net-14'));
t('REST POST override with matchParams fires', sent[0].command, 'Fetch.fulfillRequest');
reset();
p.overrides.set(restKey, {
  key: restKey, enabled: true, scope: 'site', scopeOrigin: 'https://site-a.test',
  matchParamsEnabled: true, matchParams: [{ name: 'foo', value: '9', deleted: false }],
  responseBodyOverrideEnabled: true, responseBody: '{"rest":1}',
});
p.handlePausedRequest(reqStage('https://site-a.test/api/x?foo=1', '{"a":1}', 'net-15'));
t('REST POST override respects a mismatch', sent[0].command, 'Fetch.continueRequest');

reset();
for (let i = 0; i < 600; i++) { p.rememberIntercept([`n${i}`], { callKey: 'k', responseOverride: null }); }
t('intercept map bounded at 500', p.intercepts.size, 500);
t('oldest intercept evicted', p.intercepts.has('n0'), false);
t('newest intercept retained', p.intercepts.has('n599'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
