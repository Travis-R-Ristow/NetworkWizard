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
chrome.storage.local.remove = (keys) => {
  (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[k]);
};

let origin = 'https://site-a.test';
chrome.devtools.inspectedWindow.eval = (expr, cb) => setTimeout(() => cb(origin, null), 1);
p.checkDebuggerNeeded = () => {};

const settle = () => new Promise(r => setTimeout(r, 20));

const run = async () => {
  p.loadPersistedState();
  await settle();
  t('site A loads its own + global', Array.from(p.overrides.keys()).sort(), ["global|gql:Everywhere:aaaaaaaa", "site|gql:OnlyA:bbbbbbbb"]);
  t('origin recorded', p.currentOrigin, 'https://site-a.test');

  origin = 'https://site-b.test';
  p.loadPersistedState();
  t('previous site rules stay active while state reloads', p.isInScope(p.getRule(p.overrides, "gql:OnlyA:bbbbbbbb", "site")), true);
  t('global rules still apply mid-load', p.isInScope(p.getRule(p.overrides, "gql:Everywhere:aaaaaaaa", "global")), true);
  t('saves blocked mid-load', p.storeLoaded, false);
  await settle();
  t('after navigation, site B rules loaded', Array.from(p.overrides.keys()).sort(), ["global|gql:Everywhere:aaaaaaaa", "site|gql:OnlyB:cccccccc"]);
  t('site A rules gone from memory', p.getRule(p.overrides, "gql:OnlyA:bbbbbbbb", "site") !== null, false);
  t('origin updated', p.currentOrigin, 'https://site-b.test');

  p.saveOverrides();
  await settle();
  t('legacy map migrated away', 'overrides' in store, false);
  t('site A data intact on disk', store['overrides::https://site-a.test'].map(x => x.key), ['gql:OnlyA:bbbbbbbb']);
  t('site B data intact on disk', store['overrides::https://site-b.test'].map(x => x.key), ['gql:OnlyB:cccccccc']);
  t('globals intact', store.overridesGlobal.map(x => x.key), ['gql:Everywhere:aaaaaaaa']);

  const keep = Array.from(p.overrides.keys()).sort();
  const goodGet = chrome.storage.local.get;
  chrome.storage.local.get = () => Promise.reject(new Error('boom'));
  p.loadPersistedState();
  await settle();
  t('failed load preserves in-memory state', Array.from(p.overrides.keys()).sort(), keep);
  t('failed load leaves saves disabled', p.storeLoaded, false);

  chrome.storage.local.get = goodGet;
  let evalCalls = 0;
  chrome.devtools.inspectedWindow.eval = (expr, cb) => setTimeout(() => {
    evalCalls++;
    if (evalCalls <= 2) {
      cb(null, { code: 'E_NAVIGATING' });
    } else {
      cb('https://site-b.test', null);
    }
  }, 1);
  p.loadPersistedState();
  await new Promise(r => setTimeout(r, 400));
  t('origin recovered after transient eval failures', p.currentOrigin, 'https://site-b.test');
  t('site rules recovered after transient eval failures',
    Array.from(p.overrides.keys()).sort(), ["global|gql:Everywhere:aaaaaaaa", "site|gql:OnlyB:cccccccc"]);
  t('saves re-enabled after recovery', p.storeLoaded, true);

  chrome.devtools.inspectedWindow.eval = (expr, cb) => setTimeout(() => cb(null, { code: 'E_NAVIGATING' }), 1);
  p.loadPersistedState();
  await new Promise(r => setTimeout(r, 900));
  t('unresolvable origin falls back to the previous one', p.currentOrigin, 'https://site-b.test');
  t('reload with unresolvable origin keeps site rules',
    Array.from(p.overrides.keys()).sort(), ["global|gql:Everywhere:aaaaaaaa", "site|gql:OnlyB:cccccccc"]);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run();
