const { p } = require('./harness.js');
let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
};

let store = {};
chrome.storage.local.get = (keys) => Promise.resolve(
  Object.fromEntries(keys.filter(k => k in store).map(k => [k, JSON.parse(JSON.stringify(store[k]))]))
);
chrome.storage.local.set = (payload) => { Object.assign(store, JSON.parse(JSON.stringify(payload))); };

p.saveOverrides = function () { this.saveStore('overrides', this.overrides); };
p.saveBlockedCalls = function () { this.saveStore('blocked', this.blockedCalls); };
p.saveDelays = function () { this.saveStore('delays', this.delays); };

const run = async () => {
  store = {
    blockedCalls: { 'https://site-a.test': ['gql:OldBlock'] },
    blockedCallsGlobal: ['rest:https://api.test/legacy'],
    overrides: { 'https://site-a.test': [{ key: 'gql:OldOverride', callName: 'OldOverride', type: 'GQL' }] },
    overridesGlobal: [{ key: 'gql:GlobalOverride:aaaaaaaa', callName: 'G', type: 'GQL', enabled: true, responseBodyOverrideEnabled: true }],
    delays: { 'https://site-a.test': [{ key: 'gql:OldDelay', callName: 'D', type: 'GQL' }] },
  };

  p.currentOrigin = 'https://site-a.test';
  p.storeLoaded = false;
  p.blockedCalls.clear(); p.overrides.clear(); p.delays.clear();

  const [b, o, d] = await Promise.all([
    p.loadStore('blocked', (raw, scope) => p.normalizeScopedEntry(raw, scope)),
    p.loadStore('overrides', (raw, scope) => p.normalizeOverride(raw, scope)),
    p.loadStore('delays', (raw, scope) => p.normalizeDelay(raw, scope)),
  ]);
  p.blockedCalls = b.entries; p.overrides = o.entries; p.delays = d.entries;
  p.storeLoaded = true;

  t('string block migrated to wildcard key', p.blockedCalls.has('gql:OldBlock:*'), true);
  t('global string block loaded as global', p.blockedCalls.get('rest:https://api.test/legacy:*').scope, 'global');
  t('global block has no scopeOrigin', 'scopeOrigin' in p.blockedCalls.get('rest:https://api.test/legacy:*'), false);
  t('site block gets the current origin', p.blockedCalls.get('gql:OldBlock:*').scopeOrigin, 'https://site-a.test');
  t('blocked migration flagged', b.migrated, true);

  t('override key migrated', p.overrides.has('gql:OldOverride:*'), true);
  t('override responseBodyOverrideEnabled defaulted', p.overrides.get('gql:OldOverride:*').responseBodyOverrideEnabled, true);
  t('override requestBodyOverrideEnabled defaulted', p.overrides.get('gql:OldOverride:*').requestBodyOverrideEnabled, false);
  t('override enabled defaulted to true', p.overrides.get('gql:OldOverride:*').enabled, true);
  t('migrated flag not persisted onto the entry', 'migrated' in p.overrides.get('gql:OldOverride:*'), false);
  t('override migration flagged', o.migrated, true);
  t('global override loaded', p.overrides.get('gql:GlobalOverride:aaaaaaaa').scope, 'global');
  t('override count', o.count, 2);

  t('delay defaults applied', [p.delays.get('gql:OldDelay:*').delayMs, p.delays.get('gql:OldDelay:*').delayBefore, p.delays.get('gql:OldDelay:*').enabled], [15000, true, true]);
  t('delay migration flagged', d.migrated, true);

  p.saveOverrides();
  await p.flushWrites();
  t('site override written under origin', store.overrides['https://site-a.test'].map(x => x.key), ['gql:OldOverride:*']);
  t('global override written to global list', store.overridesGlobal.map(x => x.key), ['gql:GlobalOverride:aaaaaaaa']);
  t('global entry has no scopeOrigin on disk', 'scopeOrigin' in store.overridesGlobal[0], false);

  store.overrides['https://site-b.test'] = [{ key: 'gql:SiteB:bbbbbbbb', callName: 'B', type: 'GQL', enabled: true, responseBodyOverrideEnabled: true }];
  p.currentOrigin = 'https://site-b.test';
  p.overrides = (await p.loadStore('overrides', (raw, scope) => p.normalizeOverride(raw, scope))).entries;
  t('site-b sees only its own + global', Array.from(p.overrides.keys()).sort(), ['gql:GlobalOverride:aaaaaaaa', 'gql:SiteB:bbbbbbbb']);

  p.saveOverrides();
  await p.flushWrites();
  t('saving on site-b preserves site-a data', store.overrides['https://site-a.test'].map(x => x.key), ['gql:OldOverride:*']);
  t('saving on site-b keeps globals once', store.overridesGlobal.length, 1);

  const b1 = p.overrides.get('gql:SiteB:bbbbbbbb');
  b1.scope = 'global'; delete b1.scopeOrigin;
  p.saveOverrides();
  await p.flushWrites();
  t('site bucket emptied after promoting to global', 'https://site-b.test' in store.overrides, false);
  t('globals now hold both', store.overridesGlobal.map(x => x.key).sort(), ['gql:GlobalOverride:aaaaaaaa', 'gql:SiteB:bbbbbbbb']);

  p.storeLoaded = false;
  const snapshot = JSON.stringify(store.overridesGlobal);
  p.overrides.clear();
  p.saveOverrides();
  await p.flushWrites();
  t('save is a no-op while state is loading', JSON.stringify(store.overridesGlobal), snapshot);
  p.storeLoaded = true;

  p.currentOrigin = null;
  p.overrides = (await p.loadStore('overrides', (raw, scope) => p.normalizeOverride(raw, scope))).entries;
  t('origin-less page loads globals only', Array.from(p.overrides.values()).every(o => o.scope === 'global'), true);
  p.overrides.set('gql:New:cccccccc', { key: 'gql:New:cccccccc', scope: 'global', enabled: true });
  p.saveOverrides();
  await p.flushWrites();
  t('origin-less save persists globals', store.overridesGlobal.map(x => x.key).includes('gql:New:cccccccc'), true);
  t('origin-less save leaves the site map alone', store.overrides['https://site-a.test'].map(x => x.key), ['gql:OldOverride:*']);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run();
