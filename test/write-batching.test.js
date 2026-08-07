const { p, fireWindowEvent } = require('./harness.js');

let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
};

let store = {};
let getCount = 0;
let setCount = 0;
chrome.storage.local.get = (keys) => {
  getCount++;
  return Promise.resolve(
    Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, JSON.parse(JSON.stringify(store[k]))]))
  );
};
chrome.storage.local.set = (payload) => {
  setCount++;
  Object.assign(store, JSON.parse(JSON.stringify(payload)));
  return Promise.resolve();
};

p.saveOverrides = function () { this.saveStore('overrides', this.overrides); };
p.saveDelays = function () { this.saveStore('delays', this.delays); };
p.storeLoaded = true;
p.currentOrigin = 'https://site-a.test';

const site = (key) => ({ key, scope: 'site', scopeOrigin: 'https://site-a.test', enabled: true });
const reset = () => { store = {}; getCount = 0; setCount = 0; p.overrides.clear(); p.delays.clear(); p.pendingWrites.clear(); };

const run = async () => {
  await new Promise((r) => setTimeout(r, 10));
  await p.flushWrites();

  reset();
  p.overrides.set('gql:A:aaaaaaaa', site('gql:A:aaaaaaaa'));
  for (let i = 0; i < 50; i++) {
    p.overrides.get('gql:A:aaaaaaaa').responseBody = `{"n":${i}}`;
    p.saveOverrides();
  }
  t('50 keystrokes issue no immediate writes', setCount, 0);
  t('50 keystrokes coalesce into one queued write', p.pendingWrites.size, 1);
  await p.flushWrites();
  t('flush performs exactly one write', setCount, 1);
  t('flush performs exactly one read', getCount, 1);
  t('the last edit is the one persisted', store.overrides['https://site-a.test'][0].responseBody, '{"n":49}');
  t('queue drained after flush', p.pendingWrites.size, 0);

  reset();
  p.overrides.set('gql:B:bbbbbbbb', site('gql:B:bbbbbbbb'));
  p.delays.set('gql:C:cccccccc', { ...site('gql:C:cccccccc'), delayMs: 1000, delayBefore: true });
  p.saveOverrides();
  p.saveDelays();
  t('two stores queue two writes', p.pendingWrites.size, 2);
  await p.flushWrites();
  t('both stores written', [Boolean(store.overrides), Boolean(store.delays)], [true, true]);

  reset();
  p.overrides.set('gql:D:dddddddd', site('gql:D:dddddddd'));
  p.saveOverrides();
  t('nothing written before the debounce elapses', setCount, 0);
  await new Promise((r) => setTimeout(r, 400));
  t('debounce timer writes on its own', setCount, 1);
  t('timer cleared after firing', p.writeTimer, null);

  reset();
  p.overrides.set('gql:E:eeeeeeee', site('gql:E:eeeeeeee'));
  p.saveOverrides();
  t('edit still pending', setCount, 0);
  fireWindowEvent('pagehide');
  await new Promise((r) => setTimeout(r, 0));
  t('pagehide flushes the pending edit', setCount, 1);
  t('pagehide persisted the edit', store.overrides['https://site-a.test'][0].key, 'gql:E:eeeeeeee');

  reset();
  p.overrides.set('gql:F:ffffffff', site('gql:F:ffffffff'));
  p.saveOverrides();
  p.currentOrigin = 'https://site-b.test';
  await p.flushWrites();
  t('write lands under the origin it was queued for', Object.keys(store.overrides), ['https://site-a.test']);
  t('write does not leak into the new origin', 'https://site-b.test' in store.overrides, false);
  p.currentOrigin = 'https://site-a.test';

  reset();
  p.storeLoaded = false;
  p.overrides.set('gql:G:gggggggg', site('gql:G:gggggggg'));
  p.saveOverrides();
  t('save refused while loading', p.pendingWrites.size, 0);
  await p.flushWrites();
  t('nothing written while loading', setCount, 0);
  p.storeLoaded = true;

  reset();
  chrome.storage.local.set = () => Promise.reject(new Error('quota'));
  p.overrides.set('gql:H:hhhhhhhh', site('gql:H:hhhhhhhh'));
  p.saveOverrides();
  let threw = false;
  await p.flushWrites().catch(() => { threw = true; });
  t('flush swallows write failures', threw, false);
  t('queue drained despite the failure', p.pendingWrites.size, 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run();
