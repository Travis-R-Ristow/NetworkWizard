const VOID_TAGS = new Set(["input", "br", "img", "meta", "link", "hr"]);
const TAG = /<\/?([a-z]+)((?:\s+[\w-]+(?:=(?:"[^"]*"|'[^']*'))?)*)\s*\/?>/gi;
const ATTR = /([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g;

const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const parseSelector = (selector) => {
  const tag = selector.match(/^([a-z]+)/i);
  const classes = Array.from(selector.matchAll(/\.([\w-]+)/g)).map((m) => m[1]);
  const attrs = Array.from(selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)).map(
    (m) => ({ name: m[1], value: m[2] }),
  );
  return { tag: tag ? tag[1].toUpperCase() : null, classes, attrs };
};

class El {
  constructor(tag = "div", attrs = {}) {
    this.tagName = String(tag).toUpperCase();
    this.attributes = { ...attrs };
    this.children = [];
    this.parent = null;
    this.style = {};
    this.dataset = {};
    this.text = "";

    Object.entries(attrs).forEach(([name, value]) => {
      if (name.startsWith("data-")) {
        this.dataset[camel(name.slice(5))] = value === undefined ? "" : value;
      }
    });

    const list = (attrs.class || "").split(/\s+/).filter(Boolean);
    this.classList = {
      contains: (c) => list.includes(c),
      add: (c) => { if (!list.includes(c)) { list.push(c); } },
      remove: (c) => { const i = list.indexOf(c); if (i >= 0) { list.splice(i, 1); } },
      toggle: (c, force) => {
        const has = list.includes(c);
        const want = force === undefined ? !has : Boolean(force);
        if (want && !has) { list.push(c); }
        if (!want && has) { list.splice(list.indexOf(c), 1); }
        return want;
      },
      _list: list,
    };
  }

  get outerHTML() {
    const attrs = Object.entries(this.attributes)
      .map(([k, v]) => (v === undefined ? ` ${k}` : ` ${k}="${v}"`))
      .join("");
    const tag = this.tagName.toLowerCase();
    if (VOID_TAGS.has(tag)) {
      return `<${tag}${attrs}>`;
    }
    return `<${tag}${attrs}>${this.innerHTML}</${tag}>`;
  }

  get innerHTML() {
    return this.text + this.children.map((c) => c.outerHTML).join("");
  }

  set innerHTML(html) {
    this.children.forEach((c) => { c.parent = null; });
    this.children = [];
    this.text = "";
    parseNodes(html, this);
  }

  get textContent() {
    return this.text + this.children.map((c) => c.textContent).join("");
  }

  set textContent(v) {
    this.children.forEach((c) => { c.parent = null; });
    this.children = [];
    this.text = String(v);
  }

  get isConnected() {
    let node = this;
    while (node.parent) { node = node.parent; }
    return node !== this;
  }

  get firstElementChild() { return this.children[0] || null; }

  get nextElementSibling() {
    if (!this.parent) { return null; }
    const i = this.parent.children.indexOf(this);
    return this.parent.children[i + 1] || null;
  }

  get nextSibling() { return this.nextElementSibling; }

  appendChild(node) { return this.insertBefore(node, null); }

  insertBefore(node, ref) {
    if (node.parent) {
      const from = node.parent.children.indexOf(node);
      if (from >= 0) { node.parent.children.splice(from, 1); }
    }
    node.parent = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at >= 0) { this.children.splice(at, 0, node); } else { this.children.push(node); }
    return node;
  }

  remove() {
    if (!this.parent) { return; }
    const i = this.parent.children.indexOf(this);
    if (i >= 0) { this.parent.children.splice(i, 1); }
    this.parent = null;
  }

  replaceWith(node) {
    if (!this.parent) { return; }
    const parent = this.parent;
    const i = parent.children.indexOf(this);
    this.remove();
    node.parent = parent;
    parent.children.splice(i, 0, node);
  }

  matches(selector) {
    const { tag, classes, attrs } = parseSelector(selector);
    if (tag && this.tagName !== tag) { return false; }
    if (!classes.every((c) => this.classList.contains(c))) { return false; }
    return attrs.every(({ name, value }) =>
      value === undefined
        ? Object.prototype.hasOwnProperty.call(this.attributes, name)
        : this.attributes[name] === value,
    );
  }

  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      node.children.forEach((child) => {
        if (child.matches(selector)) { out.push(child); }
        walk(child);
      });
    };
    walk(this);
    return out;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

const parseAttrs = (raw) => {
  const attrs = {};
  if (!raw) { return attrs; }
  ATTR.lastIndex = 0;
  let m;
  while ((m = ATTR.exec(raw)) !== null) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return attrs;
};

const parseNodes = (html, root) => {
  const source = String(html);
  const stack = [root];
  const roots = [];
  let last = 0;
  let m;

  TAG.lastIndex = 0;
  while ((m = TAG.exec(source)) !== null) {
    const top = stack[stack.length - 1];
    const text = source.slice(last, m.index).trim();
    if (text && top) { top.text += text; }
    last = TAG.lastIndex;

    const tag = m[1].toLowerCase();
    if (m[0].startsWith("</")) {
      if (stack.length > 1) { stack.pop(); }
      continue;
    }

    const el = new El(tag, parseAttrs(m[2]));
    if (top) { top.appendChild(el); } else { roots.push(el); }
    if (!VOID_TAGS.has(tag) && !m[0].endsWith("/>")) { stack.push(el); }
  }

  const tail = source.slice(last).trim();
  const top = stack[stack.length - 1];
  if (tail && top) { top.text += tail; }

  return roots;
};

const parseFragment = (html) => {
  const holder = new El("div");
  parseNodes(html, holder);
  const first = holder.children[0] || null;
  if (first) { first.parent = null; }
  return first;
};

const createElement = (tag) => {
  if (String(tag).toLowerCase() === "template") {
    const tpl = new El("template");
    tpl.content = { firstChild: null };
    Object.defineProperty(tpl, "innerHTML", {
      get() { return this._raw || ""; },
      set(v) { this._raw = v; this.content = { firstChild: parseFragment(v) }; },
    });
    return tpl;
  }
  const el = new El(tag);
  el.click = () => {};
  return el;
};

module.exports = { El, createElement, parseFragment };
