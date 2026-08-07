const { p } = require('./harness.js');
let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`); }
};
const ORIGIN = 'https://site-a.test';
p.currentOrigin = ORIGIN;
p.storeLoaded = true;
p.addEvent = () => {};
let sent = [];
chrome.debugger.sendCommand = (target, cmd, params, cb) => { sent.push({ cmd, params }); chrome.runtime.lastError = null; if (cb) cb(); };

const body = JSON.stringify({ operationName: 'GetUser', variables: { id: 1 }, query: 'query GetUser { x }' });
const key = p.generateCallKey(true, 'GetUser', null, { id: 1 });
const setup = () => {
  p.overrides.clear(); p.delays.clear(); p.blockedCalls.clear(); p.intercepts.clear(); sent = [];
  p.overrides.set(key, {
    key, scope: 'site', scopeOrigin: ORIGIN, enabled: true, matchVariablesEnabled: false,
    requestBodyOverrideEnabled: true, requestBody: '{"patched":1}',
    responseBodyOverrideEnabled: true, responseBody: '{"mocked":1}',
  });
};
const REQ = (opts) => ({ ...opts, request: { url: 'https://site-a.test/graphql', postData: body } });
const RES = (opts) => ({ ...opts, responseStatusCode: 200, request: { url: 'https://site-a.test/graphql', postData: body } });
const mockedBody = () => Buffer.from(sent[sent.length - 1].params.body || '', 'base64').toString();

setup();
p.handlePausedRequest(REQ({ requestId: 'fetch-A1', networkId: 'net-1' }));
p.handlePausedRequest(RES({ requestId: 'fetch-A2', networkId: 'net-1' }));
t('A: stable networkId, differing requestId -> mock delivered', sent[sent.length - 1].cmd, 'Fetch.fulfillRequest');
t('A: correct body', mockedBody(), '{"mocked":1}');
t('A: no leaked intercept entries', p.intercepts.size, 0);

setup();
p.handlePausedRequest(REQ({ requestId: 'fetch-B' }));
p.handlePausedRequest(RES({ requestId: 'fetch-B' }));
t('B: stable requestId, no networkId -> mock delivered', sent[sent.length - 1].cmd, 'Fetch.fulfillRequest');
t('B: no leaked intercept entries', p.intercepts.size, 0);

setup();
p.handlePausedRequest(REQ({ requestId: 'fetch-C', networkId: 'net-3' }));
p.handlePausedRequest(RES({ requestId: 'fetch-C' }));
t('C: networkId only on request stage -> falls back to requestId', sent[sent.length - 1].cmd, 'Fetch.fulfillRequest');
t('C: no leaked intercept entries', p.intercepts.size, 0);

setup();
p.handlePausedRequest(REQ({ requestId: 'fetch-D' }));
p.handlePausedRequest(RES({ requestId: 'fetch-D', networkId: 'net-4' }));
t('D: networkId only on response stage -> still matches on requestId', sent[sent.length - 1].cmd, 'Fetch.fulfillRequest');
t('D: no leaked intercept entries', p.intercepts.size, 0);

setup();
p.handlePausedRequest(REQ({ requestId: 'fetch-E1', networkId: 'net-5' }));
p.handlePausedRequest(RES({ requestId: 'fetch-Z9', networkId: 'net-9' }));
t('E: unrelated response is not fulfilled with someone else’s mock', sent[sent.length - 1].cmd, 'Fetch.continueResponse');
t('E: original entry still pending', p.intercepts.size > 0, true);

setup();
p.handlePausedRequest(REQ({ requestId: 'f-1', networkId: 'n-1' }));
p.handlePausedRequest(REQ({ requestId: 'f-2', networkId: 'n-2' }));
sent = [];
p.handlePausedRequest(RES({ requestId: 'f-2b', networkId: 'n-2' }));
t('F: second request fulfilled', sent[0].cmd, 'Fetch.fulfillRequest');
p.handlePausedRequest(RES({ requestId: 'f-1b', networkId: 'n-1' }));
t('F: first request also fulfilled', sent[1].cmd, 'Fetch.fulfillRequest');
t('F: both cleaned up', p.intercepts.size, 0);

setup();
for (let i = 0; i < 400; i++) {
  p.rememberIntercept([`a${i}`, `b${i}`], { callKey: 'k', responseOverride: null });
}
t('dual-key remember respects the cap', p.intercepts.size <= 500, true);
t('most recent entry retrievable', p.takeIntercept(['a399']).callKey, 'k');
t('taking one clears its sibling key', p.intercepts.has('b399'), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
