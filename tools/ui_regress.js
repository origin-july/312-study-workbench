/* UI 逻辑回归：打卡下拉、首页右侧倒计时/留言、examDate 单一真相源、留言板语义。
   自己从 app.js 抽取目标函数，不依赖中间产物。 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');

function grab(name) {
  const i = SRC.indexOf('  function ' + name + '(');
  if (i < 0) throw new Error('找不到函数 ' + name);
  const j = SRC.indexOf('{', i);
  let d = 0;
  for (let k = j; k < SRC.length; k++) {
    if (SRC[k] === '{') d++;
    else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); }
  }
  throw new Error('括号不平衡 ' + name);
}

const FUNCS = ['ckSteps', 'ckSelectHtml', 'renderCKList', 'selfMsgs', 'heroQuote', 'heroSideHtml', 'renderRewardsCard', 'planExam'];
const code = FUNCS.map(grab).join('\n');

const store = {};
const mk = id => ({ id, innerHTML: '', style: {}, value: '', dataset: {}, focus() {}, onclick: null, onchange: null, addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} }, querySelector() { return null; } });
store['#cklist'] = mk('#cklist');
const $ = s => store[s] || null;
const $$ = () => [];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = () => {}, save = () => {}, saveNow = () => {}, renderMail = () => {};
const TODAY = '2026-10-28';
const HQ = { idx: -1, timer: null };
const PLAN = JSON.parse(fs.readFileSync(path.join(WEB, 'plan.json'), 'utf8'));
const EXAM = '2027-12-25';
const DB = {
  ckitems: [
    { id: 'ck1', name: '不背单词 App', goal: 60, unit: '个' },
    { id: 'ck2', name: '词书', goal: 1, unit: '节' },
    { id: 'ck3', name: '网课', goal: 30, unit: '分钟' },
    { id: 'ck4', name: '课本', goal: 10, unit: '页' },
    { id: 'ck5', name: '专注时长', goal: 50, unit: '分钟', lock: 1 }
  ],
  checkin: {}, rewards: { msgs: ['第一句', '第二句', '第三句'] }, profile: { examDate: '2027-12-25' }
};
const ckToday = () => { if (!DB.checkin[TODAY]) DB.checkin[TODAY] = {}; return DB.checkin[TODAY]; };
const ckHit = c => ((ckToday()[c.id] || 0) >= c.goal);

const F = new Function('$', '$$', 'esc', 'toast', 'save', 'saveNow', 'renderMail', 'TODAY', 'HQ', 'DB', 'ckToday', 'ckHit', 'PLAN', 'EXAM',
  code + '\nreturn {ckSteps,ckSelectHtml,renderCKList,heroQuote,heroSideHtml,renderRewardsCard,planExam};')
  ($, $$, esc, toast, save, saveNow, renderMail, TODAY, HQ, DB, ckToday, ckHit, PLAN, EXAM);

let pass = 0, fail = 0;
const chk = (n, c, e) => { if (c) { pass++; } else { fail++; console.log('  FAIL ' + n + (e ? '  ' + e : '')); } };

/* 打卡下拉 */
chk('分钟按30一格', JSON.stringify(F.ckSteps({ goal: 30, unit: '分钟' })) === '[0,30,60,90]');
chk('60个→步长10', F.ckSteps({ goal: 60, unit: '个' }).length === 13);
chk('1节→步长1', JSON.stringify(F.ckSteps({ goal: 1, unit: '节' })) === '[0,1,2,3]');
chk('10页→步长2', JSON.stringify(F.ckSteps({ goal: 10, unit: '页' })) === '[0,2,4,6,8,10,12,14,16,18,20]');
chk('每档含 goal', [[30, '分钟'], [60, '个'], [1, '节'], [10, '页'], [50, '题']].every(([g, u]) => F.ckSteps({ goal: g, unit: u }).includes(g)));

F.renderCKList();
const L = $('#cklist').innerHTML;
chk('打卡行无 number 输入框', !L.includes('type="number"'));
chk('4 个下拉（lock 除外）', (L.match(/<select/g) || []).length === 4);
chk('5 行打卡项', (L.match(/class="ckrow/g) || []).length === 5);
chk('有进度条', L.includes('class="ckbar"'));
chk('lock 项显示数值', L.includes('cklock'));

/* 首页右侧 */
const side = F.heroSideHtml();
chk('heroSide 不抛异常且非空', side.length > 300, side.length);
chk('倒计时四格', ['cd-d', 'cd-h', 'cd-m', 'cd-s'].every(x => side.includes('id="' + x + '"')));
chk('标题取年份', side.includes('距 2027 考研初试'));
chk('留言来自池子', ['第一句', '第二句', '第三句'].some(m => side.includes(m)));

/* examDate 单一真相源 */
chk('默认跟随 profile', F.planExam().target === '2027-12-25');
DB.profile.examDate = '2027-12-20';
chk('改后 planExam 同步', F.planExam().target === '2027-12-20');
chk('heroSide 也跟随', F.heroSideHtml().includes('距 2027 考研初试'));

/* 留言板语义 */
const rc = F.renderRewardsCard();
chk('标题为「自己的留言板」', rc.includes('自己的留言板'));
chk('不再出现「别人写给你」', !rc.includes('别人写给你'));

console.log('ui_regress: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
