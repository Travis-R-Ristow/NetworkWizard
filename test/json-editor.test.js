const fs = require('fs');
const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'panel', 'json-editor.js'), 'utf8')
  .replace(/if \(typeof module[\s\S]*$/, '');

const noop = () => {};
const makeEl = () => {
  const el = {
    _html: '', _text: '', children: [], readOnly: false, value: '', scrollTop: 0, style: {},
    scrollHeight: 0, clientHeight: 0,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    dataset: {}, addEventListener: noop, setAttribute: noop, removeAttribute: noop,
    querySelector: () => makeEl(), querySelectorAll: () => [],
    appendChild: noop, focus: noop, select: noop, scrollIntoView: noop, closest: () => null,
  };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = v; } });
  Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el._text = String(v); el._html = String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); } });
  return el;
};
global.document = { createElement: () => makeEl(), activeElement: null };
global.window = { innerHeight: 800 };
global.getComputedStyle = () => ({ lineHeight: '18' });
global.CSS = { escape: (s) => s };

const JsonEditor = eval(src + '; JsonEditor');

let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
};

const make = (value) => {
  const ed = new JsonEditor(makeEl(), {});
  ed.setValue(value);
  return ed;
};

let ed = make(JSON.stringify({ 'a.b': { 'c[0]': 'x' }, plain: 1 }));
ed.setValueAtPath('$.a.b.c[0]', 'edited');
t('key with dots and brackets edits the right node', ed.parsedJson, { 'a.b': { 'c[0]': 'edited' }, plain: 1 });
t('getValueAtPath reads through metacharacter keys', ed.getValueAtPath('$.a.b.c[0]'), 'edited');

ed = make(JSON.stringify({ items: [{ id: 1 }, { id: 2 }] }));
ed.setValueAtPath('$.items[1].id', 99);
t('array index path edits the right element', ed.parsedJson, { items: [{ id: 1 }, { id: 99 }] });

ed = make('"hello"');
t('root scalar parsed', ed.parsedJson, 'hello');
ed.setValueAtPath('$', 'world');
t('root scalar replaced, not corrupted', ed.parsedJson, 'world');
ed = make('5');
ed.setValueAtPath('$', 42);
t('root number replaced', ed.parsedJson, 42);

ed = make(JSON.stringify({ a: 1 }));
ed.setValueAtPath('$.does.not.exist', 'x');
t('unknown path does not corrupt the doc', ed.parsedJson, { a: 1 });

ed = make(JSON.stringify({ 'evil" onmouseover="alert(1)': 'v', '<img src=x>': 1 }));
t('data-path attribute is escaped', ed.elements.treeView.innerHTML.includes('onmouseover="alert(1)"'), false);
t('raw img tag not emitted', ed.elements.treeView.innerHTML.includes('<img src=x>'), false);
t('quote entity present instead', ed.elements.treeView.innerHTML.includes('&quot;'), true);

ed = make(JSON.stringify({ outer: { '<b>k</b>': 1 } }));
ed.toggleCollapse('$.outer');
t('collapsed preview escapes keys', ed.elements.treeView.innerHTML.includes('<b>k</b>'), false);

ed = make('{not json');
t('parse error captured', ed.parseError !== null, true);
ed = make('');
t('empty value has no error', [ed.parsedJson, ed.parseError], [null, null]);

ed = make(JSON.stringify({ alpha: 'beta', nested: { alpha: 2 } }));
ed.handleSearch('alpha');
t('search finds both key occurrences', ed.searchState.matches.length, 2);
ed.handleSearch('beta');
t('search finds a value', ed.searchState.matches.length, 1);

const MULTIPART = 'Content-Disposition: form-data; name="segment"\nContent-Type: application/octet-stream\n\n' + '\u0000binary'.repeat(500);

const textEditor = (value, scrollHeight) => {
  const ed = make(value);
  ed.elements.textView.scrollHeight = scrollHeight;
  ed.setMode('text');
  return ed;
};

ed = textEditor(MULTIPART, 900);
t('non-JSON body still reports a parse error', ed.parseError !== null, true);
t('non-JSON body sizes the text view (was left at 2 rows)', ed.elements.textView.style.height, '320px');

ed = textEditor('{"a":1}', 60);
t('short valid JSON fits exactly', ed.elements.textView.style.height, '60px');

ed = textEditor(MULTIPART, 100000);
t('huge body is capped at 40vh', ed.elements.textView.style.height, '320px');

global.window.innerHeight = 200;
ed = textEditor(MULTIPART, 100000);
t('cap never drops below the minimum on tiny windows', ed.elements.textView.style.height, '120px');
global.window.innerHeight = 800;

ed = textEditor(MULTIPART, 900);
ed.container.style.height = '400px';
ed.elements.content.clientHeight = 330;
ed.fitTextView();
t('a manually resized editor fills its content area', ed.elements.textView.style.height, '330px');

ed.elements.content.clientHeight = 600;
ed.fitTextView();
t('dragging taller grows the text view', ed.elements.textView.style.height, '600px');

ed.container.style.height = '';
ed.container.style.maxHeight = '';
ed.fitTextView();
t('resetting the size returns to auto-fit', ed.elements.textView.style.height, '320px');

ed = textEditor('{"a":1}', 60);
ed.elements.textView.value = '{"a":1,"b":2}';
ed.elements.textView.scrollHeight = 90;
ed.handleTextInput();
t('typing regrows the text view', ed.elements.textView.style.height, '90px');

ed = make(MULTIPART);
ed.elements.textView.scrollHeight = 900;
ed.elements.textView.style.height = 'untouched';
ed.fitTextView();
t('tree mode leaves the text view alone', ed.elements.textView.style.height, 'untouched');

ed = textEditor('', 40);
t('empty body still gets a concrete height', ed.elements.textView.style.height, '40px');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
