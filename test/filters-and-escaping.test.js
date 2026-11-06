const { p } = require('./harness.js');
let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
};
p.currentOrigin = 'https://site-a.test';
p.storeLoaded = true;

const call = (method) => ({ type: 'REST', callName: 'c', method, hasError: false, fullUrl: 'https://x/y' });
p.filters = { search: '', type: 'all', methods: new Set(), status: 'all' };
t('no filter passes everything', [p.matchesFilter(call('GET')), p.matchesFilter(call('OPTIONS'))], [true, true]);

p.filters.methods = new Set(['NOT_OPTIONS']);
t('!OPTIONS alone excludes OPTIONS', p.matchesFilter(call('OPTIONS')), false);
t('!OPTIONS alone allows GET', p.matchesFilter(call('GET')), true);
t('!OPTIONS alone allows POST', p.matchesFilter(call('POST')), true);

p.filters.methods = new Set(['GET']);
t('GET alone allows GET', p.matchesFilter(call('GET')), true);
t('GET alone excludes POST', p.matchesFilter(call('POST')), false);

p.filters.methods = new Set(['NOT_OPTIONS', 'GET']);
t('!OPTIONS + GET allows GET', p.matchesFilter(call('GET')), true);
t('!OPTIONS + GET excludes POST (was broken)', p.matchesFilter(call('POST')), false);
t('!OPTIONS + GET excludes OPTIONS', p.matchesFilter(call('OPTIONS')), false);

p.filters.methods = new Set(['NOT_OPTIONS', 'GET', 'PUT']);
t('!OPTIONS + GET + PUT allows PUT', p.matchesFilter(call('PUT')), true);
t('!OPTIONS + GET + PUT excludes DELETE', p.matchesFilter(call('DELETE')), false);
p.filters.methods = new Set();

p.overrides.clear();
const captured = [];
const origAttach = p.attachDebugger;
p.attachDebugger = () => Promise.resolve();
p.addEvent = (type, msg) => captured.push([type, msg]);

const doImport = (payload) => {
  let onchange = null;
  const realCreate = document.createElement;
  document.createElement = () => ({ set onchange(fn) { onchange = fn; }, click() {}, style: {}, remove() {} });
  p.importFullOverride();
  document.createElement = realCreate;
  global.FileReader = class {
    readAsText() { this.onload({ target: { result: JSON.stringify(payload) } }); }
  };
  onchange({ target: { files: [{ name: 'x.json' }] } });
};

doImport([{ key: 'gql:LegacyOp', type: 'GQL', callName: 'LegacyOp', responseBody: '{}' }]);
t('imported legacy key is migrated', p.getRule(p.overrides, "gql:LegacyOp:*", "site") !== null, true);
t('imported entry defaults enabled', p.getRule(p.overrides, "gql:LegacyOp:*", "site").enabled, true);
t('imported entry gets the site scope origin', p.getRule(p.overrides, "gql:LegacyOp:*", "site").scopeOrigin, 'https://site-a.test');

p.overrides.clear();
doImport([{ key: 'gql:G:aaaaaaaa', type: 'GQL', callName: 'G', scope: 'global', scopeOrigin: 'https://stale.test', statusCode: 'Failed' }]);
const g = p.getRule(p.overrides, "gql:G:aaaaaaaa", "global");
t('imported global keeps global scope', g.scope, 'global');
t('imported global drops any stale scopeOrigin', 'scopeOrigin' in g, false);
t('imported invalid status is rejected', g.statusCode, null);
t('imported entry keeps response override on by default', g.responseBodyOverrideEnabled, true);

p.overrides.clear();
doImport({ key: 'gql:S:bbbbbbbb', type: 'GQL', callName: 'S', statusCode: 503 });
t('imported valid status kept', p.getRule(p.overrides, "gql:S:bbbbbbbb", "site").statusCode, 503);
t('single-object import works', p.overrides.size, 1);
p.attachDebugger = origAttach;

t('escapes the full set', p.escapeHtml(`<a href="x" id='y'>&</a>`), '&lt;a href=&quot;x&quot; id=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
t('null -> empty string', p.escapeHtml(null), '');
t('undefined -> empty string', p.escapeHtml(undefined), '');
t('number coerced', p.escapeHtml(404), '404');

p.calls.clear();
const evilKey = p.generateCallKey(false, null, 'https://x.test/a"onmouseover="alert(1)', null);
p.calls.set(evilKey, { type: 'REST', callName: 'a"onmouseover="alert(1)', method: 'GET', fullUrl: 'https://x.test/a', status: 200, hasError: false, requestHeaders: {}, responseHeaders: {}, matchParams: null });
const rendered = p.renderCallRow(evilKey, p.calls.get(evilKey));
t('no attribute break-out in the row', rendered.includes('onmouseover="alert(1)"'), false);
t('quote is entity-encoded', rendered.includes('&quot;'), true);

// --- window identity (name + tint) ---
const bodyClasses = [];
document.body.classList.toggle = (cls, force) => bodyClasses.push([cls, force]);
const rootStyles = [];
document.documentElement.style.setProperty = (name, value) => rootStyles.push([name, value]);
document.documentElement.style.removeProperty = (name) => rootStyles.push([name, null]);
p.elements.identityName = { textContent: '' };
p.elements.identitySwatches = { set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; } };

p.setIdentityName('  Checkout tab  ');
t('name is trimmed', p.identity.name, 'Checkout tab');
t('name shown in the chip', p.elements.identityName.textContent, 'Checkout tab');

p.setIdentityName('');
t('empty name falls back to the prompt label', p.elements.identityName.textContent, 'Name window');

p.setIdentityColor('#ef4444');
t('color stored', p.identity.color, '#ef4444');
t('tint class applied', bodyClasses[bodyClasses.length - 1], ['tinted', true]);
t('identity color variable set', rootStyles[rootStyles.length - 1], ['--identity-color', '#ef4444']);
t('chosen swatch marked active', p.elements.identitySwatches.innerHTML.includes('data-color="#ef4444" style="background: #ef4444"'), true);
t('active class on the chosen swatch', p.elements.identitySwatches.innerHTML.includes('identity-swatch active'), true);

p.setIdentityColor(null);
t('clearing removes the tint class', bodyClasses[bodyClasses.length - 1], ['tinted', false]);
t('clearing removes the color variable', rootStyles[rootStyles.length - 1], ['--identity-color', null]);
t('none swatch marked active', p.elements.identitySwatches.innerHTML.includes('identity-swatch-none active'), true);
t('nothing persisted for identity', p.pendingWrites.size, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
