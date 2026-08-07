const fs = require('fs');
const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'background.js'), 'utf8');

const handlers = {};
const reg = (name) => ({ addListener: (fn) => { handlers[name] = fn; } });
global.chrome = {
  runtime: { onConnect: reg('connect') },
  tabs: { onRemoved: reg('tabRemoved') },
  webRequest: {
    onBeforeRequest: { addListener: (fn) => { handlers.before = fn; } },
    onCompleted: { addListener: (fn) => { handlers.completed = fn; } },
    onErrorOccurred: { addListener: (fn) => { handlers.error = fn; } },
  },
};
const ctx = {};
eval(src);
const probeSrc = src + '\n; ({ connections, pendingByTab });';
const internals = eval(probeSrc);

let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`); }
};

const { connections, pendingByTab } = internals;
const before = handlers.before, completed = handlers.completed, connect = handlers.connect, tabRemoved = handlers.tabRemoved;

const makePort = () => {
  const port = { name: 'networkwizard', received: [], postMessage: (m) => port.received.push(m), _msg: null, _dis: null };
  port.onMessage = { addListener: (fn) => { port._msg = fn; } };
  port.onDisconnect = { addListener: (fn) => { port._dis = fn; } };
  return port;
};
const bytesOf = (s) => new TextEncoder().encode(s);

for (let i = 0; i < 700; i++) {
  before({ tabId: 5, requestId: `r${i}`, url: `https://x.test/${i}`, method: 'GET', timeStamp: i });
}
t('per-tab buffer capped', pendingByTab.get(5).length, 500);
t('oldest dropped, newest kept', pendingByTab.get(5)[499].requestId, 'r699');

for (let tab = 100; tab < 140; tab++) {
  before({ tabId: tab, requestId: 'a', url: 'https://x.test/', method: 'GET', timeStamp: 0 });
}
t('tab count capped', pendingByTab.size <= 25, true);

const sizeBefore = pendingByTab.size;
completed({ tabId: 999, requestId: 'z', statusCode: 200 });
t('requestEnd does not create a buffer', pendingByTab.has(999), false);
t('tab map unchanged', pendingByTab.size, sizeBefore);

before({ tabId: 7, requestId: 'p1', url: 'https://x.test/a', method: 'GET', timeStamp: 0 });
const port = makePort();
connect(port);
port._msg({ type: 'init', tabId: 7 });
t('buffer drained on connect', port.received.map(m => m.requestId), ['p1']);
t('buffer cleared after drain', pendingByTab.has(7), false);
completed({ tabId: 7, requestId: 'p1', statusCode: 200 });
t('live messages delivered to the port', port.received.length, 2);

const port2 = makePort();
connect(port2);
port2._msg({ type: 'init', tabId: 7 });
t('newest port registered', connections.get(7) === port2, true);
port._dis();
t('stale port disconnect does not evict the live port', connections.get(7) === port2, true);
port2._dis();
t('live port disconnect evicts', connections.has(7), false);

before({ tabId: 8, requestId: 'q', url: 'https://x.test/', method: 'GET', timeStamp: 0 });
tabRemoved(8);
t('tab close clears the buffer', pendingByTab.has(8), false);

const utf8 = '{"emoji":"😀","v":1}';
const all = bytesOf(utf8);
const split = [{ bytes: all.slice(0, 11) }, { bytes: all.slice(11) }];
const port3 = makePort();
connect(port3);
port3._msg({ type: 'init', tabId: 9 });
before({ tabId: 9, requestId: 'm', url: 'https://x.test/gql', method: 'POST', timeStamp: 0, requestBody: { raw: split } });
t('multi-chunk body reassembled across a split multi-byte char', port3.received[0].bodyText, utf8);
before({ tabId: 9, requestId: 'm2', url: 'https://x.test/f', method: 'POST', timeStamp: 0, requestBody: { formData: { a: ['1'] } } });
t('formData body still serialised', port3.received[1].bodyText, '{"a":["1"]}');
before({ tabId: 9, requestId: 'm3', url: 'https://x.test/g', method: 'GET', timeStamp: 0 });
t('no body -> null', port3.received[2].bodyText, null);

const n = port3.received.length;
before({ tabId: 9, requestId: 'x', url: 'chrome://settings', method: 'GET', timeStamp: 0 });
before({ tabId: 9, requestId: 'x', url: 'data:text/plain,hi', method: 'GET', timeStamp: 0 });
t('internal schemes skipped', port3.received.length, n);
before({ tabId: -1, requestId: 'x', url: 'https://x.test/', method: 'GET', timeStamp: 0 });
t('tabless requests skipped', port3.received.length, n);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
