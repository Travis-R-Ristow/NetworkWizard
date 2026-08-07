const { p } = require('./harness.js');
let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`); }
};

let store = {
  overridesGlobal: [{ key: 'gql:Everywhere:aaaaaaaa', callName: 'E', type: 'GQL', enabled: true, responseBodyOverrideEnabled: true, matchVariablesEnabled: false }],
  overrides: {
    'https://site-a.test': [{ key: 'gql:OnlyA:bbbbbbbb', callName: 'A', type: 'GQL', enabled: true, responseBodyOverrideEnabled: true, matchVariablesEnabled: false }],
    'https://site-b.test': [{ key: 'gql:OnlyB:cccccccc', callName: 'B', type: 'GQL', enabled: true, responseBodyOverrideEnabled: true, matchVariablesEnabled: false }],
  },
};
chrome.storage.local.get = (keys) => new Promise((res) => setTimeout(() => res(
  Object.fromEntries(keys.filter(k => k in store).map(k => [k, JSON.parse(JSON.stringify(store[k]))]))
), 1));
chrome.storage.local.set = (payload) => { Object.assign(store, JSON.parse(JSON.stringify(payload))); };

let origin = 'https://site-a.test';
chrome.devtools.inspectedWindow.eval = (expr, cb) => setTimeout(() => cb(origin, null), 1);
p.checkDebuggerNeeded = () => {};

const settle = () => new Promise(r => setTimeout(r, 20));

const run = async () => {
  p.loadPersistedState();
  await settle();
  t('site A loads its own + global', Array.from(p.overrides.keys()).sort(), ['gql:Everywhere:aaaaaaaa', 'gql:OnlyA:bbbbbbbb']);
  t('origin recorded', p.currentOrigin, 'https://site-a.test');

  origin = 'https://site-b.test';
  p.loadPersistedState();
  t('site-scoped rules are inert mid-load', p.isInScope(p.overrides.get('gql:OnlyA:bbbbbbbb')), false);
  t('global rules still apply mid-load', p.isInScope(p.overrides.get('gql:Everywhere:aaaaaaaa')), true);
  t('saves blocked mid-load', p.storeLoaded, false);
  await settle();
  t('after navigation, site B rules loaded', Array.from(p.overrides.keys()).sort(), ['gql:Everywhere:aaaaaaaa', 'gql:OnlyB:cccccccc']);
  t('site A rules gone from memory', p.overrides.has('gql:OnlyA:bbbbbbbb'), false);
  t('origin updated', p.currentOrigin, 'https://site-b.test');

  p.saveOverrides();
  await settle();
  t('site A data intact on disk', store.overrides['https://site-a.test'].map(x => x.key), ['gql:OnlyA:bbbbbbbb']);
  t('site B data intact on disk', store.overrides['https://site-b.test'].map(x => x.key), ['gql:OnlyB:cccccccc']);
  t('globals intact', store.overridesGlobal.map(x => x.key), ['gql:Everywhere:aaaaaaaa']);

  const keep = Array.from(p.overrides.keys()).sort();
  chrome.storage.local.get = () => Promise.reject(new Error('boom'));
  p.loadPersistedState();
  await settle();
  t('failed load preserves in-memory state', Array.from(p.overrides.keys()).sort(), keep);
  t('failed load leaves saves disabled', p.storeLoaded, false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run();
