const { p } = require('./harness.js');
let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`); }
};

let attachErr = null, enableErr = null, detached = 0, listeners = 0;
chrome.debugger.attach = (target, ver, cb) => { chrome.runtime.lastError = attachErr; cb(); chrome.runtime.lastError = null; };
chrome.debugger.sendCommand = (target, cmd, params, cb) => {
  chrome.runtime.lastError = cmd === 'Fetch.enable' ? enableErr : null;
  if (cb) cb();
  chrome.runtime.lastError = null;
};
chrome.debugger.detach = () => { detached++; };
chrome.debugger.onEvent = { addListener: () => listeners++, removeListener: () => listeners-- };
chrome.debugger.onDetach = { addListener: () => {}, removeListener: () => {} };
p.addEvent = () => {};

const run = async () => {
  p.debuggerAttached = false; listeners = 0; detached = 0;
  await p.attachDebugger();
  t('attaches cleanly', p.debuggerAttached, true);
  t('event listener registered', listeners, 1);

  await p.attachDebugger();
  t('re-attach is a no-op', listeners, 1);

  p.detachDebugger();
  t('detach clears the flag', p.debuggerAttached, false);
  t('detach removes the listener', listeners, 0);
  t('detach called once', detached, 1);

  attachErr = { message: 'Another debugger is already attached' };
  let rejected = false;
  await p.attachDebugger().catch(() => { rejected = true; });
  t('attach failure rejects', rejected, true);
  t('attach failure leaves flag false', p.debuggerAttached, false);
  t('attach failure registers no listener', listeners, 0);
  attachErr = null;

  enableErr = { message: 'Fetch is not available' };
  rejected = false;
  detached = 0;
  await p.attachDebugger().catch(() => { rejected = true; });
  t('enable failure rejects', rejected, true);
  t('enable failure resets the attached flag', p.debuggerAttached, false);
  t('enable failure removes the listener', listeners, 0);
  t('enable failure detaches the session', detached, 1);
  enableErr = null;

  await p.attachDebugger();
  t('retry after enable failure succeeds', p.debuggerAttached, true);
  t('retry registers exactly one listener', listeners, 1);

  p.intercepts.set('n1', { callKey: 'k' });
  p.detachDebugger();
  t('detach clears tracked intercepts', p.intercepts.size, 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run();
