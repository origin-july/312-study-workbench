/* 312 学习工作台 · 门户正式版 v7
 * 数据层复用 v6（store/FSRS/SM2/组卷/判分），视图按门户架构重写：
 * 首页·打卡 / 题库(三栏) / 学习(笔记+概念卡+导图) / 错题复盘 / 我的
 * 全部数据 localStorage 落库；打卡结果经「导出文件 / 复制 / mailto」送出，不依赖第三方服务。
 */
(function () {
  'use strict';

  var KEY = 'k312_web_v1';
  var EXAM = '2027-12-25';
  var DEFAULT_MAIL_TO = 'you@example.com';    /* 打卡结果默认收件人，可在「我的」改 */
  var SUBJECTS = ['心理学导论', '发展心理学', '教育心理学', '实验心理学', '心理统计与测量'];
  var LEGACY_SUB = { '普通心理学': '心理学导论', '社会心理学': '心理学导论', '心理统计': '心理统计与测量', '心理测量': '心理统计与测量' };

  /* ---------- 工具 ---------- */
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  var dkey = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var parseD = function (k) { var p = String(k).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  var addDays = function (k, n) { var d = parseD(k); d.setDate(d.getDate() + n); return dkey(d); };
  var diffDays = function (a, b) { return Math.round((parseD(b) - parseD(a)) / 864e5); };
  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  /* ---------- 稳定 id：从内容派生，而非随机 ----------
     djb2 哈希，与 stable_ids.py 完全一致（按码点迭代，保证中文/emoji 两边同值）。
     为什么必须稳定：qmeta（笔记/草稿）、answers（作答）都按题目 id 索引。
     若 id 随机，localStorage 一旦清空，305 题的进度全部变孤儿、无法恢复。 */
  var MASK32 = 0xFFFFFFFF;
  function djb2(str) {
    var h = 5381;
    var chars = Array.from ? Array.from(String(str)) : String(str).split('');
    for (var i = 0; i < chars.length; i++) {
      var cp = chars[i].codePointAt ? chars[i].codePointAt(0) : chars[i].charCodeAt(0);
      h = (((h << 5) + h + cp) & MASK32) >>> 0;
      /* JS 位运算按 32 位有符号，重新归正 */
      if (h > 0x7FFFFFFF) h = h - 0x100000000 + 0x100000000;
      h = h & MASK32;
    }
    return h >>> 0;
  }
  function b36(n) {
    var d = '0123456789abcdefghijklmnopqrstuvwxyz', out = '';
    n = n >>> 0;
    if (n === 0) return '0';
    while (n > 0) { var r = n % 36; out = d.charAt(r) + out; n = Math.floor(n / 36); }
    return out;
  }
  /* 参与哈希的字段刻意不含 keys/src/points —— 那些会随校订变化，
     改动不应导致 id 变化、进而丢失学习记录 */
  function itemKeyOf(x) {
    return [x.subject, x.ch, x.node, x.type, x.stem].map(function (v) { return v == null ? '' : String(v); }).join('|');
  }
  function stableItemId(x) { return 'q' + b36(djb2(itemKeyOf(x))); }
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var TODAY = dkey(new Date());
  var normSubject = function (s) { var v = LEGACY_SUB[s] || s; return SUBJECTS.indexOf(v) >= 0 ? v : SUBJECTS[0]; };

  /* ---------- 存储 ---------- */
  var store = {
    /* 存储可用性：某些环境（Safari 隐私模式、部分浏览器的 file:// 直开、
       企业策略锁定的浏览器）会直接抛错或静默丢弃。必须先探测，
       否则表现是「用了一下午，关掉就没了」，而用户完全不知道。 */
    available: (function () {
      try {
        var k = '__k312_probe__';
        localStorage.setItem(k, '1');
        var v = localStorage.getItem(k);
        localStorage.removeItem(k);
        return v === '1';
      } catch (e) { return false; }
    })(),
    load: function () {
      if (!this.available) return null;
      try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
    },
    persist: function (db) {
      if (!this.available) return false;
      try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
      catch (e) { return false; }
    }
  };
  var saveTimer = null, dirty = false;
  function save() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null; if (!dirty) return; dirty = false;
      if (!store.persist(DB)) toast('存储已满，请到「我的」导出备份');
    }, 200);
  }
  function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    dirty = false;
    /* 关键路径（打卡、答题、新增留言）都走这里。存储满时必须让用户知道，
       否则表现是「操作成功但刷新后消失」——最容易被误判成偶发 bug。 */
    if (!store.persist(DB)) {
      toast(store.available
        ? '存储已满，本次改动可能未保存。请到「我的」导出备份后清理'
        : '当前环境不允许本地存储，改动无法保存（详见页面顶部提示）');
      return false;
    }
    return true;
  }

  /* ---------- 数据模型 ---------- */
  var CK_DEFAULT = [
    { id: 'ck1', name: '不背单词 App', goal: 60, unit: '个' },
    { id: 'ck2', name: '词书（红宝书）', goal: 1, unit: '节' },
    { id: 'ck3', name: '刘晓艳单词网课', goal: 30, unit: '分钟' },
    { id: 'ck4', name: '专业课课本', goal: 10, unit: '页' },
    { id: 'ck5', name: '专注时长', goal: 50, unit: '分钟', lock: 1 }
  ];
  function blank() {
    return {
      v: 7,
      profile: { examDate: EXAM, start: TODAY, quota: 5, size: 5, scheduler: 'fsrs', examEdited: 0 },
      items: [], run: null, logs: {}, catalog: null,
      checkin: {}, ckitems: JSON.parse(JSON.stringify(CK_DEFAULT)),
      notes: [], cards: [], maps: [], qmeta: {}, doubts: [],
      planMap: {}, pledges: {}, rewards: { seen: {}, msgs: [], custom: {} },
      push: { kind: 'off', url: '', token: '', on: 0 },
      settings: { email: DEFAULT_MAIL_TO, pomoLen: 25 }
    };
  }
  function normItem(x) {
    return {
      id: String(x.id || stableItemId(x)),
      subject: normSubject(x.subject),
      ch: String(x.ch || '').slice(0, 120),
      node: String(x.node || '').slice(0, 200),
      type: x.type === 'mc' ? 'mc' : (x.type === 'essay' ? 'essay' : 'short'),
      stem: String(x.stem || '').slice(0, 500),
      options: Array.isArray(x.options) ? x.options.slice(0, 8).map(function (o) { return String(o).slice(0, 200); }) : [],
      answer: typeof x.answer === 'number' ? x.answer : 0,
      keys: Array.isArray(x.keys) ? x.keys.slice(0, 12).map(function (k) { return String(k).slice(0, 60); }) : [],
      limit: clamp(+x.limit || 8, 1, 60),
      src: typeof x.src === 'string' ? x.src.slice(0, 1200) : '',
      ef: clamp(+x.ef || 2.5, 1.3, 2.8),
      s: isFinite(+x.s) && x.s != null ? +x.s : null,
      d: isFinite(+x.d) && x.d != null ? clamp(+x.d, 1, 10) : null,
      interval: clamp(+x.interval || 0, 0, 3650),
      reps: clamp(+x.reps || 0, 0, 9999),
      lapses: clamp(+x.lapses || 0, 0, 9999),
      due: typeof x.due === 'string' ? x.due : TODAY,
      last: typeof x.last === 'string' ? x.last : '',
      hist: Array.isArray(x.hist) ? x.hist.slice(-40) : [],
      created: typeof x.created === 'string' ? x.created : TODAY,
      mine: x.mine ? 1 : 0
    };
  }
  function normCatalog(raw) {
    if (!raw) return null;
    var parts = Array.isArray(raw.parts) ? raw.parts : (Array.isArray(raw.subjects) ? raw.subjects : null);
    if (parts) {
      return {
        subject: raw.subject || '312 心理学专业基础',
        subjects: parts.slice(0, 8).map(function (p) {
          return {
            subject: normSubject(p.subject),
            chapters: (p.chapters || []).slice(0, 60).map(function (c) {
              return { chapter: String(c.chapter || '').slice(0, 80), tree: Array.isArray(c.tree) ? c.tree.slice(0, 80) : [] };
            })
          };
        })
      };
    }
    if (Array.isArray(raw.chapters)) return { subject: '312', subjects: [{ subject: normSubject(raw.subject), chapters: raw.chapters.slice(0, 60) }] };
    return null;
  }
  function normalize(raw) {
    var db = blank();
    if (!raw || typeof raw !== 'object') return db;
    if (raw.profile && typeof raw.profile === 'object') {
      ['examDate', 'start'].forEach(function (k) { if (typeof raw.profile[k] === 'string') db.profile[k] = raw.profile[k]; });
      db.profile.examEdited = raw.profile.examEdited ? 1 : 0;
      db.profile.size = clamp(+raw.profile.size || 5, 3, 20);
      db.profile.scheduler = raw.profile.scheduler === 'sm2' ? 'sm2' : 'fsrs';
    }
    if (Array.isArray(raw.items)) db.items = raw.items.filter(function (x) { return x && typeof x.stem === 'string' && x.stem; }).map(normItem);
    if (raw.run && Array.isArray(raw.run.ids)) {
      db.run = {
        id: String(raw.run.id || uid()),
        ids: raw.run.ids.filter(function (i) { return typeof i === 'string'; }),
        i: clamp(+raw.run.i || 0, 0, raw.run.ids.length),
        answers: raw.run.answers && typeof raw.run.answers === 'object' ? raw.run.answers : {},
        started: +raw.run.started || Date.now(),
        settled: !!raw.run.settled,
        dayKey: typeof raw.run.dayKey === 'string' ? raw.run.dayKey : TODAY,
        label: String(raw.run.label || '').slice(0, 40)
      };
    }
    if (raw.logs && typeof raw.logs === 'object') {
      Object.keys(raw.logs).forEach(function (k) {
        var l = raw.logs[k];
        if (l && typeof l === 'object') db.logs[k] = { n: +l.n || 0, ok: +l.ok || 0, min: +l.min || 0 };
      });
    }
    if (raw.checkin && typeof raw.checkin === 'object') db.checkin = raw.checkin;
    if (Array.isArray(raw.ckitems) && raw.ckitems.length) db.ckitems = raw.ckitems.map(function (c) {
      return { id: String(c.id || uid()), name: String(c.name || '').slice(0, 40), goal: Math.max(1, +c.goal || 1), unit: String(c.unit || '次').slice(0, 6), lock: c.lock ? 1 : 0 };
    });
    ['notes', 'cards'].forEach(function (k) { if (Array.isArray(raw[k])) db[k] = raw[k].slice(0, 2000); });
    if (Array.isArray(raw.maps)) db.maps = raw.maps.slice(0, 20);
    if (raw.qmeta && typeof raw.qmeta === 'object') db.qmeta = raw.qmeta;
    if (Array.isArray(raw.doubts)) db.doubts = raw.doubts.slice(0, 200);
    if (raw.planMap && typeof raw.planMap === 'object') {
      Object.keys(raw.planMap).forEach(function (k) {
        var v = raw.planMap[k];
        if (typeof v === 'string' && /^w[1-5]$/.test(v)) db.planMap[k] = v;
      });
    }
    if (raw.push && typeof raw.push === 'object') {
      var kindOk = { off: 1, dingtalk: 1, wecom: 1, feishu: 1, pushplus: 1 };
      db.push = {
        kind: kindOk[raw.push.kind] ? raw.push.kind : 'off',
        url: String(raw.push.url || '').slice(0, 400),
        token: String(raw.push.token || '').slice(0, 200),
        on: raw.push.on ? 1 : 0
      };
    }
    if (raw.rewards && typeof raw.rewards === 'object') {
      var cnt = {};
      if (raw.rewards.custom && typeof raw.rewards.custom === 'object') {
        Object.keys(raw.rewards.custom).forEach(function (k) {
          if (/^\d+$/.test(k) && typeof raw.rewards.custom[k] === 'string' && raw.rewards.custom[k]) {
            cnt[k] = raw.rewards.custom[k].slice(0, 140);
          }
        });
      }
      db.rewards = {
        seen: (raw.rewards.seen && typeof raw.rewards.seen === 'object') ? raw.rewards.seen : {},
        msgs: Array.isArray(raw.rewards.msgs) ? raw.rewards.msgs.filter(function (m) { return typeof m === 'string' && m; }).slice(0, 100) : [],
        custom: cnt
      };
    }
    if (raw.pledges && typeof raw.pledges === 'object') {
      Object.keys(raw.pledges).forEach(function (k) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
        var p = raw.pledges[k] || {};
        db.pledges[k] = {
          goal: String(p.goal || '').slice(0, 120),
          block: String(p.block || '').slice(0, 200)
        };
      });
    }
    if (raw.settings && typeof raw.settings === 'object') {
      db.settings.email = String(raw.settings.email || DEFAULT_MAIL_TO).slice(0, 120);
      db.settings.pomoLen = clamp(+raw.settings.pomoLen || 25, 5, 120);
    }
    db.catalog = normCatalog(raw.catalog);
    return db;
  }

  /* ---------- 旧数据迁移：把随机 id 的学习记录搬到稳定 id ----------
     历史缺陷：早期 id 由 uid()（时间戳+随机）生成，清缓存后无法还原。
     现在 id 从内容派生，但用户浏览器里可能还存着旧随机 id 的 qmeta/doubts/answers。
     这里按「内容指纹」把它们一次性搬到新 id 上，避免升级即丢进度。 */
  function migrateStableIds(db) {
    var items = db.items || [];
    var map = {};          /* oldId -> newId */
    var changed = 0;
    items.forEach(function (it) {
      var want = stableItemId(it);
      if (it.id !== want) {
        if (!map[it.id]) map[it.id] = want;
        it.id = want;
        changed++;
      }
    });
    if (!changed) return 0;

    function move(container) {
      if (!container || typeof container !== 'object') return;
      Object.keys(map).forEach(function (old) {
        if (Object.prototype.hasOwnProperty.call(container, old)) {
          if (!Object.prototype.hasOwnProperty.call(container, map[old])) {
            container[map[old]] = container[old];   /* 已有新键则不覆盖 */
          }
          delete container[old];
        }
      });
    }
    move(db.qmeta);
    if (db.run) {
      move(db.run.answers);
      if (Array.isArray(db.run.ids)) {
        db.run.ids = db.run.ids.map(function (id) { return map[id] || id; });
      }
    }
    if (Array.isArray(db.doubts)) {
      db.doubts = db.doubts.map(function (d) {
        if (d && map[d.id]) d.id = map[d.id];
        return d;
      });
      /* 去重：同一题只留一条疑点 */
      var seen = {};
      db.doubts = db.doubts.filter(function (d) {
        if (!d || !d.id) return true;
        if (seen[d.id]) return false;
        seen[d.id] = 1;
        return true;
      });
    }
    return changed;
  }

  var DB = normalize(store.load());
  var _migrated = migrateStableIds(DB);
  if (_migrated) store.persist(DB);   /* 迁移结果立即落盘 */
  var needsSeed = !DB.items.length;
  /* 计划表（plan.json）：只驻内存，不写 localStorage，避免撑爆配额 */
  var PLAN = null;
  var SURPRISE_DB = null;   /* 惊喜表：只进推送，不进界面 */

  /* 单文件版数据缺失时的接收端：把错误摆到界面上，不要让用户对着空题库猜。 */
  window.__k312DataMissing = function (msg) {
    var bar = document.getElementById('datawarn');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'datawarn';
      bar.className = 'storewarn';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.style.display = 'block';
    bar.innerHTML = '⚠ ' + esc(msg);
  };

  (function seedLoad() {
    if (typeof fetch !== 'function') return;
    fetch('plan.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (raw) {
      if (!raw) return;
      PLAN = raw;
      /* 用户没手动改过初试日期时，跟随计划表；改过则以用户为准 */
      var t = raw.exam && raw.exam.target;
      if (t && /^\d{4}-\d{2}-\d{2}$/.test(t) && !DB.profile.examEdited && DB.profile.examDate !== t) {
        DB.profile.examDate = t;
        saveNow();
      }
      render();
    }).catch(function () { });
    /* 惊喜表：只用于打卡推送，界面上任何地方都不渲染 */
    fetch('surprises.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (raw) {
      if (raw && raw.items) SURPRISE_DB = raw.items;
    }).catch(function () { });
    if (needsSeed) {
      fetch('seed.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (raw) {
        if (!raw) return;
        var nb = normalize(raw);
        if (nb.items.length) { DB.items = nb.items; saveNow(); render(); }
      }).catch(function () { });
    }
    if (!DB.catalog || !DB.catalog.subjects.length) {
      fetch('catalog.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (raw) {
        var c = normCatalog(raw);
        if (c) { DB.catalog = c; saveNow(); render(); }
      }).catch(function () { });
    }
  })();

  /* ---------- 掌握四分 ---------- */
  function statusOf(x) {
    if (!x.reps) return 'new';
    if ((x.lapses || 0) >= 2) return 'bad';
    var h = x.hist && x.hist.length ? x.hist[x.hist.length - 1] : null;
    if (h && h.q <= 1) return 'bad';
    if (x.interval >= 21) return 'solid';
    return 'shaky';
  }
  var ST = { solid: '熟练', shaky: '不熟', bad: '不会', new: '没练过' };

  /* ---------- 调度（FSRS / SM2 兜底） ---------- */
  var _fsrs = null;
  function fsrsReady() { return !!(window.FSRS && window.FSRS.fsrs && window.FSRS.Rating && window.FSRS.State); }
  function fsrsEngine() {
    if (!fsrsReady()) return null;
    if (_fsrs) return _fsrs;
    try {
      var p = window.FSRS.generatorParameters({ enable_fuzz: false, enable_short_term: false, request_retention: 0.9 });
      _fsrs = window.FSRS.fsrs(p);
    } catch (e) { _fsrs = null; }
    return _fsrs;
  }
  function applySM2(it, q) {
    if (q >= 3) {
      if (it.reps === 0) it.interval = 1;
      else if (it.reps === 1) it.interval = 6;
      else it.interval = Math.round(it.interval * it.ef);
      it.reps += 1;
    } else { it.reps = 0; it.interval = 1; it.lapses += 1; }
    it.interval = clamp(it.interval, 1, 365);
    it.ef = clamp(it.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), 1.3, 2.8);
    it.last = TODAY; it.due = addDays(TODAY, it.interval);
    it.hist.push({ d: TODAY, q: q }); if (it.hist.length > 40) it.hist.shift();
  }
  function applyFSRS(it, q) {
    var F = window.FSRS, en = fsrsEngine();
    if (!en) return false;
    try {
      var card;
      if ((it.reps || 0) === 0 && F.createEmptyCard) card = F.createEmptyCard(new Date());
      else card = {
        due: parseD(it.due || TODAY),
        stability: Math.max(0.1, it.s != null ? it.s : (it.interval || 0)),
        difficulty: clamp(it.d != null ? it.d : (11 - it.ef * 2.6), 1, 10),
        elapsed_days: 0, scheduled_days: it.interval || 0,
        reps: it.reps || 0, lapses: it.lapses || 0,
        state: it.reps === 1 ? F.State.Learning : F.State.Review,
        last_review: it.last ? parseD(it.last) : undefined
      };
      var rating = q <= 1 ? F.Rating.Again : (q === 3 ? F.Rating.Hard : (q === 4 ? F.Rating.Good : F.Rating.Easy));
      var out = en.next(card, new Date(), rating);
      var nc = out && out.card;
      if (!nc || !isFinite(nc.scheduled_days)) return false;
      it.s = nc.stability; it.d = nc.difficulty;
      it.interval = clamp(Math.round(nc.scheduled_days) || 1, 1, 365);
      it.due = dkey(new Date(nc.due));
      it.reps = nc.reps; it.lapses = nc.lapses;
      it.ef = clamp((11 - nc.difficulty) / 2.6, 1.3, 2.8);
      it.last = TODAY;
      it.hist.push({ d: TODAY, q: q }); if (it.hist.length > 40) it.hist.shift();
      return true;
    } catch (e) { return false; }
  }
  function schedule(it, q) {
    if (DB.profile.scheduler === 'fsrs' && applyFSRS(it, q)) return 'fsrs';
    applySM2(it, q); return 'sm2';
  }

  /* ---------- 组卷 ---------- */
  function byId(id) { for (var i = 0; i < DB.items.length; i++) if (DB.items[i].id === id) return DB.items[i]; return null; }
  function poolSorted(pool) {
    var due = [], fresh = [], rest = [];
    pool.forEach(function (x) {
      if (x.reps > 0 && x.due <= TODAY) due.push(x);
      else if (!x.reps) fresh.push(x);
      else rest.push(x);
    });
    due.sort(function (a, b) { return a.due < b.due ? -1 : 1; });
    return due.concat(fresh, rest);
  }
  function interleave(list, n) {
    var buckets = {}, order = [], out = [];
    list.forEach(function (x) {
      var k = x.subject + '|' + (x.ch || '').split(' · ')[0];
      if (!buckets[k]) { buckets[k] = []; order.push(k); }
      buckets[k].push(x);
    });
    while (out.length < n) {
      var added = false;
      for (var i = 0; i < order.length && out.length < n; i++) {
        var b = buckets[order[i]];
        if (b && b.length) { out.push(b.shift()); added = true; }
      }
      if (!added) break;
    }
    return out;
  }
  function buildIds(pool, n) { return interleave(poolSorted(pool), n).map(function (x) { return x.id; }); }

  function newRun(pool, label, n) {
    var ids = buildIds(pool, n || DB.profile.size);
    if (!ids.length) return null;
    return { id: uid(), ids: ids, i: 0, answers: {}, started: Date.now(), settled: false, dayKey: TODAY, label: label || '自由练习' };
  }
  function startRun(pool, label, n) {
    var r = newRun(pool, label, n);
    if (!r) { toast('这里还没有题，先去题库选一章练，或在「学习」里写笔记'); return false; }
    DB.run = r; S.judge = null; saveNow(); go('bank');
    return true;
  }
  function ensureRun() {
    if (DB.run && DB.run.ids.length && DB.run.dayKey === TODAY && !DB.run.settled) return DB.run;
    var pool = DB.items.filter(function (x) { return x.type !== 'essay'; });
    var r = newRun(pool, '今日一组');
    if (r) { DB.run = r; save(); }
    return r;
  }

  /* ---------- 判分 ---------- */
  function hitRatio(text, keys, stem) {
    if (!keys || !keys.length) return null;
    var t = String(text || '').toLowerCase();
    var hit = keys.filter(function (k) { var kk = String(k).toLowerCase().trim(); return kk && t.indexOf(kk) >= 0; }).length;
    var ns = String(stem || '').replace(/\s/g, '');
    var weak = keys.length <= 1 && keys.some(function (k) { var kk = String(k).replace(/\s/g, ''); return kk && ns.indexOf(kk) >= 0; });
    return { hit: hit, total: keys.length, ratio: hit / keys.length, weak: weak };
  }
  /* 采分点：论述题用预置 points；简答题从 src 原文派生分句；再退化为 keys */
  function pointsOf(it) {
    if (it.points && it.points.length) return it.points.slice(0, 6).map(function (s) { return String(s).trim(); });
    var src = String(it.src || '').replace(/\s+/g, ' ').trim();
    var out = [];
    if (src) {
      src.split(/[。；;！!？?]/).forEach(function (s) {
        s = s.trim();
        if (s.length >= 6) out.push(s);
      });
      if (out.length < 2) {
        out = [];
        src.split(/[，,]/).forEach(function (s) {
          s = s.trim().replace(/^(既|也|而|又|并|且|则|但|同时|其中)/, '');
          if (s.length >= 5) out.push(s);
        });
      }
    }
    if (out.length < 2 && it.keys && it.keys.length) out = it.keys.slice();
    return out.slice(0, 5);
  }
  /* 中文二元组覆盖度：作为"系统预勾"的建议值，用户可以改 */
  function biSet(s) {
    var t = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
    var m = {};
    for (var i = 0; i < t.length - 1; i++) m[t.slice(i, i + 2)] = 1;
    return { set: m, n: Math.max(0, t.length - 1) };
  }
  function autoCheck(text, points) {
    var ans = biSet(text);
    return points.map(function (p) {
      var pb = biSet(p);
      if (!pb.n) return false;
      var hit = 0;
      for (var k in pb.set) if (ans.set[k]) hit++;
      return hit / pb.n >= 0.34;
    });
  }
  function qFromRatio(ratio) {
    if (ratio >= 0.8) return 4;
    if (ratio >= 0.5) return 3;
    if (ratio >= 0.25) return 2;
    return 1;
  }
  function qmeta(id) {
    if (!DB.qmeta[id]) DB.qmeta[id] = { note: '', draft: '', star: 0 };
    return DB.qmeta[id];
  }
  function commitAnswer(it, ok, detail) {
    var q = (detail && detail.q != null) ? detail.q : (ok ? 4 : 1);
    schedule(it, q);
    var run = DB.run;
    if (run) run.answers[it.id] = {
      q: q, ans: detail.ans, text: detail.text, at: Date.now(),
      checks: detail.checks || null, ratio: (detail.ratio == null ? null : detail.ratio)
    };
    var l = DB.logs[TODAY] || (DB.logs[TODAY] = { n: 0, ok: 0, min: 0 });
    l.n += 1; if (ok) l.ok += 1;
    save();
  }

  /* ---------- UI 状态 ---------- */
  var S = { scr: 'home', part: null, ch: null, vtype: '全部', treeOpen: {}, ex: 0, note: 0, draft: 0, mmSel: null, mapSub: null, studySub: '全部', stab: null, compose: null, editIdx: -1, judge: null, catFilter: 'all', pledgeOpen: 0 };

  function go(n) {
    S.scr = n;
    $$('nav.top button').forEach(function (b) {
      var on = b.dataset.scr === n;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('section.scr').forEach(function (s) { s.classList.toggle('on', s.id === 's-' + n); });
    if (n === 'bank') ensureRun();
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    renderHeader();
    if (S.scr === 'home') renderHome();
    else if (S.scr === 'bank') renderBank();
    else if (S.scr === 'catalog') renderCatalog();
    else if (S.scr === 'study') renderStudy();
    else if (S.scr === 'review') renderReview();
    else if (S.scr === 'mine') renderMine();
  }
  function renderHeader() {
    var left = diffDays(TODAY, DB.profile.examDate);
    $('#hdinfo').innerHTML = '距初试 <b>' + left + '</b> 天 · 题库 <b>' + DB.items.length + '</b> 题';
    /* 存储不可用时给一条常驻横幅，而不是只在保存失败时闪一下 toast。
       换电脑 / 换浏览器 / 隐私模式打开时，这是唯一能让用户提前知道的地方。 */
    var bar = document.getElementById('storewarn');
    if (store.available) {
      if (bar) bar.style.display = 'none';
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'storewarn';
      bar.className = 'storewarn';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.style.display = 'block';
    bar.innerHTML = '⚠ 当前浏览器不允许本地存储，这次的打卡和答题不会保存。' +
      '请改用 <b>Chrome / Edge</b> 打开，或把文件和浏览器设置里的「允许本地数据」打开后再用。' +
      '<button class="storewarn-x" aria-label="收起">×</button>';
    var bx = bar.querySelector('.storewarn-x');
    if (bx) bx.onclick = function () { bar.style.display = 'none'; };
  }
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg; el.classList.add('on');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('on'); }, 2400);
  }

  /* ================= 首页 · 打卡 ================= */
  function ckToday() { return DB.checkin[TODAY] || (DB.checkin[TODAY] = {}); }
  function ckHit(c) { return (ckToday()[c.id] || 0) >= c.goal; }
  /* ---------- 计划表辅助 ---------- */
  /* 考试日期的唯一真相源是 DB.profile.examDate（用户可在「我的」改）。
     plan.json 的 exam 只提供初始默认值与说明性元数据。
     历史缺陷：这里优先返回 PLAN.exam，导致用户改日期后顶部栏变了、倒计时不变。 */
  function planExam() {
    var meta = (PLAN && PLAN.exam) ? PLAN.exam : {};
    return {
      target: DB.profile.examDate || meta.target || EXAM,
      first: meta.first || '',
      firstNote: meta.firstNote || '',
      targetNote: meta.targetNote || ''
    };
  }
  function planStage() {
    if (!PLAN || !PLAN.stages) return null;
    for (var i = 0; i < PLAN.stages.length; i++) {
      var s = PLAN.stages[i];
      if (TODAY >= s.start && TODAY <= s.end) return s;
    }
    var last = PLAN.stages[PLAN.stages.length - 1];
    return TODAY < PLAN.stages[0].start ? PLAN.stages[0] : last;
  }
  function planWeek() {
    if (!PLAN || !PLAN.weeks) return null;
    for (var i = 0; i < PLAN.weeks.length; i++) {
      var w = PLAN.weeks[i];
      if (w.start && w.end && TODAY >= w.start && TODAY <= w.end) return w;
    }
    return null;
  }
  function planDay() {
    if (!PLAN || !PLAN.days) return null;
    for (var i = 0; i < PLAN.days.length; i++) if (PLAN.days[i].date === TODAY) return PLAN.days[i];
    return null;
  }
  /* 阶段内的第几周 */
  function stageWeekNo(st) {
    if (!st || !st.start) return 0;
    var d = diffDays(st.start, TODAY);
    return Math.max(1, Math.floor(Math.max(0, d) / 7) + 1);
  }
  function planHeadline() {
    var st = planStage(), w = planWeek();
    if (!st) return '计划表未载入 · 当前是自由练习模式';
    var sw = stageWeekNo(st);
    var parts = ['阶段' + st.no + ' · ' + st.name, '第 ' + sw + ' / ' + st.weeks + ' 周'];
    if (w) parts.push(w.label + '　' + (w.main || ''));
    return parts.join('　|　');
  }
  /* 首页：计划位置 + 今日任务 */
  function planTodayHtml() {
    var st = planStage(), w = planWeek(), d = planDay();
    if (!PLAN) {
      return '<div class="card"><h2>学习计划 <em>未载入</em></h2>' +
        '<div class="muted">没有读到 plan.json。若你是直接双击打开单文件版，计划应已内嵌；' +
        '若是源码版，请确认 plan.json 与 index.html 在同一目录。</div></div>';
    }
    var h = '<div class="card"><h2>当前位置 <em>' + esc(st ? '阶段' + st.no + ' · ' + st.name : '') + '</em></h2>';
    if (st) {
      h += '<div class="pln-row"><span class="pln-k">阶段</span><span class="pln-v">' +
        esc(st.start) + ' → ' + esc(st.end) + '　共 ' + st.weeks + ' 周</span></div>';
      h += '<div class="pln-row"><span class="pln-k">阶段目标</span><span class="pln-v">' + esc(st.goal) + '</span></div>';
      h += '<div class="pln-row"><span class="pln-k">过关门槛</span><span class="pln-v gate">' + esc(st.gate) + '</span></div>';
    }
    if (w) {
      h += '<div class="pln-row"><span class="pln-k">本周</span><span class="pln-v"><b>' + esc(w.label) + '</b>　' +
        esc(w.start) + ' → ' + esc(w.end) + '</span></div>';
      if (w.main) h += '<div class="pln-row"><span class="pln-k">主线</span><span class="pln-v">' + esc(w.main) + '</span></div>';
      if (w.topic) h += '<div class="pln-row"><span class="pln-k">专题</span><span class="pln-v">' + esc(w.topic) + '</span></div>';
      if (w.goal) h += '<div class="pln-row"><span class="pln-k">本周目标</span><span class="pln-v">' + esc(w.goal) + '</span></div>';
      if (w.gate) h += '<div class="pln-row"><span class="pln-k">本周门槛</span><span class="pln-v gate">' + esc(w.gate) + '</span></div>';
    }
    if (d) {
      h += '<div class="todaytask"><div class="tt-head"><b>' + esc(d.d) + ' · ' + esc(d.weekday) + '</b>' +
        '<span class="tt-sub">' + esc(d.subject) + (d.hours ? '　预估 ' + esc(d.hours) + ' h' : '') + '</span></div>';
      h += '<div class="tt-task">' + esc(d.task) + '</div>';
      if (d.output) h += '<div class="tt-line"><i>主动输出</i>' + esc(d.output) + '</div>';
      if (d.check) h += '<div class="tt-line"><i>验收</i>' + esc(d.check) + '</div>';
      h += '</div>';
    } else if (!w) {
      h += '<div class="muted" style="margin-top:9px">今天不在任何已排期的周内——可能是阶段之间的空档，或计划表尚未覆盖到这一天。</div>';
    }
    h += '<div class="muted" style="margin-top:9px">计划来自《312心理学专业基础-2028年12月初试执行计划总表》，共 ' +
      PLAN.stages.length + ' 阶段 / ' + PLAN.weeks.length + ' 周段。</div></div>';
    return h;
  }

  /* ---------- 首页右侧：倒计时 + 自我留言 ---------- */
  var CD = { timer: null };
  var HQ = { idx: -1, timer: null };

  function selfMsgs() {
    return (DB.rewards && DB.rewards.msgs) ? DB.rewards.msgs.filter(function (m) { return m; }) : [];
  }
  /* 每次进入页面随机一条；只有 1 条时固定 */
  function heroQuote() {
    var pool = selfMsgs();
    if (!pool.length) return '';
    if (HQ.idx < 0 || HQ.idx >= pool.length) HQ.idx = Math.floor(Math.random() * pool.length);
    return pool[HQ.idx];
  }
  function heroSideHtml() {
    var q = heroQuote();
    var ex = planExam();          /* 独立函数，不能用 renderHome 的局部变量 */
    var h = '<div class="hero-side">';
    h += '<div class="hs-clock">' +
      '<div class="hs-cap">距 ' + esc(String(ex.target).slice(0, 4)) + ' 考研初试</div>' +
      '<div class="hs-digits">' +
      '<div class="hs-d"><b id="cd-d">--</b><span>天</span></div>' +
      '<div class="hs-d"><b id="cd-h">--</b><span>时</span></div>' +
      '<div class="hs-d"><b id="cd-m">--</b><span>分</span></div>' +
      '<div class="hs-d"><b id="cd-s">--</b><span>秒</span></div>' +
      '</div></div>';
    h += '<div class="hs-quote">' +
      '<div class="hs-qt" id="hero-qt">' + (q ? esc(q) : '还没有写给自己。') + '</div>' +
      '<div class="hs-qs" id="hero-qs">' + (q ? '写给自己的话' : '去「我的 → 自己的留言板」写一句') + '</div>' +
      '</div>';
    h += '</div>';
    return h;
  }
  function startCountdown() {
    if (CD.timer) { clearInterval(CD.timer); CD.timer = null; }
    var ex = planExam();
    var t0 = new Date((ex.target || '2027-12-25') + 'T08:30:00').getTime();
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function tick() {
      var ed = $('#cd-d');
      if (!ed) { if (CD.timer) { clearInterval(CD.timer); CD.timer = null; } return; }
      var diff = t0 - Date.now();
      if (diff < 0) diff = 0;
      var s2 = Math.floor(diff / 1000);
      var d = Math.floor(s2 / 86400); s2 -= d * 86400;
      var hh = Math.floor(s2 / 3600); s2 -= hh * 3600;
      var mm = Math.floor(s2 / 60);
      var ss = s2 - mm * 60;
      ed.textContent = d;
      var eh = $('#cd-h'), em = $('#cd-m'), es = $('#cd-s');
      if (eh) eh.textContent = pad(hh);
      if (em) em.textContent = pad(mm);
      if (es) es.textContent = pad(ss);
    }
    tick();
    CD.timer = setInterval(tick, 1000);
  }
  /* 多条时缓慢轮播，制造「流动」感 */
  function rotateQuote() {
    if (HQ.timer) { clearInterval(HQ.timer); HQ.timer = null; }
    if (selfMsgs().length < 2) return;
    HQ.timer = setInterval(function () {
      var el = $('#hero-qt');
      if (!el) { clearInterval(HQ.timer); HQ.timer = null; return; }
      var pool = selfMsgs();
      if (pool.length < 2) return;
      el.classList.add('fade');
      setTimeout(function () {
        HQ.idx = (HQ.idx + 1) % pool.length;
        el.textContent = pool[HQ.idx];
        el.classList.remove('fade');
      }, 420);
    }, 9000);
  }

  /* ---------- 今日一句话（单框） ---------- */
  function pledgeHtml() {
    var p = DB.pledges[TODAY] || { text: '' , goal: '', block: '' };
    var cur = p.text || [p.goal, p.block].filter(Boolean).join('；');
    var h = '<div class="pledge">' +
      '<div class="pl-head"><b>今日一句话</b>' +
      '<span class="muted">要搞定什么、卡在哪，一句话写完。写下来比想着算数。</span></div>' +
      '<div class="pl-row">' +
      '<textarea id="pl-text" rows="2" maxlength="240" placeholder="例：第六章记忆，能说出三个遗忘理论的区别；卡在干扰说和消退说分不清">' + esc(cur) + '</textarea>' +
      '<button class="mini" data-act="pl-save">记下</button></div>';
    var hist = Object.keys(DB.pledges)
      .filter(function (k) { return k !== TODAY; })
      .map(function (k) {
        var q = DB.pledges[k] || {};
        return { k: k, t: q.text || [q.goal, q.block].filter(Boolean).join('；') };
      })
      .filter(function (x) { return x.t; })
      .sort(function (a, b) { return a.k < b.k ? 1 : -1; })
      .slice(0, 5);
    if (hist.length) {
      h += '<div class="pl-hist">' + hist.map(function (x) {
        return '<div class="pl-h"><span class="pl-d">' + esc(x.k.slice(5)) + '</span>' +
          '<span class="pl-t"><i class="pl-g">' + esc(x.t) + '</i></span></div>';
      }).join('') + '</div>';
    }
    h += '</div>';
    return h;
  }
  /* 里程碑：只报真实进展，不做打卡天数 */
  function momentum() {
    var solid = 0, active = 0;
    DB.items.forEach(function (x) {
      if (x.interval >= 21) solid++;
      if (x.reps) active++;
    });
    var gates = [10, 25, 50, 100, 200, 305];
    var next = gates[gates.length - 1];
    for (var i = 0; i < gates.length; i++) if (solid < gates[i]) { next = gates[i]; break; }
    var left = Math.max(0, next - solid);
    var pct = Math.min(100, Math.round(solid / next * 100));
    var msg;
    if (!active) msg = '还没开始练。今天先来一组，有了第一次记录才有后面的曲线。';
    else if (solid === 0) msg = '有 ' + active + ' 题练过，还没到 21 天间隔。这个阶段最容易觉得「怎么没进步」——正常，继续拉间隔。';
    else if (left > 0) msg = '已掌握 ' + solid + ' 题，到 ' + next + ' 还差 ' + left + ' 题。';
    else msg = '已掌握 ' + solid + ' 题，跨过了 ' + next + ' 这一档。';
    return { solid: solid, active: active, next: next, left: left, pct: pct, msg: msg };
  }
  function subjectProgressHtml() {    var colors = { '心理学导论': 'var(--sticky-yellow)', '发展心理学': 'var(--sticky-blue)', '教育心理学': 'var(--sticky-pink)', '实验心理学': 'var(--sticky-green)', '心理统计与测量': 'var(--sticky-yellow)' };
    var html = '<div class="subjwrap"><h2>📊 五分册进度 <span class="pen">绿条越长＝越熟练</span></h2>';
    SUBJECTS.forEach(function (s) {
      var items = partItems(s); var total = items.length;
      var solid = items.filter(function (x) { return statusOf(x) === 'solid'; }).length;
      var pct = total ? Math.round(solid / total * 100) : 0;
      var col = colors[s] || 'var(--sticky-yellow)';
      html += '<div class="sb"><div class="nm"><span class="dot" style="background:' + col + '"></span>' + esc(s) + '</div>' +
        '<div class="track"><div class="fill" style="width:' + pct + '%;background:' + col + '"></div></div>' +
        '<div class="pct">' + (total ? pct + '%' : '<span class="empty">暂无题目</span>') + '</div></div>';
    });
    html += '</div>';
    return html;
  }
  function renderHome() {
    var h = '';
    /* HERO */
    var ex = planExam();
    var l = DB.logs[TODAY] || { n: 0, ok: 0, min: 0 };
    var mo = momentum();
    h += '<div class="hero"><div class="hero-l">' +
      '<div class="duetag">🎯 目标初试　' + esc(ex.target) + '</div>' +
      '<h1>312 心理学考研 <span class="en">Study Desk</span></h1>' +
      '<div class="sub">' + esc(planHeadline()) + '</div>' +
      '<div class="hero-ctas">' +
      '<button class="btn" data-act="go-bank">✏️ 开始刷题</button>' +
      '<button class="btn ghost" data-act="go-study">进入学习区</button>' +
      '</div>' +
      '<div class="hero-stat">' +
      '<div class="hs"><b>' + DB.items.length + '</b><span>题库总数</span></div>' +
      '<div class="hs"><b>' + l.n + '</b><span>今日刷题</span></div>' +
      '<div class="hs"><b>' + mo.solid + '</b><span>已掌握</span></div>' +
      '</div>' +
      '<div class="hero-mo"><span class="hm-bar"><i style="width:' + mo.pct + '%"></i></span>' +
      '<span class="hm-t">' + esc(mo.msg) + '</span></div>' +
      '</div>' + heroSideHtml() + '</div>';
    /* 今日一句话（单框） */
    h += pledgeHtml();
    /* 计划位置 + 今日任务 */
    h += planTodayHtml();
    h += '<div class="grid2"><div>';
    /* 打卡 */
    h += '<div class="card"><h2>今日打卡 <em>' + TODAY + '</em><span class="sp"></span>' +
      '<button class="btn mini ghost" data-act="ck-template">从计划模板生成</button>' +
      '<button class="btn mini" data-act="ck-add">＋ 新增打卡项</button></h2>';
    h += '<div id="ckform" style="display:none;border:1px dashed var(--acc);border-radius:8px;padding:11px;margin-bottom:9px">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<input id="ckf-name" placeholder="项目名，如：英语真题阅读" style="flex:1;min-width:140px">' +
      '<input id="ckf-goal" type="number" min="1" placeholder="目标" style="width:78px">' +
      '<select id="ckf-unit" style="width:86px"><option>个</option><option>页</option><option>节</option><option>分钟</option><option>题</option><option>篇</option><option>次</option></select>' +
      '<button class="btn mini" data-act="ckf-ok">添加</button>' +
      '<button class="mini" data-act="ckf-cancel">取消</button></div></div>';
    h += '<div id="cktpl" style="display:none"></div>';
    h += '<div id="cklist"></div>';
    h += '<div class="muted" style="margin-top:8px">打卡项完全自定义（内容/单位/目标值由你定）。打满的项会计入日报。</div></div>';
    /* 邮件 */
    h += '<div class="card" id="mailcard" style="display:none"><h2>📮 学习日报 <em>打卡或做题后自动生成</em></h2>' +
      '<div class="mailprev"><div class="mh">收件人：<b id="m-to">（未配置，到「我的」填写）</b>　主题：<b id="m-subj"></b></div>' +
      '<pre id="m-body"></pre></div>' +
      '<div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;align-items:center">' +
      '<button class="btn" data-act="mail-export">导出打卡文件</button>' +
      '<button class="btn ghost" data-act="mail-copy">复制内容</button>' +
      '<button class="mini" data-act="mail-send">用邮件客户端发送</button></div>' +
      '<div class="muted" style="margin-top:8px;line-height:1.65">导出后文件会存到浏览器下载目录，' +
      '定时任务会读取并发到 <b>' + esc(DEFAULT_MAIL_TO) + '</b>。' +
      '不用等定时，也可以直接复制内容发给阿布。</div></div>';
    /* 待办 */
    var due = DB.items.filter(function (x) { return x.reps > 0 && x.due <= TODAY; }).length;
    var wrong = DB.items.filter(function (x) { return x.lapses > 0 || statusOf(x) === 'bad'; }).length;
    h += '<div class="card"><h2>今日待办</h2>' +
      '<div class="ckrow"><div class="nm"><b>到期复习 ' + due + ' 道</b><span>FSRS 排程 · 今日到期</span></div>' +
      '<button class="ckbtn" data-act="todo-due" ' + (due ? '' : 'disabled') + '>去完成</button></div>' +
      '<div class="ckrow"><div class="nm"><b>错题回顾 ' + wrong + ' 道</b><span>曾做错 · 重练</span></div>' +
      '<button class="ckbtn" data-act="todo-wrong" ' + (wrong ? '' : 'disabled') + '>去复盘</button></div></div>';
    h += '</div><div>';
    /* 番茄 */
    h += '<div class="card"><h2>专注番茄钟</h2><div class="pomo">' +
      '<div class="clock" id="pclock">--:--</div><div>' +
      '<button class="btn" id="pbtn">开始专注</button>' +
      '<div class="muted" style="margin-top:6px">今日 <b id="pcount">0</b> 个 · 结束自动计入打卡「专注时长」</div></div></div></div>';
    /* 概览 */
    var l = DB.logs[TODAY] || { n: 0, ok: 0, min: 0 };
    var ckDone = DB.ckitems.filter(ckHit).length;
    h += '<div class="card"><h2>今日概览</h2>' +
      '<div class="rowline"><span>打卡</span><b>' + ckDone + ' / ' + DB.ckitems.length + ' 项</b></div>' +
      '<div class="rowline"><span>刷题</span><b>' + l.n + ' 题 · 对 ' + l.ok + '</b></div>' +
      '<div class="rowline"><span>专注</span><b>' + l.min + ' 分钟</b></div>' +
      '<div class="rowline"><span>连续学习</span><b>' + streak() + ' 天</b></div></div>';
    h += '</div></div>';
    /* 五分册进度：置于页面最底部 */
    h += subjectProgressHtml();
    $('#s-home').innerHTML = h;
    renderCKList();
    renderPomo();
    renderMail();
    startCountdown();
    rotateQuote();
    /* 今日一句话：保存（单框） */
    function savePledge() {
      var el = $('#pl-text');
      if (!el) return;
      if (!DB.pledges[TODAY]) DB.pledges[TODAY] = { text: '' };
      DB.pledges[TODAY].text = el.value.trim().slice(0, 240);
      delete DB.pledges[TODAY].goal;
      delete DB.pledges[TODAY].block;
      saveNow();
      toast('记下了。');
      renderHome();
    }
    $$('[data-act="pl-save"]').forEach(function (b) { b.onclick = savePledge; });
    (function () {
      var el = $('#pl-text');
      if (el) el.onkeydown = function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); savePledge(); }
      };
    })();
    /* hero 两个入口（此前漏绑，点了没反应） */
    $$('[data-act="go-bank"]').forEach(function (b) { b.onclick = function () { go('bank'); }; });
    $$('[data-act="go-study"]').forEach(function (b) { b.onclick = function () { go('study'); }; });
  }
  function streak() {
    var n = 0, k = TODAY;
    while (DB.logs[k] && DB.logs[k].n > 0) { n++; k = addDays(k, -1); }
    return n;
  }
  var PLAN_TPL = [
    { name: '英语真题阅读', goal: 1, unit: '篇' },
    { name: '统计公式默写', goal: 5, unit: '个' },
    { name: '发展心理学笔记', goal: 4, unit: '页' },
    { name: '实验设计练习', goal: 2, unit: '题' }
  ];
  /* 打卡数量选项：分钟按 30 一格；其他按目标值自适应步长 */
  function ckSteps(c) {
    var step = 1;
    if (c.unit === '分钟') step = 30;
    else if (c.goal >= 40) step = 10;
    else if (c.goal >= 15) step = 5;
    else if (c.goal >= 6) step = 2;
    var top = Math.max(c.goal * 2, c.goal + step * 2);
    top = Math.ceil(top / step) * step;
    var arr = [];
    for (var v = 0; v <= top; v += step) arr.push(v);
    if (arr.indexOf(c.goal) < 0) { arr.push(c.goal); arr.sort(function (a, b) { return a - b; }); }
    return arr;
  }
  function ckSelectHtml(c, v) {
    var opts = ckSteps(c);
    var inList = opts.indexOf(v) >= 0;
    var h = '<span class="ckpick"><select class="ckn" data-ckn="' + c.id + '" aria-label="' + esc(c.name) + ' 数量">';
    if (!inList) h += '<option selected value="' + v + '">' + v + ' ' + esc(c.unit) + '</option>';
    opts.forEach(function (o) {
      h += '<option value="' + o + '"' + (o === v ? ' selected' : '') + '>' + o + ' ' + esc(c.unit) + (o === c.goal ? ' · 目标' : '') + '</option>';
    });
    h += '</select></span>';
    return h;
  }
  function renderCKList() {
    var t = ckToday();
    var h = '';
    DB.ckitems.forEach(function (c) {
      var v = t[c.id] || 0;
      var hit = ckHit(c);
      var pct = c.goal ? Math.min(100, Math.round(v / c.goal * 100)) : 0;
      h += '<div class="ckrow' + (hit ? ' hit' : '') + '">' +
        '<div class="nm"><b>' + esc(c.name) + '</b>' +
        '<span>目标 ' + c.goal + ' ' + esc(c.unit) + (c.lock ? ' · 自动累计' : '') + '</span>' +
        '<em class="ckbar"><i style="width:' + pct + '%"></i></em></div>' +
        (c.lock ? '<span class="cklock">' + v + ' / ' + c.goal + '</span>' : ckSelectHtml(c, v)) +
        (c.lock ? '' : '<button class="ckbtn' + (hit ? ' done' : '') + '" data-ck="' + c.id + '">' +
          (hit ? '✓ 已完成' : '打卡') + '</button>') +
        (c.lock ? '' : '<button class="del" data-ckdel="' + c.id + '" aria-label="删除打卡项">×</button>') +
        '</div>';
    });
    $('#cklist').innerHTML = h;
    $$('[data-ck]').forEach(function (b) { b.onclick = function () { doCk(b.dataset.ck); }; });
    $$('[data-ckdel]').forEach(function (b) { b.onclick = function () {
      DB.ckitems = DB.ckitems.filter(function (c) { return c.id !== b.dataset.ckdel; });
      saveNow(); renderCKList(); renderMail(); toast('已删除打卡项');
    }; });
    $$('[data-ckn]').forEach(function (inp) { inp.onchange = function () {
      var t2 = ckToday(); t2[inp.dataset.ckn] = Math.max(0, +inp.value || 0);
      save(); renderCKList(); renderMail();
    }; });
  }
  /* ---------- 满卡奖励 ---------- */
  var REWARDS = [
    { n: 3, title: '第三天', reward: '给自己泡杯茶，五分钟什么都不干。',
      msgs: ['前两天靠劲头，第三天开始靠习惯。今天回来了，就是赚到。'] },
    { n: 7, title: '一周', reward: '点一杯平时舍不得的咖啡，或者早点睡。',
      msgs: ['一周了。真正难的不是学了多少，是每天都回来。',
             '你这一周做的不是「学习」，是「每天出现」。后者更难。'] },
    { n: 30, title: '一个月', reward: '买一本你一直想看的非专业书，与考试无关的那种。',
      msgs: ['一个月的意义不在 30 天，在于你已经不需要靠意志力开始了。',
             '别人看到的是进度，你自己知道的是：那段想放弃的时刻，你留下来了。'] },
    { n: 100, title: '一百天', reward: '安排一个完整下午，彻底不学习，出门走走。',
      msgs: ['一百天。这不是打卡记录，是你和自己反复谈判之后仍然选择留下的证据。',
             '一百天前你也坐在同一张桌子前，只是那时候你还不知道自己能坚持多久。',
             '如果今天回头看，请记得：这 100 天里没有一天是「顺便」过的。'] },
    { n: 200, title: '两百天', reward: '给自己买一件真正想要的东西，不用有理由。',
      msgs: ['两百天。中间一定有很糟的日子，但那些日子没把这条线弄断。',
             '这个数字不好看，也不值得炫耀——它只是说明你还在。这就够了。',
             '两百天以后，你会开始忘记「坚持」这件事本身的重量。这是好事。'] },
    { n: 365, title: '一年', reward: '写一封信给一年后的自己，封进信封，考完再拆。',
      msgs: ['一年。你已经把「学习」从一件事变成了一种状态。',
             '这一年的每一天都不会出现在成绩单上，但它们都会出现在考场上。'] }
  ];
  function fullDays() {
    /* 累计「全部打卡项完成」的天数 */
    var n = 0;
    Object.keys(DB.checkin || {}).forEach(function (k) {
      var t = DB.checkin[k] || {};
      var all = DB.ckitems.length > 0 && DB.ckitems.every(function (c) { return (t[c.id] || 0) >= c.goal; });
      if (all) n++;
    });
    return n;
  }
  function pickMsg(rw) {
    var pool = (rw.msgs || []).slice();
    (DB.rewards && DB.rewards.msgs ? DB.rewards.msgs : []).forEach(function (m) { if (m) pool.push(m); });
    if (!pool.length) return '';
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function checkReward() {
    if (!DB.rewards) DB.rewards = { seen: {}, msgs: [] };
    var n = fullDays();
    var hit = null;
    REWARDS.forEach(function (rw) { if (n >= rw.n && !DB.rewards.seen[rw.n]) hit = rw; });
    if (!hit) return;
    DB.rewards.seen[hit.n] = TODAY;
    saveNow();
    showReward(hit, n);
  }
  function showReward(rw, n) {
    var old = document.getElementById('rw-mask');
    if (old) old.parentNode.removeChild(old);
    var msg = pickMsg(rw);
    var d = document.createElement('div');
    d.id = 'rw-mask';
    d.className = 'rw-mask';
    d.innerHTML = '<div class="rw-card">' +
      '<button class="rw-x" data-rw-close aria-label="关闭">×</button>' +
      '<div class="rw-badge">第 ' + rw.n + ' 天</div>' +
      '<div class="rw-title">' + esc(rw.title) + '</div>' +
      '<div class="rw-num">你已经满卡 <b>' + n + '</b> 天</div>' +
      (msg ? '<div class="rw-msg">' + esc(msg) + '</div>' : '') +
      '<div class="rw-reward"><i>今天是个节点</i>把它记下来。真正要紧的东西，在别处等着你。</div>' +
      '<div class="rw-foot"><button class="btn mini" data-rw-close>收下</button>' +
      '<span class="muted">在「我的 → 自己的留言板」写下这句话</span></div>' +
      '</div>';
    document.body.appendChild(d);
    Array.prototype.forEach.call(d.querySelectorAll('[data-rw-close]'), function (b) {
      b.onclick = function () { d.parentNode && d.parentNode.removeChild(d); };
    });
    d.onclick = function (ev) { if (ev.target === d) d.parentNode && d.parentNode.removeChild(d); };
  }
  /* 自己的留言板：写给自己说的话。首页右侧与满卡弹窗都从这里随机取 */
  function renderRewardsCard() {
    var mine = (DB.rewards && DB.rewards.msgs) || [];
    var h = '<div class="card"><h2>自己的留言板 <em>' + mine.length + ' 条</em></h2>';
    h += '<div class="muted" style="margin-bottom:11px">写给你自己的话。首页右侧每次进来随机抽一条，满卡弹窗也会抽一条。</div>';
    if (mine.length) {
      h += '<div class="rwmsgs" style="border-top:none;padding-top:0">' + mine.map(function (m, i) {
        return '<div class="rwm"><span>' + esc(m) + '</span><button class="mini" data-rwm-del="' + i + '">删</button></div>';
      }).join('') + '</div>';
    } else {
      h += '<div class="muted" style="background:#fdfcf7;border:1.5px dashed #cfc9bb;border-radius:9px;padding:12px;font-size:12px">'
        + '还没有。写一句吧——写给现在的自己，不是写给考完的自己。</div>';
    }
    h += '<div class="rwm-add"><input id="rwm-in" maxlength="160" placeholder="写一句给现在的自己的话…">' +
      '<button class="mini" data-act="rwm-add">添加</button></div></div>';
    return h;
  }

  function doCk(id) {
    var c = DB.ckitems.find(function (x) { return x.id === id; });
    if (!c) return;
    var t = ckToday();
    t[id] = ckHit(c) ? 0 : c.goal;   /* 再点一次可撤销 */
    save(); renderCKList(); renderMail(); renderHome();
    toast(ckHit(c) ? '已打卡：' + c.name : '已撤销：' + c.name);
    if (ckHit(c)) { setTimeout(checkReward, 60); setTimeout(function () { doPush(true); }, 120); }
  }
  function mailBodyHtml() {
    var done = DB.ckitems.filter(ckHit).length;
    var l = DB.logs[TODAY] || { n: 0, ok: 0, min: 0 };
    var fd = fullDays();
    var st = planStage(), wk = planWeek();
    var L = [];
    L.push('今天 ' + TODAY.slice(5) + '　满卡累计 ' + fd + ' 天');
    L.push('');
    if (st) L.push('阶段' + st.no + ' · ' + st.name + (wk ? '　' + wk.label : ''));
    if (wk && wk.main) L.push(wk.main);
    L.push('');
    L.push('━━ 打卡 ' + done + '/' + DB.ckitems.length + ' ━━');
    L.push('');
    DB.ckitems.forEach(function (c) {
      var v = ckToday()[c.id] || 0;
      L.push((ckHit(c) ? '✓ ' : '○ ') + c.name);
      L.push('   ' + v + ' / ' + c.goal + ' ' + c.unit);
    });
    L.push('');
    L.push('━━ 其他 ━━');
    L.push('');
    L.push('刷题 ' + l.n + ' 道（对 ' + l.ok + '）');
    L.push('专注 ' + l.min + ' 分钟');
    var due = DB.items.filter(function (x) { return x.reps > 0 && x.due <= TODAY; }).length;
    var mo = momentum();
    L.push('到期未复习 ' + due + ' 道');
    L.push('已掌握 ' + mo.solid + ' / ' + DB.items.length + ' 题');
    var p = DB.pledges[TODAY];
    if (p && (p.text || p.goal || p.block)) {
      L.push('');
      L.push('━━ 今天的一句话 ━━');
      L.push('');
      L.push(p.text || [p.goal, p.block].filter(Boolean).join('；'));
    }
    L.push('');
    L.push('—— 312 学习工作台');
    return L.join('\n');
  }

  function renderMail() {
    var card = $('#mailcard');
    if (!card) return;
    var done = DB.ckitems.filter(ckHit).length;
    var l = DB.logs[TODAY] || { n: 0, ok: 0, min: 0 };
    if (!done && !l.n) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    $('#m-to').textContent = DB.settings.email || '（未配置，到「我的」填写）';
    $('#m-subj').textContent = '【312 打卡】' + TODAY + ' · ' + done + '/' + DB.ckitems.length + ' 项';
    $('#m-body').textContent = mailBodyHtml();
  }

  /* ---------- 直推（webhook）：点打卡即发，无需导出文件 ---------- */
  /* 支持 4 种通道，在「我的 → 打卡推送」里填 URL 或 token 后启用 */
  var PUSH_DEFAULT = { kind: 'off', url: '', token: '', on: 0 };

  function pushCfg() {
    if (!DB.push) DB.push = { kind: PUSH_DEFAULT.kind, url: '', token: '', on: 0 };
    return DB.push;
  }
  function pushReady() {
    var c = pushCfg();
    return !!(c.on && ((c.kind === 'pushplus' && c.token) || (c.kind !== 'off' && c.kind !== 'pushplus' && c.url)));
  }
  function pushEndpoint() {
    var c = pushCfg();
    if (c.kind === 'pushplus') return 'https://www.pushplus.plus/send';
    return c.url;
  }
  function pushBody(text, title) {
    var c = pushCfg();
    if (c.kind === 'feishu') return { msg_type: 'text', content: { text: text } };
    if (c.kind === 'pushplus') return { token: c.token, title: title, content: text, template: 'txt' };
    /* 钉钉 / 企业微信 同一格式 */
    return { msgtype: 'text', text: { content: text } };
  }
  function doPush(silent) {
    var c = pushCfg();
    if (!c.on) { if (!silent) toast('还没开启打卡推送'); return; }
    if (!pushReady()) { if (!silent) toast('推送地址没填完整'); return; }
    var p = checkinFilePayload();
    var text = p.subj + '\n\n' + p.body + surpriseTail();
    if (typeof fetch !== 'function') { if (!silent) toast('环境不支持推送'); return; }
    if (!silent) toast('正在推送…');
    fetch(pushEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pushBody(text, p.subj))
    }).then(function (r) {
      if (r.ok) { if (!silent) toast('已推送'); }
      else { if (!silent) toast('推送失败 HTTP ' + r.status); }
    }).catch(function (e) {
      if (!silent) toast('推送失败：' + (e && e.message ? e.message : '网络不可达'));
    });
  }
  /* 当天是否有惊喜。只返回给推送使用，界面不调用 */
  function surpriseTail() {
    if (!SURPRISE_DB || !SURPRISE_DB.length) return '';
    var hit = null;
    for (var i = 0; i < SURPRISE_DB.length; i++) {
      if (SURPRISE_DB[i].date === TODAY) { hit = SURPRISE_DB[i]; break; }
    }
    if (!hit) return '';
    return '\n\n════════════════\n  ' + (hit.emoji || '') + '  今天是惊喜日\n════════════════\n\n' +
      '  第 ' + hit.idx + ' / ' + hit.total + ' 次 ' + hit.label + '\n' +
      (hit.stage ? '  阶段：' + hit.stage + '\n' : '') +
      '\n  这条只发给准备惊喜的人。';
  }

  function testPush() {
    var c = pushCfg();
    if (!c.on) { toast('先打开开关'); return; }
    if (!pushReady()) { toast('先把地址/token 填完整'); return; }
    var text = '【312】推送测试\n\n如果你看到这条，说明通道是通的。\n打卡后会自动推送当天结果。';
    fetch(pushEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pushBody(text, '312 推送测试'))
    }).then(function (r) { toast(r.ok ? '测试已发出，去看一眼' : '失败 HTTP ' + r.status); })
      .catch(function (e) { toast('失败：' + (e && e.message ? e.message : '网络不可达')); });
  }

  function renderPushCard() {
    var c = pushCfg();
    var kinds = [
      ['off', '关闭'], ['dingtalk', '钉钉群机器人'], ['wecom', '企业微信群机器人'],
      ['feishu', '飞书群机器人'], ['pushplus', 'PushPlus（微信）']
    ];
    var h = '<div class="card"><h2>打卡推送 <em>' + (c.on ? '已开启' : '未开启') + '</em></h2>';
    h += '<div class="muted" style="margin-bottom:11px">开启后，点一下打卡就直接推到对方那里，不用导出文件、不用等定时任务。</div>';
    h += '<div class="setrow"><span class="k">通道</span><select id="push-kind" style="width:180px">' +
      kinds.map(function (k) { return '<option value="' + k[0] + '"' + (c.kind === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') +
      '</select></div>';
    if (c.kind === 'pushplus') {
      h += '<div class="setrow"><span class="k">Token</span><input id="push-token" value="' + esc(c.token) + '" placeholder="pushplus 的 token"></div>';
    } else if (c.kind !== 'off') {
      h += '<div class="setrow"><span class="k">Webhook</span><input id="push-url" value="' + esc(c.url) + '" placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."></div>';
    }
    h += '<div class="setrow"><span class="k">开关</span>' +
      '<button class="mini" data-act="push-toggle">' + (c.on ? '关闭推送' : '开启推送') + '</button>' +
      '<button class="mini" data-act="push-test">发条测试</button></div>';
    h += '<div class="muted" style="margin-top:8px;line-height:1.7;font-size:11.5px">' +
      '钉钉/企微/飞书：建个两人小群 → 群设置加「自定义机器人」→ 复制 Webhook 地址。<br>' +
      'PushPlus：pushplus.plus 微信扫码登录拿 token，支持建群组让多人收到。</div>';
    h += '</div>';
    return h;
  }

  function checkinFilePayload() {
    var subj = '【312 打卡】' + TODAY + ' · ' + DB.ckitems.filter(ckHit).length + '/' + DB.ckitems.length + ' 项';
    return { name: '312打卡_' + TODAY + '.txt', subj: subj, body: mailBodyHtml() };
  }
  function exportCheckin() {
    var p = checkinFilePayload();
    try {
      var blob = new Blob([p.body], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = p.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.parentNode.removeChild(a); }, 800);
      toast('已导出 ' + p.name);
    } catch (e) { toast('导出失败，请改用「复制内容」'); }
  }
  function copyCheckin() {
    var p = checkinFilePayload();
    function done() { toast('已复制，可直接粘给阿布'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(p.subj + '\n\n' + p.body).then(done, function () { fallbackCopy(p); });
    } else fallbackCopy(p);
  }
  function fallbackCopy(p) {
    var ta = document.createElement('textarea');
    ta.value = p.subj + '\n\n' + p.body;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制，可直接粘给阿布'); }
    catch (e) { toast('复制失败，请手动选中预览区文字'); }
    document.body.removeChild(ta);
  }
  function sendMail() {
    var p = checkinFilePayload();
    var to = DB.settings.email || DEFAULT_MAIL_TO;
    window.location.href = 'mailto:' + to + '?subject=' + encodeURIComponent(p.subj) + '&body=' + encodeURIComponent(p.body);
    toast('已打开邮件客户端');
  }

  /* 番茄钟 */
  var pTimer = null, pLeft = 0;
  function renderPomo() {
    if (!pLeft) pLeft = DB.settings.pomoLen * 60;
    drawClock();
    var c = DB.ckitems.find(function (x) { return x.name === '专注时长'; });
    $('#pcount').textContent = c ? Math.floor((ckToday()[c.id] || 0) / DB.settings.pomoLen) : 0;
    var b = $('#pbtn');
    b.textContent = pTimer ? '暂停' : (pLeft === DB.settings.pomoLen * 60 ? '开始专注' : '继续专注');
    b.onclick = togglePomo;
  }
  function drawClock() {
    var m = Math.floor(pLeft / 60), s = pLeft % 60;
    $('#pclock').textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function togglePomo() {
    if (pTimer) { clearInterval(pTimer); pTimer = null; renderPomo(); return; }
    $('#pbtn').textContent = '暂停';
    pTimer = setInterval(function () {
      pLeft--;
      if (pLeft <= 0) {
        clearInterval(pTimer); pTimer = null;
        var len = DB.settings.pomoLen;
        pLeft = len * 60;
        var c = DB.ckitems.find(function (x) { return x.name === '专注时长'; });
        if (c) { ckToday()[c.id] = (ckToday()[c.id] || 0) + len; }
        var l = DB.logs[TODAY] || (DB.logs[TODAY] = { n: 0, ok: 0, min: 0 });
        l.min += len;
        save(); renderHome();
        toast('番茄完成，' + len + ' 分钟已计入打卡');
        return;
      }
      drawClock();
    }, 1000);
  }

  /* ================= 题库（三栏门户） ================= */
  function chapterItems(chName) {
    return DB.items.filter(function (x) { return (x.ch || '') === chName || (x.ch || '').indexOf(chName) === 0; });
  }
  function partItems(partName) {
    return DB.items.filter(function (x) { return x.subject === partName; });
  }

  /* ================= 目录：时间轴 + 科目矩阵 ================= */
  function chCore(name) { return String(name).replace(/^第[一二三四五六七八九十百\d]+章\s*/, '').trim(); }
  function planKey(sub, ch) { return sub + '|' + ch; }
  /* 章节归属：手工覆盖优先，其次计划表解析结果 */
  function weekOf(sub, ch) {
    var k = planKey(sub, ch);
    if (DB.planMap && DB.planMap[k]) return DB.planMap[k];
    if (PLAN && PLAN.planMap && PLAN.planMap[k]) return PLAN.planMap[k];
    return '';
  }
  function weekLabelOf(label) {
    if (!label || !PLAN || !PLAN.weeks) return '未排期';
    for (var i = 0; i < PLAN.weeks.length; i++) {
      if (PLAN.weeks[i].label === label) return label;
    }
    return label || '未排期';
  }
  function stageOfWeekLabel(label) {
    if (!PLAN || !PLAN.weeks) return null;
    for (var i = 0; i < PLAN.weeks.length; i++) {
      if (PLAN.weeks[i].label === label) {
        var st = (PLAN.stages || []).filter(function (x) { return x.id === PLAN.weeks[i].stage; })[0];
        return st || null;
      }
    }
    return null;
  }
  function chStat(name, sub) {
    var arr = DB.items.filter(function (x) {
      return (!sub || x.subject === sub) && (x.ch || '').split(' · ')[0].trim() === name;
    });
    var done = 0, solid = 0;
    arr.forEach(function (x) {
      if (x.reps) done++;
      if (x.interval >= 21) solid++;
    });
    return { total: arr.length, done: done, solid: solid };
  }

  function renderCatalog() {
    if (!S.catTab) S.catTab = 'time';
    var h = '';
    h += '<div class="card"><h2>目录 <em>计划 / 科目</em></h2>';
    h += '<div class="tabs" id="cattabs">' +
      ['time|时间轴', 'ch|科目 × 章节'].map(function (x) {
        var p2 = x.split('|');
        return '<button data-ct="' + p2[0] + '"' + (S.catTab === p2[0] ? ' class="on"' : '') + '>' + p2[1] + '</button>';
      }).join('') + '</div>';

    if (!PLAN) {
      h += '<div class="muted">计划表未载入（plan.json）。时间轴不可用；仍可在「科目 × 章节」里按章练习。</div>';
    }
    if (S.catTab === 'time') h += catTimeHtml();
    else h += catChHtml();
    h += '</div>';
    $('#s-catalog').innerHTML = h;

    $$('[data-ct]').forEach(function (b) { b.onclick = function () { S.catTab = b.dataset.ct; renderCatalog(); }; });
    $$('[data-stage]').forEach(function (b) { b.onclick = function () {
      S.catStage = (S.catStage === b.dataset.stage) ? null : b.dataset.stage;
      renderCatalog();
    }; });
    $$('[data-pracch]').forEach(function (b) { b.onclick = function () {
      var pool = DB.items.filter(function (x) {
        return x.type !== 'essay' && x.subject === b.dataset.pracsub &&
          (x.ch || '').split(' · ')[0].trim() === b.dataset.pracch;
      });
      if (!pool.length) { toast('这一章还没有题'); return; }
      startRun(pool, b.dataset.pracch);
    }; });
    $$('[data-pwk]').forEach(function (sel) { sel.onchange = function () {
      var k = sel.dataset.pwk;
      if (!DB.planMap) DB.planMap = {};
      if (sel.value) DB.planMap[k] = sel.value;
      else delete DB.planMap[k];
      saveNow(); renderCatalog();
    }; });
  }

  /* 时间轴：阶段 → 周段 */
  function catTimeHtml() {
    var st = planStage(), cw = planWeek();
    var h = '';
    /* 阶段条 */
    h += '<div class="stbar">';
    (PLAN.stages || []).forEach(function (x) {
      var cur = st && st.id === x.id;
      h += '<button class="stchip' + (cur ? ' now' : '') + (S.catStage === x.id ? ' on' : '') + '" data-stage="' + x.id + '">' +
        '<span class="st-no">阶段' + x.no + '</span>' +
        '<span class="st-nm">' + esc(x.name) + '</span>' +
        '<span class="st-dt">' + esc(x.start) + ' → ' + esc(x.end) + '　' + x.weeks + ' 周</span>' +
        '</button>';
    });
    h += '</div>';

    var showStages = S.catStage ? (PLAN.stages || []).filter(function (x) { return x.id === S.catStage; }) : (PLAN.stages || []);
    showStages.forEach(function (stg) {
      var wk = (PLAN.weeks || []).filter(function (w) { return w.stage === stg.id; });
      var isCur = st && st.id === stg.id;
      var exT = (PLAN.exam && PLAN.exam.target) || '';
      var afterExam = exT && stg.start > exT;
      h += '<div class="stagebox' + (isCur ? ' cur' : '') + (afterExam ? ' afterexam' : '') + '">';
      h += '<div class="sb2-head"><b>阶段' + stg.no + ' · ' + esc(stg.name) + '</b>' +
        (isCur ? '<span class="pc-badge">当前</span>' : '') +
        (afterExam ? '<span class="pc-badge warn">考试之后</span>' : '') +
        '<span class="sp"></span><span class="muted">' + esc(stg.start) + ' → ' + esc(stg.end) + '</span></div>';
      if (afterExam) {
        h += '<div class="sb2-warn">这个阶段在初试（' + esc(exT) + '）之后，是按「两次考试」编排的。' +
          '如果只考 28 届，这部分需要重排——先按前面阶段走。</div>';
      }
      if (stg.goal) h += '<div class="sb2-goal"><i>目标</i>' + esc(stg.goal) + '</div>';
      if (stg.gate) h += '<div class="sb2-gate"><i>门槛</i>' + esc(stg.gate) + '</div>';
      if (wk.length) {
        h += '<div class="wklist">';
        wk.forEach(function (w) {
          var cur2 = cw && cw.label === w.label && cw.stage === w.stage;
          h += '<div class="wkrow' + (cur2 ? ' now' : '') + '">' +
            '<span class="wk-l2">' + esc(w.label) + '</span>' +
            '<span class="wk-d">' + esc(w.start) + ' ~ ' + esc(w.end) + '</span>' +
            '<span class="wk-m">' + esc(w.main || '') + (w.topic ? '<i>　' + esc(w.topic) + '</i>' : '') + '</span>' +
            '</div>';
          if (cur2 && (w.goal || w.gate)) {
            h += '<div class="wkrow-detail">' +
              (w.goal ? '<div><i>目标</i>' + esc(w.goal) + '</div>' : '') +
              (w.gate ? '<div><i>门槛</i>' + esc(w.gate) + '</div>' : '') + '</div>';
          }
        });
        h += '</div>';
      } else {
        h += '<div class="muted" style="margin-top:7px">这一阶段没有细到周的排期（阶段一为 21 天逐日计划，见首页今日任务）。</div>';
      }
      if (stg.id === 's1' && PLAN.days && PLAN.days.length) {
        h += '<details class="s1days"><summary>展开 21 天逐日计划（' + PLAN.days.length + ' 天）</summary><div class="s1list">';
        PLAN.days.forEach(function (d) {
          var today = d.date === TODAY;
          h += '<div class="s1row' + (today ? ' now' : '') + '"><b>' + esc(d.d) + '</b>' +
            '<span class="s1d">' + esc(d.date.slice(5)) + '</span>' +
            '<span class="s1s">' + esc(d.subject) + '</span>' +
            '<span class="s1t">' + esc(d.task) + '</span></div>';
        });
        h += '</div></details>';
      }
      h += '</div>';
    });
    /* 里程碑 */
    if (PLAN.milestones && PLAN.milestones.length) {
      h += '<div class="mlbox"><h3>里程碑</h3><div class="mllist">';
      PLAN.milestones.forEach(function (m) {
        h += '<div class="mlrow"><span class="ml-d">' + esc(m.date) + '</span>' +
          '<span class="ml-n">' + esc(m.name) + '</span>' +
          '<span class="ml-x">' + esc(m.desc || '') + '</span></div>';
      });
      h += '</div></div>';
    }
    return h;
  }

  /* 科目 × 章节 */
  function catChHtml() {
    var subs = (DB.catalog && DB.catalog.subjects) || [];
    var h = '<div class="muted" style="margin:0 0 11px">「计划」列来自计划表解析，可手动改。数字是「熟练 / 已练 / 总题」，点章节名直接练。</div>';
    subs.forEach(function (p) {
      var pTot = 0, pDone = 0;
      p.chapters.forEach(function (c) { var s3 = chStat(c.chapter, p.subject); pTot += s3.total; pDone += s3.done; });
      h += '<div class="subjblock"><h3>' + esc(p.subject) +
        '<span class="sb-sum">已练 ' + pDone + ' / ' + pTot + ' 题</span></h3><div class="chlist">';
      p.chapters.forEach(function (c) {
        var st = chStat(c.chapter, p.subject);
        var wl = weekOf(p.subject, c.chapter);
        var stg = wl ? stageOfWeekLabel(wl) : null;
        var cls = st.total === 0 ? 'none' : (st.done >= st.total ? 'full' : (st.done ? 'part' : 'open'));
        h += '<div class="chrow ' + cls + '">' +
          '<button class="cr-go" data-pracch="' + esc(c.chapter) + '" data-pracsub="' + esc(p.subject) + '">' + esc(c.chapter) + '</button>' +
          '<span class="cr-bar"><i style="width:' + (st.total ? Math.round(st.done / st.total * 100) : 0) + '%"></i></span>' +
          '<span class="cr-num">' + (st.total ? st.solid + '/' + st.done + '/' + st.total : '无题') + '</span>' +
          '<span class="cr-wk' + (wl ? '' : ' unset') + '">' + (wl ? (stg ? 'S' + stg.no + '·' : '') + esc(wl) : '未排期') + '</span>' +
          '</div>';
      });
      h += '</div></div>';
    });
    return h;
  }

  function renderBank() {
    var run = ensureRun();
    var parts = (DB.catalog && DB.catalog.subjects) || [];
    /* 左树 */
    var tree = '<h3>知识树 · 312 五分册</h3>';
    if (!parts.length) tree += '<div class="muted">目录载入中…</div>';
    parts.forEach(function (p) {
      var n = partItems(p.subject).length;
      var open = S.treeOpen[p.subject];
      tree += '<div class="tr-part' + (S.part === p.subject ? ' on' : '') + '" data-part="' + esc(p.subject) + '">' +
        esc(p.subject) + '<i>' + n + '</i></div>';
      if (open) {
        tree += n ? '<div style="padding:2px 6px 6px 16px"><button class="btn mini ghost" data-pracpart="' + esc(p.subject) + '">练整册 ' + n + ' 题</button></div>' : '';
        p.chapters.forEach(function (c) {
          var m = chapterItems(c.chapter).length;
          tree += '<div class="tr-ch' + (S.ch === c.chapter ? ' on' : '') + '" data-ch="' + esc(c.chapter) + '">' +
            esc(c.chapter) + '<i>' + (m || '') + '</i></div>';
        });
      }
    });
    /* 中间题流 */
    var poolAll = DB.items.filter(function (x) { return x.type !== 'essay'; });
    var dueN = poolAll.filter(function (x) { return x.reps > 0 && x.due <= TODAY; }).length;
    var freshN = poolAll.filter(function (x) { return !x.reps; }).length;
    var isDaily = !run || run.label === '今日一组';
    var flow = '<div class="dailybar' + (isDaily ? ' live' : '') + '">' +
      '<div class="db-l"><b>今日一组</b>' +
      '<span class="muted">' + (isDaily ? '到期题 + 新题自动组卷，不用挑章节' : '当前在练：' + esc(run ? run.label : '—')) + '</span></div>' +
      '<div class="db-m"><span class="dbtag">到期 <b>' + dueN + '</b></span><span class="dbtag">未练 <b>' + freshN + '</b></span></div>' +
      (isDaily
        ? '<button class="mini" data-act="daily-new">换一组</button>'
        : '<button class="btn mini" data-act="daily-back">回到今日一组</button>') +
      '</div>';
    flow += '<div class="chips">' +
      ['全部', '选择', '简答'].map(function (t) {
        var n = t === '全部' ? (run ? run.ids.length : 0) :
          run ? run.ids.filter(function (id) {
            var it = byId(id); if (!it) return false;
            return t === '选择' ? (it.type === 'mc' || it.type === 'choice') : it.type === 'short';
          }).length : 0;
        return '<div class="chip' + (S.vtype === t ? ' on' : '') + '" data-vt="' + t + '">' + t + ' ' + n + '</div>';
      }).join('') + '</div>';
    flow += '<div class="qcard">';
    if (!run || !run.ids.length) {
      flow += '<div class="muted">当前没有可做的题。<br>在左侧点一章开始练。</div>';
    } else if (run.settled) {
      flow += settleHtml(run);
    } else {
      flow += '<div class="qnums">' + run.ids.map(function (id, idx) {
        var a = run.answers[id];
        var st = a ? (a.q >= 3 ? 'ok' : 'no') : '';
        return '<b class="' + st + (idx === run.i ? ' cur' : '') + '" data-qn="' + idx + '">' + (idx + 1) +
          (qmeta(id).star ? '<i>★</i>' : '') + '</b>';
      }).join('') + '</div>';
      flow += qcardHtml(run);
    }
    flow += '</div>';
    /* 右栏统计 */
    var done = run ? Object.keys(run.answers).length : 0;
    var ok = run ? Object.keys(run.answers).filter(function (id) { return run.answers[id].q >= 3; }).length : 0;
    var no = done - ok;
    var starred = Object.keys(DB.qmeta).filter(function (id) { return DB.qmeta[id].star && byId(id); }).length;
    var stats = '<h3>本组进度</h3><div class="big">' + done + ' / ' + (run ? run.ids.length : 0) + '</div>' +
      '<div class="minibar"><i class="ok" style="flex:' + ok + '"></i><i class="no" style="flex:' + no + '"></i><i class="todo" style="flex:' + Math.max(0.001, (run ? run.ids.length - done : 0)) + '"></i></div>' +
      '<div class="row"><span>答对</span><b style="color:var(--acc)">' + ok + '</b></div>' +
      '<div class="row"><span>答错</span><b style="color:var(--bad)">' + no + '</b></div>' +
      '<div class="row"><span>正确率</span><b>' + (done ? Math.round(ok / done * 100) + '%' : '—') + '</b></div>' +
      '<div class="row"><span>本组</span><b>' + esc(run ? run.label : '—') + '</b></div>' +
      '<div class="row"><span>收藏</span><b>' + starred + '</b></div>' +
      '<div class="row"><span>连续学习</span><b>' + streak() + ' 天</b></div>' +
      '<div class="muted" style="margin-top:9px">左树点章=练这一章；题号格子可跳题；工具条四件套就地可用。</div>';
    $('#s-bank').innerHTML = '<div class="portal"><aside class="kbtree">' + tree + '</aside><div>' + flow + '</div>' +
      '<aside class="qstats">' + stats + '</aside></div>';
    bindBank(run);
  }
  function settleHtml(run) {
    var rows = run.ids.map(function (id) { return { it: byId(id), a: run.answers[id] }; }).filter(function (r) { return r.it && r.a; });
    var ok = rows.filter(function (r) { return r.a.q >= 3; }).length;
    var wrong = rows.filter(function (r) { return r.a.q < 3; });
    var h = '<h2 style="font-size:15px;margin-bottom:8px">本轮完成 · ' + esc(run.label) + '</h2>' +
      '<div style="font-size:13px;line-height:1.9">共 ' + rows.length + ' 题 · 答对 <b style="color:var(--acc)">' + ok + '</b> · 答错 <b style="color:var(--bad)">' + wrong.length + '</b>' +
      (rows.length ? ' · 正确率 ' + Math.round(ok / rows.length * 100) + '%' : '') + '</div>';
    if (wrong.length) {
      h += '<div class="muted" style="margin:10px 0 6px">答错的题已进错题本：</div>';
      h += wrong.map(function (r) {
        return '<div class="noterow">' + esc(r.it.stem) + '<span class="m" style="display:block">' + esc(r.it.subject) + ' · 明天 ' + r.it.due + ' 再见</span></div>';
      }).join('');
    }
    h += '<div class="qbtnrow"><button class="btn" data-act="run-new">再练一组</button></div>';
    return h;
  }
  function qcardHtml(run) {
    var it = byId(run.ids[run.i]);
    if (!it) return '';
    var m = qmeta(it.id);
    var a = run.answers[it.id];
    var h = '<div class="qmeta">' +
      '<span class="tag">' + esc(it.subject) + '</span><span class="tag">' + esc(it.ch || '未分章') + '</span>' +
      '<span class="tag acc">' + (it.type === 'short' ? '简答' : (it.type === 'essay' ? '论述' : '选择')) + '</span>' +
      '<span class="tag">' + (ST[statusOf(it)] || '') + '</span>' +
      '<span class="sp"></span><button class="starb' + (m.star ? ' on' : '') + '" data-act="star" aria-label="收藏">' + (m.star ? '★' : '☆') + '</button></div>';
    h += '<div class="stem">' + esc(it.stem) + '</div>';
    if (it.type === 'mc' || it.type === 'choice') {
      h += '<div class="opts">' + it.options.map(function (o, i) {
        var sel = a && a.ans === i;
        return '<label class="' + (sel ? 'sel ' : '') + (a ? 'dis' : '') + '"><input type="radio" name="opt" data-opt="' + i + '"' + (sel ? ' checked' : '') + (a ? ' disabled' : '') + '><span>' + esc(o) + '</span></label>';
      }).join('') + '</div>';
    } else {
      var pending = (S.judge && S.judge.id === it.id && !a) ? S.judge : null;
      var taVal = a ? (a.text || '') : (pending ? pending.text : '');
      h += '<div class="ansbox"><textarea id="qans" placeholder="闭卷作答…（提交后对照采分点自评）"' + (a ? ' disabled' : '') + '>' + esc(taVal) + '</textarea></div>';
    }
    /* 自评采分点：未提交 → 可勾选清单；已答 → 勾选结果 */
    var jj = pending;
    var shownChecks = jj ? jj.checks : (a && a.checks ? a.checks : null);
    var shownPts = jj ? jj.points : (a && a.checks ? pointsOf(it) : null);
    if (shownChecks && shownPts && shownPts.length) {
      var hi = shownChecks.filter(Boolean).length, tot = shownPts.length;
      h += '<div class="judgebox' + (a ? (a.q >= 3 ? ' ok' : ' no') : '') + '">' +
        '<div class="jb-head">' + (a ? (a.q >= 3 ? '✓ 已记　' : '✗ 已记　') : '对照采分点，勾出你答到的：') +
        '<b>' + hi + '/' + tot + '</b>' +
        (a && a.ratio != null ? '<span class="jb-pct">' + Math.round(a.ratio * 100) + '%</span>' : '') + '</div>';
      h += shownPts.map(function (p, i) {
        return '<label class="jrow' + (shownChecks[i] ? ' on' : '') + '">' +
          '<input type="checkbox" data-jc="' + i + '"' + (shownChecks[i] ? ' checked' : '') + (a ? ' disabled' : '') + '>' +
          '<span>' + esc(p) + '</span></label>';
      }).join('');
      if (!a) {
        h += '<div class="jb-foot"><button class="btn mini" data-act="judge-confirm">确认自评</button>' +
          '<span class="muted">系统按关键词预勾，以你的判断为准</span></div>';
      }
      if (it.src) h += '<details class="jb-src"><summary>对照教材原文</summary><div>' + esc(it.src) + '</div></details>';
      h += '</div>';
    } else if (a) {
      var r = hitRatio(a.text, it.keys, it.stem);
      h += '<div class="judge ' + (a.q >= 3 ? 'ok' : 'no') + '"><span>' + (a.q >= 3 ? '✓ 通过' : '✗ 有偏差') +
        (r ? '　采分点 ' + r.hit + '/' + r.total : '') + '</span>' +
        (it.type !== 'mc' ? '<button class="btn mini ghost" data-act="rejudge-ok">其实会了</button><button class="btn mini ghost" data-act="rejudge-no">其实不会</button>' : '') +
        '<button class="btn mini ghost" data-act="doubt">存疑复核</button></div>';
      if (r && r.weak) h += '<div class="weakwarn">⚠ 本题采分点过少，命中率不可信——请按自评改判。</div>';
    }
    /* 四件套工具条 */
    h += '<div class="qtools">' +
      '<button data-act="t-ex" class="' + (S.ex ? 'on' : '') + '">📖 解析</button>' +
      '<button data-act="t-note" class="' + (S.note ? 'on' : '') + '">📝 笔记' + (m.note ? ' ·' : '') + '</button>' +
      '<button data-act="t-draft" class="' + (S.draft ? 'on' : '') + '">✏️ 草稿</button></div>';
    if (S.ex) h += '<div class="toolpanel"><div class="expl">' + (it.src ? esc(it.src) : '暂无原文解析。') +
      (it.keys && it.keys.length ? '<br><b>采分点：</b>' + esc(it.keys.join(' · ')) : '') + '</div></div>';
    if (S.note) h += '<div class="toolpanel">我的笔记（挂在题目上，复盘可见）：<textarea id="note-in" placeholder="写只有你懂的提醒…">' + esc(m.note) + '</textarea></div>';
    if (S.draft) h += '<div class="toolpanel">草稿（不参与判分）：<textarea id="draft-in">' + esc(m.draft) + '</textarea></div>';
    h += '<div class="qbtnrow">' + (jj ? '' : '<button class="btn" data-act="q-submit">' + (a ? '下一题 →' : '提交') + '</button>') + '</div>';
    h += '<div class="muted" style="margin-top:7px">第 ' + (run.i + 1) + ' / ' + run.ids.length + ' 题 · ' + esc(run.label) + '</div>';
    return h;
  }
  function bindBank(run) {
    $$('[data-part]').forEach(function (el) { el.onclick = function () {
      S.treeOpen[el.dataset.part] = !S.treeOpen[el.dataset.part];
      S.part = el.dataset.part; S.ch = null;
      renderBank();
    }; });
    $$('[data-pracpart]').forEach(function (el) { el.onclick = function () {
      startRun(partItems(el.dataset.pracpart).filter(function (x) { return x.type !== 'essay'; }), el.dataset.pracpart + ' · 整册');
    }; });
    $$('[data-ch]').forEach(function (el) { el.onclick = function () {
      S.ch = el.dataset.ch;
      startRun(chapterItems(el.dataset.ch).filter(function (x) { return x.type !== 'essay'; }), el.dataset.ch);
    }; });
    $$('[data-vt]').forEach(function (el) { el.onclick = function () { S.vtype = el.dataset.vt; renderBank(); }; });
    /* 今日一组：换一组 / 回到今日一组 */
    $$('[data-act="daily-new"]').forEach(function (b) { b.onclick = function () {
      DB.run = null; S.judge = null; S.part = null; S.ch = null;
      var r = ensureRun();
      if (!r) { toast('题库是空的'); return; }
      saveNow(); renderBank(); toast('已换一组');
    }; });
    $$('[data-act="daily-back"]').forEach(function (b) { b.onclick = function () {
      DB.run = null; S.judge = null; S.part = null; S.ch = null;
      ensureRun(); saveNow(); renderBank();
    }; });
    if (!run || run.settled) {
      var nb = $('[data-act="run-new"]');
      if (nb) nb.onclick = function () { DB.run = null; ensureRun(); renderBank(); };
      return;
    }
    $$('[data-qn]').forEach(function (b) { b.onclick = function () { run.i = +b.dataset.qn; save(); renderBank(); }; });
    var cur = byId(run.ids[run.i]);
    $$('[data-opt]').forEach(function (r) { r.onchange = function () {
      $$('[data-opt]').forEach(function (x) { x.parentElement.classList.toggle('sel', x.checked); });
    }; });
    $$('[data-act]').forEach(function (b) {
      var act = b.dataset.act;
      if (act === 'star') b.onclick = function () { var m = qmeta(cur.id); m.star = m.star ? 0 : 1; save(); renderBank(); };
      else if (act === 't-ex') b.onclick = function () { S.ex = !S.ex; renderBank(); };
      else if (act === 't-note') b.onclick = function () { S.note = !S.note; renderBank(); };
      else if (act === 't-draft') b.onclick = function () { S.draft = !S.draft; renderBank(); };
      else if (act === 'q-submit') b.onclick = function () { submitCurrent(run, cur); };
      else if (act === 'judge-confirm') b.onclick = function () { confirmJudge(run, cur); };
      else if (act === 'rejudge-ok') b.onclick = function () { rejudge(run, cur, true); };
      else if (act === 'rejudge-no') b.onclick = function () { rejudge(run, cur, false); };
      else if (act === 'doubt') b.onclick = function () {
        DB.doubts.push({ id: cur.id, why: '自动判分存疑', at: TODAY });
        save(); toast('已存疑，去「错题与复盘」裁决');
      };
    });
    var ni = $('#note-in'); if (ni) ni.oninput = function () { qmeta(cur.id).note = ni.value; save(); };
    var di = $('#draft-in'); if (di) di.oninput = function () { qmeta(cur.id).draft = di.value; save(); };
    /* 采分点勾选：就地更新，不整页重渲染（避免丢失作答文本与焦点） */
    $$('[data-jc]').forEach(function (cb) { cb.onchange = function () {
      if (!S.judge) return;
      var idx = +cb.dataset.jc;
      S.judge.checks[idx] = cb.checked;
      cb.parentElement.classList.toggle('on', cb.checked);
      var box = cb.parentElement.parentElement;
      var head = box ? box.querySelector('.jb-head b') : null;
      if (head) head.textContent = S.judge.checks.filter(Boolean).length + '/' + S.judge.points.length;
    }; });
  }
  function submitCurrent(run, it) {
    var a = run.answers[it.id];
    if (a) { /* 已答 → 下一题 */
      var next = -1;
      for (var k = run.i + 1; k < run.ids.length; k++) if (!run.answers[run.ids[k]]) { next = k; break; }
      if (next < 0) { run.settled = true; }
      else run.i = next;
      S.judge = null;
      save(); renderBank(); return;
    }
    if (it.type === 'mc' || it.type === 'choice') {
      var sel = $$('[data-opt]').filter(function (x) { return x.checked; })[0];
      if (!sel) { toast('先选一个选项'); return; }
      var ans = +sel.dataset.opt;
      var ok = ans === it.answer;
      commitAnswer(it, ok, { ans: ans, text: it.options[ans] });
      S.ex = 0;
      renderBank();
      if (!ok) toast('已进错题本，明天到期重见');
      return;
    }
    /* 简答/论述：先给出采分点，等自评确认，不立刻落判 */
    var ta = $('#qans');
    var text = ta ? ta.value : '';
    if (text.trim().length < 2) { toast('先闭卷作答再提交'); return; }
    var pts = pointsOf(it);
    S.judge = { id: it.id, text: text, points: pts, checks: autoCheck(text, pts) };
    renderBank();
  }
  function confirmJudge(run, it) {
    var j = S.judge;
    if (!j || j.id !== it.id) return;
    var total = j.points.length;
    var hit = j.checks.filter(Boolean).length;
    var ratio = total ? hit / total : 0;
    var q = qFromRatio(ratio);
    commitAnswer(it, q >= 3, { ans: null, text: j.text, checks: j.checks.slice(), ratio: ratio, q: q });
    S.ex = 0;
    S.judge = null;
    renderBank();
    if (q >= 3) toast('记下了：采分点 ' + hit + '/' + total);
    else toast('采分点 ' + hit + '/' + total + '，已进错题本');
  }
  function rejudge(run, it, nowOk) {
    var a = run.answers[it.id];
    if (!a) return;
    var wasOk = a.q >= 3;
    if (wasOk === nowOk) return;
    a.q = nowOk ? 4 : 1;
    var l = DB.logs[TODAY];
    if (l) { if (nowOk) l.ok += 1; else l.ok -= 1; }
    schedule(it, a.q);
    save(); renderBank();
    toast('已按自评改判并重排');
  }

  /* ================= 学习 ================= */
  function renderStudy() {
    var h = '<div class="card"><h2>学习空间 <em>笔记 · 概念卡 · 思维导图</em></h2>';
    h += '<div class="subfilter">分册：<select id="study-sub">' +
      ['全部'].concat(SUBJECTS).map(function (s) { return '<option' + (S.studySub === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
      '</select><span class="sp"></span>' +
      '<button class="btn mini" data-act="compose" data-kind="note">＋ 新增笔记</button>' +
      '<button class="btn mini" data-act="compose" data-kind="card">＋ 新增概念卡</button>' +
      '</div>';
    h += '<div class="tabs" id="stabs">' +
      ['note|笔记', 'card|概念卡', 'map|思维导图'].map(function (x) {
        var p = x.split('|');
        return '<button data-t="' + p[0] + '"' + (S.stab === p[0] ? ' class="on"' : (S.stab ? '' : p[0] === 'note' ? ' class="on"' : '')) + '>' + p[1] + '</button>';
      }).join('') + '</div>';
    h += '<div id="compose-box"></div>';
    h += '<div id="p-note"' + (S.stab === 'card' || S.stab === 'map' ? ' style="display:none"' : '') + '></div>';
    h += '<div id="p-card"' + (S.stab !== 'card' ? ' style="display:none"' : '') + '></div>';
    h += '<div id="p-map"' + (S.stab !== 'map' ? ' style="display:none"' : '') + '></div>';
    h += '</div>';
    $('#s-study').innerHTML = h;
    if (!S.stab) S.stab = 'note';
    var ss = $('#study-sub');
    if (ss) ss.onchange = function () { S.studySub = ss.value; renderNotes(); renderCards(); };
    $$('[data-act="compose"]').forEach(function (b) { b.onclick = function () {
      var kind = b.dataset.kind;
      S.compose = kind; S.editIdx = -1;
      S.stab = kind;
      $('#p-note').style.display = kind === 'note' ? 'block' : 'none';
      $('#p-card').style.display = kind === 'card' ? 'block' : 'none';
      $('#p-map').style.display = 'none';
      $$('#stabs button').forEach(function (x) { x.classList.toggle('on', x.dataset.t === kind); });
      renderCompose();
      var f = $('#cp-front') || $('#cp-title');
      if (f) f.focus();
    }; });
    $$('#stabs button').forEach(function (b) { b.onclick = function () {
      S.stab = b.dataset.t;
      $('#p-note').style.display = b.dataset.t === 'note' ? 'block' : 'none';
      $('#p-card').style.display = b.dataset.t === 'card' ? 'block' : 'none';
      $('#p-map').style.display = b.dataset.t === 'map' ? 'block' : 'none';
      $$('#stabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
    }; });
    renderCompose(); renderNotes(); renderCards(); renderMap();
  }

  /* 新增/编辑 笔记与概念卡 的内联表单 */
  function renderCompose() {
    var box = $('#compose-box');
    if (!box) return;
    if (!S.compose) { box.innerHTML = ''; return; }
    var isNote = S.compose === 'note';
    var rec = null;
    if (S.editIdx >= 0) {
      var arr = isNote ? DB.notes : DB.cards;
      rec = arr[S.editIdx] || null;
    }
    var part = (rec && rec.part) || (S.studySub !== '全部' ? S.studySub : SUBJECTS[0]);
    var h = '<div class="compose">' +
      '<div class="cp-head">' + (isNote ? '📝 新增笔记' : '🗂️ 新增概念卡') +
      '<span class="sp"></span><button class="mini" data-act="cp-cancel">取消</button></div>';
    if (isNote) {
      h += '<div class="cp-row"><label>标题</label><input id="cp-title" maxlength="40" placeholder="比如：韦伯定律的三个易混点" value="' + esc(rec ? rec.title : '') + '"></div>';
    } else {
      h += '<div class="cp-row"><label>正面<span class="cp-sub">术语</span></label><input id="cp-front" maxlength="40" placeholder="比如：差别阈限" value="' + esc(rec ? rec.front : '') + '"></div>';
      h += '<div class="cp-row"><label>背面<span class="cp-sub">释义</span></label><textarea id="cp-back" rows="3" placeholder="用自己的话说一遍，别抄教材">' + esc(rec ? rec.back : '') + '</textarea></div>';
    }
    h += '<div class="cp-row"><label>分册</label><select id="cp-part">' +
      SUBJECTS.map(function (s) { return '<option' + (s === part ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></div>';
    if (isNote) {
      h += '<div class="cp-row"><label>正文</label><textarea id="cp-body" rows="5" placeholder="记你自己的话：哪里容易错、和谁容易混、怎么记">' + esc(rec ? rec.body : '') + '</textarea></div>';
    }
    h += '<div class="cp-foot"><button class="btn mini" data-act="cp-save">保存</button>' +
      '<span class="muted">' + (isNote ? '标题 + 正文' : '正反面都要填') + '</span></div></div>';
    box.innerHTML = h;
    $$('[data-act="cp-cancel"]').forEach(function (b) { b.onclick = function () { S.compose = null; S.editIdx = -1; renderCompose(); }; });
    $$('[data-act="cp-save"]').forEach(function (b) { b.onclick = function () {
      var sub = $('#cp-part').value;
      if (isNote) {
        var t = $('#cp-title').value.trim(), bd = $('#cp-body').value.trim();
        if (!t) { toast('标题不能空'); return; }
        if (!bd) { toast('正文不能空'); return; }
        var rec2 = { title: t.slice(0, 40), part: sub, body: bd.slice(0, 2000), created: TODAY };
        if (S.editIdx >= 0) DB.notes[S.editIdx] = rec2; else DB.notes.push(rec2);
      } else {
        var f = $('#cp-front').value.trim(), bk = $('#cp-back').value.trim();
        if (!f) { toast('正面不能空'); return; }
        if (!bk) { toast('背面不能空'); return; }
        var rec3 = { front: f.slice(0, 40), back: bk.slice(0, 800), part: sub, created: TODAY };
        if (S.editIdx >= 0) DB.cards[S.editIdx] = rec3; else DB.cards.push(rec3);
      }
      saveNow();
      toast(S.editIdx >= 0 ? '已更新' : '已保存');
      S.compose = null; S.editIdx = -1;
      renderCompose(); renderNotes(); renderCards();
    }; });
  }
  function renderNotes() {
    var el = $('#p-note');
    var list = DB.notes.map(function (n, i) { return { n: n, i: i }; })
      .filter(function (x) { return S.studySub === '全部' || x.n.part === S.studySub; })
      .reverse();
    if (!list.length) {
      el.innerHTML = '<div class="muted">还没有笔记。点上方「＋ 新增笔记」写第一条 —— 记你自己容易混、容易忘的地方，不用抄教材。</div>';
      return;
    }
    var cls = ['', 'b', 'p', 'g'];
    el.innerHTML = '<div class="notes-grid">' + list.slice(0, 60).map(function (x, i) {
      var n = x.n;
      return '<div class="sticky ' + cls[i % 4] + '">' +
        '<button class="cpx" data-del="note" data-i="' + x.i + '" aria-label="删除">×</button>' +
        '<span class="st-title">' + esc(n.title) + '</span>' +
        '<div class="st-body">' + esc(n.body).slice(0, 200) + '</div>' +
        '<div class="st-meta">' + esc(n.part) + ' · ' + esc(n.created || '') +
        '<button class="cp-edit" data-edit="note" data-i="' + x.i + '">编辑</button></div></div>';
    }).join('') + '</div>';
    $$('[data-edit="note"]').forEach(function (b) { b.onclick = function () {
      S.compose = 'note'; S.editIdx = +b.dataset.i; renderCompose();
      var f = $('#cp-title'); if (f) f.focus();
      var box = $('#compose-box'); if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }; });
    $$('[data-del="note"]').forEach(function (b) { b.onclick = function () {
      var n = DB.notes[+b.dataset.i];
      if (!n) return;
      if (!confirm('删除笔记「' + n.title + '」？')) return;
      DB.notes.splice(+b.dataset.i, 1);
      if (S.editIdx === +b.dataset.i) { S.compose = null; S.editIdx = -1; renderCompose(); }
      saveNow(); renderNotes(); toast('已删除');
    }; });
  }
  function renderCards() {
    var el = $('#p-card');
    var list = DB.cards.map(function (c, i) { return { c: c, i: i }; })
      .filter(function (x) { return S.studySub === '全部' || x.c.part === S.studySub; })
      .reverse();
    if (!list.length) {
      el.innerHTML = '<div class="muted">还没有概念卡。点上方「＋ 新增概念卡」：正面写术语，背面用自己的话写释义。</div>';
      return;
    }
    el.innerHTML = '<div class="cards-grid">' + list.slice(0, 60).map(function (x) {
      var c = x.c;
      return '<div class="ccard" data-flip>' +
        '<div class="face front"><div class="cf">' + esc(c.front) + '</div>' +
        '<div class="chint">点击翻转 ▸ ' + esc(c.part) + '</div></div>' +
        '<div class="face back"><div class="cb">' + esc(c.back) + '</div>' +
        '<div class="ctip">' + esc(c.part) +
        '<button class="cp-edit" data-edit="card" data-i="' + x.i + '">编辑</button>' +
        '<button class="cpx in" data-del="card" data-i="' + x.i + '">删除</button>' +
        '</div></div></div>';
    }).join('') + '</div>';
    $$('[data-flip]').forEach(function (e) { e.onclick = function (ev) {
      if (ev.target.closest && ev.target.closest('[data-edit],[data-del]')) return;
      e.classList.toggle('flip');
    }; });
    $$('[data-edit="card"]').forEach(function (b) { b.onclick = function (ev) {
      ev.stopPropagation();
      S.compose = 'card'; S.editIdx = +b.dataset.i; renderCompose();
      var f = $('#cp-front'); if (f) f.focus();
      var box = $('#compose-box'); if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }; });
    $$('[data-del="card"]').forEach(function (b) { b.onclick = function (ev) {
      ev.stopPropagation();
      var c = DB.cards[+b.dataset.i];
      if (!c) return;
      if (!confirm('删除概念卡「' + c.front + '」？')) return;
      DB.cards.splice(+b.dataset.i, 1);
      if (S.editIdx === +b.dataset.i) { S.compose = null; S.editIdx = -1; renderCompose(); }
      saveNow(); renderCards(); toast('已删除');
    }; });
  }
  /* ---------- 章节导图（jsMind） ---------- */
  var MIND = { jm: null, sub: null, depth: 2 };

  function mindNodeStyle(st) {
    if (st.total === 0) return { 'background-color': '#f2f0ea', 'foreground-color': '#9b9baa' };
    if (st.done >= st.total) return { 'background-color': '#d4f0d4', 'foreground-color': '#1f1d2b' };
    if (st.done > 0) return { 'background-color': '#fff3a3', 'foreground-color': '#1f1d2b' };
    return { 'background-color': '#fffdf6', 'foreground-color': '#3a3850' };
  }

  function mindData(subName) {
    var subs = (DB.catalog && DB.catalog.subjects) || [];
    if (!subs.length) return null;
    if (!subName || !subs.some(function (x) { return x.subject === subName; })) subName = subs[0].subject;
    var part = subs.filter(function (x) { return x.subject === subName; })[0];
    var root = { id: '__root', topic: subName, expanded: true, 'background-color': '#1f1d2b', 'foreground-color': '#ffffff' };
    root.children = [];
    (part.chapters || []).forEach(function (c, ci) {
      var st = chStat(c.chapter, subName);
      var node = {
        id: 'c' + ci, topic: c.chapter.replace(/^第[一二三四五六七八九十百\d]+章\s*/, ''),
        expanded: false
      };
      var sty = mindNodeStyle(st);
      for (var k in sty) node[k] = sty[k];
      node.children = [];
      /* 节级：只取一层（有子节点的再展开一层） */
      var flat = [];
      (function walk(list, pre, lvl) {
        (list || []).forEach(function (n) {
          flat.push({ title: n.title, pts: n.pts || 0, lvl: lvl });
          if (n.children && n.children.length && lvl < 1) walk(n.children, pre, lvl + 1);
        });
      })(c.tree, '', 0);
      flat.slice(0, 40).forEach(function (n, si) {
        node.children.push({
          id: 'c' + ci + '_' + si,
          topic: n.title + (n.pts ? '（' + n.pts + '）' : ''),
          'background-color': n.pts ? '#eef4ff' : '#ffffff',
          'foreground-color': n.pts ? '#2b3a55' : '#6b6b7a'
        });
      });
      if (!node.children.length) delete node.children;
      root.children.push(node);
    });
    return { meta: { name: subName, author: '312 工作台', version: '1' }, format: 'node_tree', data: root };
  }

  function mindStats(subName) {
    var subs = (DB.catalog && DB.catalog.subjects) || [];
    var part = subs.filter(function (x) { return x.subject === subName; })[0];
    if (!part) return { ch: 0, sec: 0, chWithQ: 0, total: 0, done: 0 };
    var sec = 0, chWithQ = 0, total = 0, done = 0;
    part.chapters.forEach(function (c) {
      var st = chStat(c.chapter, subName);
      if (st.total) chWithQ++;
      total += st.total; done += st.done;
      (function walk(list) {
        (list || []).forEach(function (n) { sec++; if (n.children) walk(n.children); });
      })(c.tree);
    });
    return { ch: part.chapters.length, sec: sec, chWithQ: chWithQ, total: total, done: done };
  }

  function renderMap() {
    var el = $('#p-map');
    if (!el) return;
    var subs = (DB.catalog && DB.catalog.subjects) || [];
    if (!subs.length) { el.innerHTML = '<div class="muted">目录还没载入。</div>'; return; }
    if (!S.mapSub || !subs.some(function (x) { return x.subject === S.mapSub; })) S.mapSub = subs[0].subject;
    var stt = mindStats(S.mapSub);

    var h = '<div class="mmtool">' +
      '<div class="mm-subs">' + subs.map(function (x) {
        return '<button class="mmsubb' + (x.subject === S.mapSub ? ' on' : '') + '" data-map-sub="' + esc(x.subject) + '">' + esc(x.subject) + '</button>';
      }).join('') + '</div>' +
      '<div class="mm-btns">' +
      '<button class="mini" data-mm="zin" title="放大">＋</button>' +
      '<button class="mini" data-mm="zout" title="缩小">－</button>' +
      '<button class="mini" data-mm="fit" title="适应画布">适应</button>' +
      '<button class="mini" data-mm="expand" title="全部展开">展开</button>' +
      '<button class="mini" data-mm="collapse" title="全部折叠">折叠</button>' +
      '<button class="mini" data-mm="depth" title="展开到节">看节</button>' +
      '<button class="mini" data-mm="shot" title="导出 PNG">导出</button>' +
      '<button class="mini" data-mm="full" title="全屏">全屏</button>' +
      '</div></div>';

    h += '<div class="mmstats">' +
      '<span class="ms"><b>' + stt.ch + '</b>章</span>' +
      '<span class="ms"><b>' + stt.sec + '</b>节</span>' +
      '<span class="ms"><b>' + stt.chWithQ + '</b>章有题</span>' +
      '<span class="ms"><b>' + stt.done + '</b>/' + stt.total + ' 已练</span>' +
      '<span class="ms-legend"><i class="lg full"></i>已练完 <i class="lg part"></i>练过 <i class="lg none"></i>无题</span>' +
      '</div>';

    h += '<div id="mm-canvas" class="mmcanvas"></div>';
    h += '<div class="mmsel" id="mm-sel"><span class="muted">点节点看详情；点章名可展开或收起</span></div>';
    el.innerHTML = h;

    $$('[data-map-sub]').forEach(function (b) { b.onclick = function () { S.mapSub = b.dataset.mapSub; renderMap(); }; });
    $$('[data-mm]').forEach(function (b) { b.onclick = function () { mindAction(b.dataset.mm); }; });

    setTimeout(initMind, 0);
  }

  function initMind() {
    var box = $('#mm-canvas');
    if (!box || typeof window.jsMind === 'undefined') {
      if (box) box.innerHTML = '<div class="muted" style="padding:16px">导图库未加载（vendor/jsmind.js）。</div>';
      return;
    }
    var data = mindData(S.mapSub);
    if (!data) return;
    try {
      if (MIND.jm) { MIND.jm = null; }
      box.innerHTML = '';
      MIND.jm = new window.jsMind({
        container: 'mm-canvas', editable: false, theme: null, mode: 'full',
        support_html: false,
        view: { engine: 'svg', hmargin: 110, vmargin: 40, line_width: 2, line_color: '#c9c4b4', draggable: true },
        layout: { hspace: 36, vspace: 14, pspace: 12 }
      });
      MIND.jm.show(data);
      MIND.jm.expand_to_depth(MIND.depth);
      MIND.jm.add_event_listener(function (type, e) {
        if (type === window.jsMind.event_type.select || type === 1) showMindSel(e);
      });
      setTimeout(function () { try { MIND.jm.resize(); } catch (x) {} }, 60);
    } catch (err) {
      box.innerHTML = '<div class="muted" style="padding:16px">导图初始化失败：' + esc(String(err && err.message || err)) + '</div>';
    }
  }

  function showMindSel(e) {
    var sel = $('#mm-sel');
    if (!sel) return;
    var node = (e && e.node) || (MIND.jm && MIND.jm.get_selected_node && MIND.jm.get_selected_node());
    if (!node) return;
    var topic = node.topic || '';
    var part = (DB.catalog.subjects || []).filter(function (x) { return x.subject === S.mapSub; })[0];
    var chap = null;
    if (part) {
      part.chapters.forEach(function (c) {
        var short = c.chapter.replace(/^第[一二三四五六七八九十百\d]+章\s*/, '');
        if (short === topic || c.chapter === topic) chap = c;
      });
    }
    if (chap) {
      var st = chStat(chap.chapter, S.mapSub);
      var wl = weekOf(S.mapSub, chap.chapter);
      sel.innerHTML = '<b>' + esc(chap.chapter) + '</b>' +
        '<span class="muted">计划 ' + esc(wl || '未排期') + '　' + (st.total ? st.solid + '/' + st.done + '/' + st.total + ' 题' : '暂无题目') + '</span>' +
        (st.total ? '<button class="btn mini" data-mm-prac="' + esc(chap.chapter) + '">练这一章</button>' : '');
    } else {
      sel.innerHTML = '<span class="muted">' + esc(topic) + (/\d/.test(topic) ? '　（节级节点暂无独立题目）' : '') + '</span>';
    }
    $$('[data-mm-prac]').forEach(function (b) { b.onclick = function () {
      var pool = DB.items.filter(function (x) {
        return x.type !== 'essay' && x.subject === S.mapSub && (x.ch || '').split(' · ')[0].trim() === b.dataset.mmPrac;
      });
      if (!pool.length) { toast('这一章还没有题'); return; }
      startRun(pool, b.dataset.mmPrac);
    }; });
  }

  function mindAction(a) {
    var jm = MIND.jm;
    if (!jm) return;
    if (a === 'zin') { jm.view.zoomIn(); }
    else if (a === 'zout') { jm.view.zoomOut(); }
    else if (a === 'fit') { try { jm.view.setZoom(1); jm.resize(); } catch (e) {} }
    else if (a === 'expand') { jm.expand_all(); MIND.depth = 2; }
    else if (a === 'collapse') { jm.collapse_all(); MIND.depth = 1; }
    else if (a === 'depth') {
      MIND.depth = (MIND.depth === 1) ? 2 : 1;
      jm.expand_to_depth(MIND.depth);
      toast(MIND.depth === 2 ? '已展开到节' : '已回到章级');
    }
    else if (a === 'shot') { mindShot(); }
    else if (a === 'full') {
      var box = $('#p-map');
      if (!box) return;
      box.classList.toggle('mmfull');
      setTimeout(function () { try { jm.resize(); } catch (e) {} }, 80);
    }
  }

  function mindShot() {
    var jm = MIND.jm;
    if (!jm || !window.jsMindScreenshot) { toast('导出插件未加载'); return; }
    try {
      var shot = new window.jsMindScreenshot(jm);
      shot.shootDownload('312导图_' + S.mapSub);
      toast('已导出 PNG');
    } catch (e) {
      toast('导出失败：' + (e && e.message || e));
    }
  }

  /* ================= 错题与复盘 ================= */
  function mistakeItems() {
    return DB.items.filter(function (x) { return x.lapses > 0 || statusOf(x) === 'bad'; })
      .sort(function (a, b) { return a.due < b.due ? -1 : 1; });
  }
  function renderReview() {
    var m = mistakeItems();
    var h = '<div class="grid2"><div>';
    h += '<div class="card"><h2>错题本 <em>共 ' + m.length + ' 道</em></h2>';
    h += m.length ? m.slice(0, 40).map(function (x) {
      var note = qmeta(x.id).note;
      return '<div class="mrow"><div class="no-b">' + clamp(x.lapses, 1, 99) + '</div>' +
        '<div class="t">' + esc(x.stem) + '<span>' + esc(x.subject) + ' · ' + esc(x.ch) + (note ? ' · 📝' : '') + '</span></div>' +
        '<div class="m">错 ' + x.lapses + ' 次<br>间隔 ' + x.interval + ' 天</div>' +
        '<button class="btn mini ghost" data-retry="' + x.id + '">重练</button></div>';
    }).join('') : '<div class="muted">错题本空着——好事。</div>';
    h += '<div style="margin-top:9px"><button class="btn" data-act="mist-all" ' + (m.length ? '' : 'disabled') + '>把错题练一遍（' + Math.min(m.length, 10) + ' 题）</button></div></div>';
    h += '<div class="card"><h2>疑点复核 <em>自动判分存疑的题，人工裁决</em></h2>';
    h += DB.doubts.length ? DB.doubts.map(function (d, idx) {
      var it = byId(d.id);
      if (!it) return '';
      return '<div class="mrow"><div class="t">' + esc(it.stem) + '<span>' + esc(d.why) + ' · ' + esc(d.at) + '</span></div>' +
        '<button class="btn mini ghost" data-dok="' + idx + '">真会</button>' +
        '<button class="btn mini" data-dno="' + idx + '">真不会</button></div>';
    }).join('') : '<div class="muted">没有待裁决的疑点。做题时点「存疑复核」会把题放到这里。</div>';
    h += '</div></div>';
    /* 周复盘 */
    var week = [], i;
    for (i = 6; i >= 0; i--) { var k = addDays(TODAY, -i); var l = DB.logs[k]; if (l) week.push(l); }
    var wn = week.reduce(function (a, x) { return a + x.n; }, 0);
    var wok = week.reduce(function (a, x) { return a + x.ok; }, 0);
    var wmin = week.reduce(function (a, x) { return a + x.min; }, 0);
    var bySub = {};
    DB.items.forEach(function (x) { if (statusOf(x) === 'bad') bySub[x.subject] = (bySub[x.subject] || 0) + 1; });
    var hotSub = Object.keys(bySub).sort(function (a, b) { return bySub[b] - bySub[a]; })[0];
    h += '<div><div class="card"><h2>近 7 天复盘</h2>' +
      '<div style="font-size:12.5px;line-height:2">' +
      '· 完成 <b>' + wn + '</b> 题，正确率 <b>' + (wn ? Math.round(wok / wn * 100) + '%' : '—') + '</b><br>' +
      '· 番茄专注 <b>' + wmin + '</b> 分钟<br>' +
      (hotSub ? '· 错题集中在 <b>' + esc(hotSub) + '</b>（' + bySub[hotSub] + ' 道）—— 优先攻克<br>' : '· 暂无错题集中区<br>') +
      '· 连续学习 <b>' + streak() + '</b> 天</div>' +
      '<div style="margin-top:9px"><button class="btn ghost" data-act="rev-csv">导出复盘 CSV</button></div></div>';
    h += '<div class="card"><h2>带笔记的题</h2>';
    var noted = Object.keys(DB.qmeta).filter(function (id) { return DB.qmeta[id].note && byId(id); });
    h += noted.length ? noted.slice(0, 12).map(function (id) {
      var it = byId(id);
      return '<div class="noterow"><b>' + esc(it.stem) + '</b><div style="color:var(--ink2);margin-top:3px">' + esc(DB.qmeta[id].note) + '</div></div>';
    }).join('') : '<div class="muted">做题时用 📝 笔记按钮，记录会出现在这里。</div>';
    h += '</div></div></div>';
    $('#s-review').innerHTML = h;
    $$('[data-retry]').forEach(function (b) { b.onclick = function () {
      var it = byId(b.dataset.retry);
      if (it) startRun([it], '错题重练');
    }; });
    var ma = $('[data-act="mist-all"]');
    if (ma) ma.onclick = function () { startRun(m.slice(0, 10), '错题重练 · ' + Math.min(m.length, 10) + ' 题', Math.min(m.length, 10)); };
    $$('[data-dok]').forEach(function (b) { b.onclick = function () {
      var d = DB.doubts.splice(+b.dataset.dok, 1)[0];
      var it = byId(d.id);
      if (it) { schedule(it, 4); }
      save(); renderReview(); toast('已确认掌握，重排完成');
    }; });
    $$('[data-dno]').forEach(function (b) { b.onclick = function () {
      var d = DB.doubts.splice(+b.dataset.dno, 1)[0];
      var it = byId(d.id);
      if (it) { schedule(it, 1); }
      save(); renderReview(); toast('已判不会，明天到期');
    }; });
    var rc = $('[data-act="rev-csv"]');
    if (rc) rc.onclick = downloadCSV;
  }

  /* ================= 我的 ================= */
  function last14() {
    var rows = [];
    for (var i = 13; i >= 0; i--) {
      var k = addDays(TODAY, -i);
      var l = DB.logs[k] || { n: 0, ok: 0, min: 0 };
      var cks = DB.ckitems.map(function (c) { return (DB.checkin[k] && DB.checkin[k][c.id]) || 0; });
      rows.push({ day: k, l: l, cks: cks });
    }
    return rows;
  }
  function renderMine() {
    var rows = last14();
    var h = '<div class="grid2"><div>';
    h += '<div class="card"><h2>学习明细 <em>近 14 天 · Excel 模式</em></h2><div style="overflow-x:auto">' +
      '<table class="dt"><tr><th>日期</th><th>做题</th><th>对</th><th>专注(分)</th>' +
      DB.ckitems.map(function (c) { return '<th>' + esc(c.name.slice(0, 6)) + '</th>'; }).join('') + '</tr>' +
      rows.map(function (r) {
        return '<tr><td>' + r.day.slice(5) + '</td><td>' + r.l.n + '</td><td>' + r.l.ok + '</td><td>' + r.l.min + '</td>' +
          r.cks.map(function (v) { return '<td>' + v + '</td>'; }).join('') + '</tr>';
      }).join('') + '</table></div>' +
      '<div style="margin-top:10px"><button class="btn ghost" data-act="csv">导出 CSV（Excel 可直接打开）</button></div></div>';
    h += '</div><div>';
    h += '<div class="card"><h2>设置</h2>' +
      '<div class="setrow"><span class="k">日报邮箱</span><input id="set-mail" type="email" value="' + esc(DB.settings.email) + '" placeholder="you@example.com"><button class="mini" data-act="set-mail">保存</button></div>' +
      '<div class="setrow"><span class="k">番茄时长</span><select id="set-pomo" style="width:90px">' + [15, 20, 25, 30, 45, 50].map(function (m) { return '<option' + (DB.settings.pomoLen === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select><span class="muted">分钟</span></div>' +
      '<div class="setrow"><span class="k">排程算法</span><select id="set-sched" style="width:110px"><option value="fsrs"' + (DB.profile.scheduler === 'fsrs' ? ' selected' : '') + '>FSRS</option><option value="sm2"' + (DB.profile.scheduler === 'sm2' ? ' selected' : '') + '>SM-2</option></select><span class="muted">间隔由作答质量决定</span></div>' +
      '<div class="setrow"><span class="k">初试日期</span><input id="set-exam" type="date" value="' + esc(DB.profile.examDate) + '"><button class="mini" data-act="set-exam">保存</button></div>' +
      '</div>';
    h += '<div class="card"><h2>知识库容量</h2>';
    var parts = (DB.catalog && DB.catalog.subjects) || [];
    SUBJECTS.forEach(function (s) {
      var n = partItems(s).length;
      h += '<div class="rowline"><span>' + esc(s) + '</span><b>' + n + ' 题' + (n ? '' : ' · 暂无题目') + '</b></div>';
    });
    h += '<div class="muted" style="margin-top:7px">题目随初始题库一起预置；笔记与概念卡在「学习」里手动新增。</div></div>';
    h += '<div class="card"><h2>数据备份</h2>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn ghost" data-act="backup">导出全部数据 JSON</button>' +
      '<button class="mini" data-act="restore">导入备份</button>' +
      '<input type="file" id="restore-file" accept=".json" style="display:none"></div>' +
      '<div class="muted" style="margin-top:6px">数据存于本机浏览器 localStorage；换设备或清理浏览器前请先导出。</div></div>';
    h += renderPushCard();
    h += renderRewardsCard();
    h += '</div></div>';
    $('#s-mine').innerHTML = h;
    /* 奖励留言：增删 */
    /* 打卡推送设置 */
    (function () {
      var ks = $('#push-kind');
      if (ks) ks.onchange = function () {
        var c = pushCfg();
        c.kind = ks.value;
        saveNow(); renderMine();
      };
      var us = $('#push-url');
      if (us) us.onchange = function () { pushCfg().url = us.value.trim(); saveNow(); };
      var ts = $('#push-token');
      if (ts) ts.onchange = function () { pushCfg().token = ts.value.trim(); saveNow(); };
    })();
    $$('[data-act="push-toggle"]').forEach(function (b) { b.onclick = function () {
      var c = pushCfg();
      if (!c.on && !pushReady()) {
        /* 未开启时先检查配置是否完整 */
        if (c.kind === 'off') { toast('先选一个通道'); return; }
        if (c.kind === 'pushplus' && !c.token) { toast('先填 token'); return; }
        if (c.kind !== 'pushplus' && !c.url) { toast('先填 webhook 地址'); return; }
      }
      c.on = c.on ? 0 : 1;
      saveNow(); renderMine();
      toast(c.on ? '推送已开启' : '推送已关闭');
    }; });
    $$('[data-act="push-test"]').forEach(function (b) { b.onclick = testPush; });

    $$('[data-act="rwm-add"]').forEach(function (b) { b.onclick = function () {
      var el = $('#rwm-in');
      var v = el ? el.value.trim() : '';
      if (!v) { toast('先写一句'); return; }
      if (!DB.rewards) DB.rewards = { seen: {}, msgs: [] };
      if (!DB.rewards.msgs) DB.rewards.msgs = [];
      DB.rewards.msgs.push(v.slice(0, 160));
      HQ.idx = DB.rewards.msgs.length - 1;   /* 首页立刻显示刚写的这条 */
      saveNow(); renderMine(); toast('已写下。首页右侧会看到它。');
    }; });
    $$('[data-rwm-del]').forEach(function (b) { b.onclick = function () {
      var i = +b.dataset.rwmDel;
      if (!DB.rewards || !DB.rewards.msgs) return;
      DB.rewards.msgs.splice(i, 1);
      saveNow(); renderMine();
    }; });

    $$('[data-act="set-mail"]').forEach(function (b) { b.onclick = function () {
      var v = $('#set-mail').value.trim();
      if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast('邮箱格式不对'); return; }
      DB.settings.email = v; saveNow(); toast('已保存日报邮箱'); render();
    }; });
    $('#set-pomo').onchange = function () { DB.settings.pomoLen = +this.value || 25; save(); pLeft = DB.settings.pomoLen * 60; toast('已保存'); };
    $('#set-sched').onchange = function () { DB.profile.scheduler = this.value; save(); toast('已切换为 ' + (this.value === 'fsrs' ? 'FSRS' : 'SM-2')); };
    $$('[data-act="set-exam"]').forEach(function (b) { b.onclick = function () {
      var nv = $('#set-exam').value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nv || '')) { toast('日期格式不对'); return; }
      DB.profile.examDate = nv;
      DB.profile.examEdited = 1;      /* 标记「用户已手改」，此后不再被计划表覆盖 */
      saveNow(); render(); toast('已保存初试日期，倒计时同步更新');
    }; });
    $$('[data-act="csv"]').forEach(function (b) { b.onclick = downloadCSV; });
    $$('[data-act="backup"]').forEach(function (b) { b.onclick = function () {
      var blob = new Blob([JSON.stringify(DB)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'k312_backup_' + TODAY + '.json';
      a.click(); URL.revokeObjectURL(a.href);
      toast('已导出备份');
    }; });
    $$('[data-act="restore"]').forEach(function (b) { b.onclick = function () { $('#restore-file').click(); }; });
    $('#restore-file').onchange = function () {
      var f = this.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var raw = JSON.parse(String(rd.result));
          DB = normalize(raw);
          saveNow(); render(); toast('备份已恢复');
        } catch (e) { toast('备份文件无效'); }
      };
      rd.readAsText(f, 'utf-8');
      this.value = '';
    };
  }
  function downloadCSV() {
    var rows = last14();
    var head = ['日期', '做题', '答对', '专注(分钟)'].concat(DB.ckitems.map(function (c) { return c.name; }));
    var lines = [head.join(',')].concat(rows.map(function (r) {
      return [r.day, r.l.n, r.l.ok, r.l.min].concat(r.cks).join(',');
    }));
    var blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'k312_学习明细_' + TODAY + '.csv';
    a.click(); URL.revokeObjectURL(a.href);
    toast('已导出 CSV');
  }

  /* ================= 顶级行为绑定 ================= */
  $$('nav.top button').forEach(function (b) { b.onclick = function () { go(b.dataset.scr); }; });
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.dataset.act;
    if (act === 'ck-add') { $('#ckform').style.display = 'block'; $('#ckf-name').focus(); }
    else if (act === 'ckf-cancel') $('#ckform').style.display = 'none';
    else if (act === 'ckf-ok') {
      var nm = $('#ckf-name').value.trim();
      if (!nm) { toast('请填写项目名'); return; }
      DB.ckitems.push({ id: uid(), name: nm, goal: Math.max(1, +$('#ckf-goal').value || 1), unit: $('#ckf-unit').value });
      $('#ckf-name').value = ''; $('#ckf-goal').value = '';
      $('#ckform').style.display = 'none';
      saveNow(); renderHome(); toast('新增打卡项：' + nm);
    }
    else if (act === 'ck-template') {
      var box = $('#cktpl');
      if (box.style.display === 'block') { box.style.display = 'none'; return; }
      box.style.display = 'block';
      box.innerHTML = '<div class="muted" style="margin-bottom:5px">勾选要加入打卡的计划项：</div>' +
        PLAN_TPL.map(function (p, i) {
          return '<label style="display:flex;gap:7px;align-items:center;font-size:12.5px;padding:3px 0"><input type="checkbox" data-pk="' + i + '" style="width:auto"> ' + esc(p.name) + '（' + p.goal + ' ' + p.unit + '）</label>';
        }).join('') + '<button class="btn mini" data-act="pk-ok" style="margin-top:6px">生成打卡项</button>';
      $$('[data-act="pk-ok"]').forEach(function (b) { b.onclick = function () {
        var added = 0;
        $$('[data-pk]').forEach(function (cb) {
          if (!cb.checked) return;
          var p = PLAN_TPL[+cb.dataset.pk];
          if (!DB.ckitems.some(function (c) { return c.name === p.name; })) { DB.ckitems.push({ id: uid(), name: p.name, goal: p.goal, unit: p.unit }); added++; }
        });
        saveNow(); box.style.display = 'none'; renderHome();
        toast(added ? '已生成 ' + added + ' 个打卡项' : '（重复项已跳过）');
      }; });
    }
    else if (act === 'todo-due') {
      var due = DB.items.filter(function (x) { return x.reps > 0 && x.due <= TODAY && x.type !== 'essay'; });
      startRun(due, '今日到期');
    }
    else if (act === 'todo-wrong') go('review');
    else if (act === 'mail-export') exportCheckin();
    else if (act === 'mail-copy') copyCheckin();
    else if (act === 'mail-send') sendMail();
  });

  /* init */
  go('home');
  window.addEventListener('beforeunload', saveNow);
  /* ---------- 自测入口 ----------
     历史问题：selftest.js 从 index.html 里没有任何引用，`?selftest=1` 说法是假的，
     文件成了死代码，44 项断言长期无人执行、静默腐烂。
     这里补上真实入口：带 ?selftest=1 访问时动态注入（同源，不需要放宽 CSP）。 */
  if (typeof location !== 'undefined' && /[?&]selftest=1/.test(location.search)) {
    var _st = document.createElement('script');
    _st.src = 'selftest.js';
    _st.onerror = function () { document.title = 'RESULT :: FAIL 自测脚本加载失败'; };
    document.body.appendChild(_st);
  }

  /* 未捕获异常：不再完全静默。首次致命错误给用户一个可见提示，
     否则界面空白、用户不知道发生了什么（历史上排查过很久）。 */
  var _errShown = 0;
  window.onerror = function (m) {
    console.error(m);
    if (_errShown) return;
    _errShown = 1;
    try { toast('页面出错：' + String(m).slice(0, 60) + '（F12 查看详情）'); } catch (e) { }
  };
})();
