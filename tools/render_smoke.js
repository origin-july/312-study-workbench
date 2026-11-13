/* 渲染冒烟：在最小 DOM 沙箱里跑 app.js 的完整初始化 + 六页渲染，
   只验证「不抛异常、产出非空」，不验证像素。 */
const fs = require('fs');
const path = require('path');
const WEB = '..';

function mkEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), nodeName: (tag || 'div').toUpperCase(),
    innerHTML: '', textContent: '', value: '', checked: false,
    style: new Proxy({}, { get: () => '', set: () => true }),
    dataset: {},
    children: [], childNodes: [], files: [],
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
                 toggle(c,f){ f===undefined? (this._s.has(c)?this._s.delete(c):this._s.add(c)) : (f?this._s.add(c):this._s.delete(c)); },
                 contains(c){return this._s.has(c);} },
    setAttribute(){}, getAttribute(){return null;}, removeAttribute(){},
    appendChild(c){ this.children.push(c); return c; },
    removeChild(c){ return c; }, insertBefore(c){ return c; },
    querySelector(){ return mkEl('div'); },
    querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){},
    focus(){}, blur(){}, click(){}, select(){},
    closest(){ return null; },
    contains(){ return false; },
    getBoundingClientRect(){ return {width:800,height:600,top:0,left:0}; },
    dispatchEvent(){ return true; },
    insertAdjacentHTML(){}, scrollIntoView(){},
    parentNode: null, firstChild: null, lastChild: null,
    offsetWidth: 800, offsetHeight: 600,
    cloneNode(){ return mkEl(tag); }
  };
  return el;
}

const registry = {};
function normKey(sel) {
  const t = String(sel).trim();
  const m = t.match(/^#([\w-]+)$/);
  if (m) return 'ID:' + m[1];       /* #xxx 与 getElementById 视为同一元素 */
  return 'SEL:' + t;
}
function getEl(key) {
  const k = normKey(key);
  if (!registry[k]) registry[k] = mkEl('div');
  return registry[k];
}

const doc = {
  readyState: 'complete',
  title: '',
  cookie: '',
  documentElement: mkEl('html'),
  head: mkEl('head'),
  body: mkEl('body'),
  querySelector(sel) { return getEl(sel); },
  querySelectorAll(sel) {
    if (/nav\.top button/.test(sel) || /nav\.top\s+button/.test(sel)) {
      if (!doc._nav) {
        doc._nav = ['home','bank','catalog','study','review','mine'].map(function (scr) {
          const b = mkEl('button');
          b.dataset.scr = scr;
          return b;
        });
      }
      return doc._nav;
    }
    return [];
  },
  getElementById(id) { return getEl('#' + id); },
  createElement(t) { return mkEl(t); },
  createTextNode(t) { return { nodeValue: t }; },
  addEventListener() {}, removeEventListener() {},
  createEvent() { return { initEvent(){}, }; },
  execCommand() { return true; }
};

const storage = {};
const win = {
  document: doc,
  location: { search: '', href: 'http://localhost/', hash: '' },
  navigator: { clipboard: null, userAgent: 'node' },
  localStorage: {
    getItem(k){ return k in storage ? storage[k] : null; },
    setItem(k,v){ storage[k] = String(v); },
    removeItem(k){ delete storage[k]; },
    clear(){ Object.keys(storage).forEach(k=>delete storage[k]); }
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame(fn){ return setTimeout(fn, 16); },
  cancelAnimationFrame(id){ clearTimeout(id); },
  addEventListener(){}, removeEventListener(){},
  matchMedia(){ return { matches:false, addListener(){}, addEventListener(){} }; },
  alert(){}, confirm(){ return true; }, prompt(){ return ''; },
  scrollTo(){}, scrollBy(){}, print(){},
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  getComputedStyle(){ return { getPropertyValue(){ return ''; } }; },
  console,
  Element: function(){}, HTMLElement: function(){},
  Event: function(t){ this.type = t; },
  CustomEvent: function(t){ this.type = t; },
  Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  URL: { createObjectURL(){ return 'blob:x'; }, revokeObjectURL(){} },
  Blob: function(){}, FileReader: function(){ this.readAsText = function(){}; },
  jsmind: undefined
};

/* fetch：从磁盘读数据文件 */
const fetched = [];
win.fetch = function (u) {
  const name = String(u).replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
  fetched.push(name);
  const fp = path.join(WEB, name);
  return new Promise(function (res) {
    try {
      const txt = fs.readFileSync(fp, 'utf8');
      res({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(txt)), text: () => Promise.resolve(txt) });
    } catch (e) {
      res({ ok: false, status: 404, json: () => Promise.resolve(null), text: () => Promise.resolve('') });
    }
  });
};

/* 把 app.js 放进沙箱执行 */
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
const sandboxKeys = Object.keys(win);
const sandboxVals = sandboxKeys.map(k => win[k]);

let fatal = null;
const vm = require('vm');
const ctx = vm.createContext(win);
win.window = win;
win.self = win;
win.globalThis = win;

try {
  vm.runInContext(appSrc, ctx, { filename: 'app.js' });
} catch (e) {
  fatal = e;
}

setTimeout(function () {
  const errs = [];
  if (fatal) errs.push('初始化抛异常: ' + fatal.message + '\n' + String(fatal.stack).split('\n').slice(0,4).join('\n'));

  /* 逐屏模拟点击导航，收集每屏渲染出的字符数 */
  const screens = ['home','bank','catalog','study','review','mine'];
  const filled = {};
  screens.forEach(function (scr) {
    const btn = (doc._nav || []).filter(function (b) { return b.dataset.scr === scr; })[0];
    if (btn && typeof btn.onclick === 'function') {
      try { btn.onclick(); } catch (e) { errs.push('切到 ' + scr + ' 抛异常: ' + e.message); }
    }
    const el = getEl('#s-' + scr);
    filled['s-' + scr] = String(el.innerHTML || '').length;
  });

  console.log('=== fetch 请求 ===');
  console.log('  ' + (fetched.length ? fetched.join(', ') : '（无）'));

  console.log('\n=== 各屏渲染字符数 ===');
  Object.keys(filled).forEach(function (k) {
    const n = filled[k];
    const mark = n > 0 ? '✅' : (n === 0 ? '⚠ 空' : '— 未渲染(非当前屏)');
    console.log('  ' + k.padEnd(10) + String(n).padStart(6) + '   ' + mark);
  });

  console.log('\n=== 运行时错误 ===');
  if (errs.length) {
    errs.forEach(e => console.log('  ❌ ' + e));
  } else {
    console.log('  ✅ 无异常');
  }
  /* 页面里有 setInterval（倒计时/轮播），必须显式退出，否则进程挂住 */
  const code = (errs.length || filled['s-home'] <= 0) ? 1 : 0;
  process.exit(code);
}, 600);
