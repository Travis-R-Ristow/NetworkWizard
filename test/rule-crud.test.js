const { p } = require('./harness.js');

let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
};

const ORIGIN = 'https://site-a.test';
p.currentOrigin = ORIGIN;

let debuggerChecks = 0;
p.checkDebuggerNeeded = () => { debuggerChecks++; };
p.renderCalls = () => {};

const key = p.generateCallKey(true, 'GetUser', null, { id: 1 });
const seedOverride = () => {
  p.overrides.clear();
  p.expandedOverride = null;
  return p.setRule(p.overrides, { key, callName: 'GetUser', type: 'GQL', enabled: true,
    scope: 'site', scopeOrigin: ORIGIN, matchVariablesEnabled: false, responseBodyOverrideEnabled: true });
};
const seedDelay = () => {
  p.delays.clear();
  p.expandedDelay = null;
  return p.setRule(p.delays, { key, callName: 'GetUser', type: 'GQL', enabled: true,
    scope: 'site', scopeOrigin: ORIGIN, delayMs: 15000, delayBefore: true });
};

// --- enable/disable ---
let o = seedOverride();
let id = p.ruleId(o);
debuggerChecks = 0;
p.setRuleEnabled("overrides", id);
t('override toggles to disabled', o.enabled, false);
t('disabling an override re-checks the debugger', debuggerChecks, 1);
p.setRuleEnabled("overrides", id);
t('override toggles back to enabled', o.enabled, true);

let d = seedDelay();
let did = p.ruleId(d);
debuggerChecks = 0;
p.setRuleEnabled("delays", did);
t('delay toggles to disabled', d.enabled, false);
t('disabling a delay re-checks the debugger', debuggerChecks, 1);

// --- soft delete keeps the rule but marks it ---
o = seedOverride();
id = p.ruleId(o);
p.expandedOverride = id;
p.setRuleDeleted("overrides", id, true);
t('deleted override is flagged, not removed', [o.deleted, p.overrides.size], [true, 1]);
t('deleting an override collapses it', p.expandedOverride, null);
t('a deleted override no longer applies', p.findMatchingOverride(key, { id: 1 }, true, true), null);

p.setRuleDeleted("overrides", id, false);
t('restored override is un-flagged', o.deleted, false);
t('a restored override applies again', p.findMatchingOverride(key, { id: 1 }, true, true).key, key);

d = seedDelay();
did = p.ruleId(d);
p.expandedDelay = did;
p.setRuleDeleted("delays", did, true);
t('deleted delay is flagged, not removed', [d.deleted, p.delays.size], [true, 1]);
t('deleting a delay collapses it', p.expandedDelay, null);
t('a deleted delay no longer applies', p.getActiveDelay(key), null);
p.setRuleDeleted("delays", did, false);
t('restored delay applies again', p.getActiveDelay(key).delayMs, 15000);

// --- permanent delete drops it entirely ---
o = seedOverride();
id = p.ruleId(o);
p.expandedOverride = id;
debuggerChecks = 0;
p.purgeRule("overrides", id);
t('purged override is gone from the map', p.overrides.size, 0);
t('purging an override collapses it', p.expandedOverride, null);
t('purging an override re-checks the debugger', debuggerChecks, 1);

d = seedDelay();
did = p.ruleId(d);
p.expandedDelay = did;
debuggerChecks = 0;
p.purgeRule("delays", did);
t('purged delay is gone from the map', p.delays.size, 0);
t('purging a delay collapses it', p.expandedDelay, null);
t('purging a delay re-checks the debugger', debuggerChecks, 1);

// --- unknown ids are inert ---
t('toggling an unknown override is a no-op', p.setRuleEnabled("overrides", 'site|nope'), undefined);
t('deleting an unknown delay is a no-op', p.setRuleDeleted("delays", 'site|nope', true), undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
