const { p } = require('./harness.js');

let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
};

const reset = () => { p.overrides.clear(); p.delays.clear(); p.blockedCalls.clear(); p.calls.clear(); };

reset();
const keyA = p.generateCallKey(true, 'GetUser', null, { id: 1 });
const keyB = p.generateCallKey(true, 'GetUser', null, { id: 999 });
t('different variables -> different keys', keyA !== keyB, true);

p.overrides.set(keyA, {
  key: keyA, type: 'GQL', callName: 'GetUser', enabled: true,
  scope: 'global', matchVariablesEnabled: false, matchVariables: { id: 1 },
  responseBodyOverrideEnabled: true, responseBody: '{"mock":true}',
});

t('match OFF applies to the creating variables', p.findMatchingOverride(keyA, { id: 1 }, true, true)?.key, keyA);
t('match OFF applies to OTHER variables (the bug)', p.findMatchingOverride(keyB, { id: 999 }, true, true)?.key, keyA);
t('match OFF applies with no variables at all', p.findMatchingOverride(keyB, null, true, true)?.key, keyA);
t('match OFF does not leak to a different operation',
  p.findMatchingOverride(p.generateCallKey(true, 'GetOrder', null, { id: 1 }), { id: 1 }, true, true), null);

p.overrides.get(keyA).scope = 'site';
p.overrides.get(keyA).scopeOrigin = 'https://site-a.test';
t('site scope + match OFF applies to other variables', p.findMatchingOverride(keyB, { id: 999 }, true, true)?.key, keyA);
p.currentOrigin = 'https://other.test';
t('site scope does not apply on another origin', p.findMatchingOverride(keyB, { id: 999 }, true, true), null);
p.overrides.get(keyA).scope = 'global';
t('global scope applies on another origin', p.findMatchingOverride(keyB, { id: 999 }, true, true)?.key, keyA);
p.currentOrigin = 'https://site-a.test';

reset();
p.overrides.set(keyA, {
  key: keyA, enabled: true, scope: 'site', scopeOrigin: 'https://site-a.test',
  matchVariablesEnabled: true, matchVariables: { id: 1 }, responseBodyOverrideEnabled: true,
});
t('match ON hits exact variables', p.findMatchingOverride(keyA, { id: 1 }, true, true)?.key, keyA);
t('match ON misses other variables', p.findMatchingOverride(keyB, { id: 999 }, true, true), null);
t('match ON tolerates extra request variables', p.findMatchingOverride(keyA, { id: 1, extra: 'x' }, true, true)?.key, keyA);
p.overrides.get(keyA).matchVariables = { filter: { b: 2, a: 1 } };
t('match ON compares nested objects key-order-insensitively',
  p.findMatchingOverride(keyA, { filter: { a: 1, b: 2 } }, true, true)?.key, keyA);
p.overrides.get(keyA).matchVariables = {};
t('match ON with empty criteria matches anything', p.findMatchingOverride(keyB, { id: 5 }, true, true)?.key, keyA);

reset();
const restKey = p.generateCallKey(false, null, 'https://site-a.test/api/x', '{"a":1}');
p.overrides.set(restKey, {
  key: restKey, enabled: true, scope: 'site', scopeOrigin: 'https://site-a.test',
  matchParamsEnabled: true,
  matchParams: [{ name: 'foo', value: '1', deleted: false }],
  responseBodyOverrideEnabled: true,
});
const posted = p.describeRequest({ url: 'https://site-a.test/api/x?foo=1', postData: '{"a":1}' });
t('POST body+query -> key matches the captured key', posted.callKey, restKey);
t('POST query params are available for matching', posted.matchParams, { foo: '1' });
t('POST override with matchParams now applies',
  p.findMatchingOverride(posted.callKey, posted.matchParams, false, true)?.key, restKey);
const mismatched = p.describeRequest({ url: 'https://site-a.test/api/x?foo=2', postData: '{"a":1}' });
t('POST override respects a param mismatch',
  p.findMatchingOverride(mismatched.callKey, mismatched.matchParams, false, true), null);

reset();
const legacy = p.migrateOldKey('gql:GetUser');
t('legacy key migrates to wildcard', legacy, 'gql:GetUser:*');
p.blockedCalls.set(legacy, { key: legacy, scope: 'site', scopeOrigin: 'https://site-a.test' });
t('wildcard block matches a hashed call key', p.isBlockedForCurrentSite(keyA), true);
t('resolveBlockedKey returns the wildcard entry', p.resolveBlockedKey(keyA), legacy);
p.toggleBlock(keyA);
t('un-block from the network row removes the wildcard entry', p.blockedCalls.size, 0);
t('row is no longer blocked', p.isBlockedForCurrentSite(keyA), false);

reset();
p.blockedCalls.set(keyA, { key: keyA, scope: 'site', scopeOrigin: 'https://site-a.test' });
p.blockedCalls.set('gql:GetUser:*', { key: 'gql:GetUser:*', scope: 'site', scopeOrigin: 'https://site-a.test' });
t('exact key preferred over wildcard', p.resolveBlockedKey(keyA), keyA);
t('wildcard used when no exact entry', p.resolveBlockedKey(keyB), 'gql:GetUser:*');

reset();
p.delays.set(keyA, { key: keyA, enabled: false, scope: 'site', scopeOrigin: 'https://site-a.test', delayMs: 1000, delayBefore: true });
p.delays.set('gql:GetUser:*', { key: 'gql:GetUser:*', enabled: true, scope: 'site', scopeOrigin: 'https://site-a.test', delayMs: 2000, delayBefore: true });
t('getActiveDelay skips the disabled exact entry', p.getActiveDelay(keyA)?.delayMs, 2000);
t('getDelayForCurrentSite returns the exact entry for the UI', p.getDelayForCurrentSite(keyA)?.delayMs, 1000);
p.delays.get('gql:GetUser:*').deleted = true;
t('deleted delays are out of scope', p.getActiveDelay(keyA), null);

reset();
p.overrides.set(keyA, { key: keyA, enabled: false, scope: 'site', scopeOrigin: 'https://site-a.test', matchVariablesEnabled: false, responseBodyOverrideEnabled: true });
p.overrides.set('gql:GetUser:*', { key: 'gql:GetUser:*', enabled: true, scope: 'site', scopeOrigin: 'https://site-a.test', matchVariablesEnabled: false, responseBodyOverrideEnabled: true });
t('enabledOnly skips the disabled exact override', p.findMatchingOverride(keyA, { id: 1 }, true, true)?.key, 'gql:GetUser:*');
t('UI lookup still sees the disabled exact override', p.findMatchingOverride(keyA, { id: 1 }, true, false)?.key, keyA);

reset();
const multipart = [
  '------WebKitFormBoundaryABC',
  'Content-Disposition: form-data; name="operations"',
  '',
  '{"operationName":"UploadDoc","variables":{"docId":"7","file":null},"query":"mutation UploadDoc($file: Upload!) { upload(file: $file) }"}',
  '------WebKitFormBoundaryABC',
  'Content-Disposition: form-data; name="map"',
  '',
  '{"1":["variables.file"]}',
  '------WebKitFormBoundaryABC--',
  '',
].join('\r\n');
t('multipart operation name extracted', p.extractGqlOperation(multipart), 'UploadDoc');
t('multipart variables extracted', p.extractGqlVariables(multipart), { docId: '7', file: null });
const mpDesc = p.describeRequest({ url: 'https://site-a.test/graphql', postData: multipart });
t('multipart request produces a call key', mpDesc.callKey, p.generateCallKey(true, 'UploadDoc', null, { docId: '7', file: null }));
t('multipart key equals the HAR-derived key',
  mpDesc.callKey,
  p.generateCallKey(true, 'UploadDoc', null, p.extractGqlVariables(p.getPostDataText({ params: [{ name: 'operations', value: '{"operationName":"UploadDoc","variables":{"docId":"7","file":null}}' }] }))));

reset();
const body = JSON.stringify({ operationName: 'GetUser', variables: { id: 1 }, query: 'query GetUser { me }' });
p.addPendingRequest({ requestId: 'r1', url: 'https://site-a.test/graphql', method: 'POST', bodyText: body });
const pendingKey = Array.from(p.calls.keys())[0];
t('webRequest-derived key matches CDP-derived key',
  pendingKey, p.describeRequest({ url: 'https://site-a.test/graphql', postData: body }).callKey);
t('webRequest-derived key matches the HAR-derived key', pendingKey, keyA);

reset();
p.addPendingRequest({ requestId: 'r2', url: 'https://site-a.test/api/y?b=2&a=1', method: 'GET', bodyText: null });
const getKey = Array.from(p.calls.keys())[0];
t('REST GET key matches CDP-derived key',
  getKey, p.describeRequest({ url: 'https://site-a.test/api/y?b=2&a=1' }).callKey);
t('REST GET key is param-order independent',
  getKey, p.describeRequest({ url: 'https://site-a.test/api/y?a=1&b=2' }).callKey);

t('valid status kept', p.validStatusCode(404), 404);
t('numeric string status kept', p.validStatusCode('201'), 201);
t('"Failed" rejected', p.validStatusCode('Failed'), null);
t('out-of-range rejected', p.validStatusCode(99), null);
t('null rejected', p.validStatusCode(null), null);
t('numericStatus from GQL-error call', p.numericStatus({ status: '200 (GQL Error)', statusCode: 200 }), 200);
t('numericStatus from failed call', p.numericStatus({ status: 'Failed' }), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
