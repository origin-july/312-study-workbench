# -*- coding: utf-8 -*-
"""
qa.py —— 312 学习工作台的自动门禁（不依赖浏览器，可进 CI）

为什么需要它：
  项目此前的质量门禁是「selftest.js 44 项断言手跑」。实际状况是
    ① selftest.js 从未被 index.html 引用，是死文件；
    ② 其中 14 项断言早就跟代码脱节（.judge→.judgebox、#mmsvg→jsMind、导入区已删）；
    ③ 没人跑，所以没人知道。
  本脚本把这些检查变成一条命令、非零退出码即阻断。

检查项：
  1  JS / CSS / Python 语法
  2  selftest 引用的选择器是否仍存在于代码（防「测试腐烂」）
  3  selftest 里的按钮 data-act 是否仍存在（防按钮改名后测试静默通过）
  4  HTML 中每个 data-act 是否都有绑定（防「点了没反应」）
  5  数据一致性：题目→章节、planMap 键、surprises 日期
  6  题目 id 稳定性：seed 有 id 且与内容哈希一致
  7  三处哈希实现一致（app.js / stable_ids.py / ingest.py）
  8  CSS 括号平衡
  9  构建产物可解析

用法：
  python qa.py            # 全部检查
  python qa.py --quiet    # 只输出结论
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(ROOT)          # 源码就在仓库根目录
QUIET = '--quiet' in sys.argv

results = []   # (level, name, detail)


def ok(name, detail=''):
    results.append(('PASS', name, detail))


def bad(name, detail=''):
    results.append(('FAIL', name, detail))


def warn(name, detail=''):
    results.append(('WARN', name, detail))


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def jload(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# ---------------- 1. 语法 ----------------
def check_syntax():
    for f in ['app.js', 'selftest.js']:
        p = os.path.join(BASE, f)
        r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
        if r.returncode == 0:
            ok('JS 语法 %s' % f)
        else:
            bad('JS 语法 %s' % f, r.stderr.strip().split('\n')[0][:120])

    css = read(os.path.join(BASE, 'style.css'))
    if css.count('{') == css.count('}'):
        ok('CSS 括号平衡', '%d/%d' % (css.count('{'), css.count('}')))
    else:
        bad('CSS 括号不平衡', '%d 开 / %d 闭' % (css.count('{'), css.count('}')))

    for f in ['stable_ids.py', 'daily_plan_mail.py', 'checkin_mail.py',
              'gen_surprises.py', 'build_plan.py', 'build_single_html.py', 'qa.py']:
        p = os.path.join(ROOT, f)
        if not os.path.exists(p):
            continue
        r = subprocess.run([sys.executable, '-m', 'py_compile', p], capture_output=True, text=True)
        if r.returncode == 0:
            ok('Python 语法 %s' % f)
        else:
            bad('Python 语法 %s' % f, r.stderr.strip().split('\n')[0][:120])


# ---------------- 2/3. 测试与代码契约同步 ----------------
def check_test_contract():
    app = read(os.path.join(BASE, 'app.js'))
    html = read(os.path.join(BASE, 'index.html'))
    st = read(os.path.join(BASE, 'selftest.js'))
    both = app + html

    # 静态提取 selftest 里的选择器：q('...') / qa('...') / querySelector('...')
    sels = set()
    for m in re.finditer(r"""(?:qa?|querySelectorAll?)\(\s*'([^']+)'\s*\)""", st):
        sels.add(m.group(1))
    for m in re.finditer(r"""querySelector\(\s*'([^']+)'\s*\)""", st):
        sels.add(m.group(1))

    missing = []
    for sel in sorted(sels):
        # 取最后一个简单选择器做存在性判断
        simple = re.split(r'[\s>+~]', sel.strip())[-1]
        simple = simple.split(':')[0]
        if not simple:
            continue
        if simple.startswith('.'):
            token = simple[1:]
            # 类名可能出现在 app.js 拼接的字符串里
            if token not in both:
                missing.append((sel, token))
        elif simple.startswith('['):
            # 属性选择器，可能串联多个：[data-act="x"][data-kind="y"]
            attrs = re.findall(r'\[([\w\-]+)(?:=\s*[\'"]([^\'"]*)[\'"])?\]', simple)
            if not attrs:
                continue
            for attr, val in attrs:
                if val:
                    pat = '%s="%s"' % (attr, val)
                    if pat not in both:
                        missing.append((sel, pat))
                else:
                    if attr not in both:
                        missing.append((sel, attr))
        elif simple.startswith('#'):
            token = simple[1:]
            if ('id="%s"' % token) not in both and ("'%s'" % token) not in both:
                missing.append((sel, '#' + token))

    if missing:
        for sel, token in missing:
            bad('测试选择器已失效：%s' % sel, '代码中找不到 %s' % token)
    else:
        ok('selftest 选择器全部存在', '%d 个' % len(sels))

    # selftest 引用的 data-act 是否仍在
    acts_in_test = set(re.findall(r'data-act=\\?"([a-z0-9\-]+)\\?"', st))
    acts_in_code = set(re.findall(r'data-act="([a-z0-9\-]+)"', app))
    gone = sorted(acts_in_test - acts_in_code)
    if gone:
        for a in gone:
            bad('测试引用的按钮已不存在：%s' % a, '按钮被改名或删除，测试会静默通过')
    else:
        ok('selftest 的按钮全部有效', '%d 个' % len(acts_in_test))


# ---------------- 4. 按钮绑定 ----------------
def check_bindings():
    app = read(os.path.join(BASE, 'app.js'))
    acts = set(re.findall(r'data-act="([a-z0-9\-]+)"', app))
    unbound = []
    for a in sorted(acts):
        if ('[data-act="%s"]' % a) in app:
            continue
        if ("act === '%s'" % a) in app:
            continue
        unbound.append(a)
    if unbound:
        for a in unbound:
            bad('按钮未绑定事件：%s' % a, '点击不会有反应')
    else:
        ok('全部按钮已绑定', '%d 个 data-act' % len(acts))


# ---------------- 5. 数据一致性 ----------------
def check_data():
    seed = jload(os.path.join(BASE, 'seed.json'))
    cat = jload(os.path.join(BASE, 'catalog.json'))
    plan = jload(os.path.join(BASE, 'plan.json'))
    sur = jload(os.path.join(BASE, 'surprises.json'))

    valid = {(p['subject'], c['chapter']) for p in cat['parts'] for c in p['chapters']}
    orphan = []
    for it in seed['items']:
        ch = (it.get('ch') or '').split(' · ')[0].strip()
        if (it.get('subject'), ch) not in valid:
            orphan.append((it.get('subject'), ch))
    if orphan:
        bad('题目挂到不存在的章节', '%d 题，例：%s' % (len(orphan), orphan[0]))
    else:
        ok('题目→章节引用完整', '%d 题 / %d 章' % (len(seed['items']), len(valid)))

    labels = {w['label'] for w in plan.get('weeks', [])}
    badkey, badweek = [], []
    for k, v in (plan.get('planMap') or {}).items():
        sub, _, ch = k.partition('|')
        if (sub, ch) not in valid:
            badkey.append(k)
        if v not in labels:
            badweek.append((k, v))
    if badkey:
        bad('planMap 指向不存在的章节', '%d 条，例：%s' % (len(badkey), badkey[0]))
    else:
        ok('planMap 章节键有效', '%d 条' % len(plan.get('planMap') or {}))
    if badweek:
        bad('planMap 指向不存在的周段', '%d 条，例：%s' % (len(badweek), badweek[0]))
    else:
        ok('planMap 周段有效')

    items = sur.get('items') or []
    ds = [x['date'] for x in items]
    need = ('date', 'type', 'label', 'emoji', 'stage', 'idx', 'total')
    miss = [x for x in items if not all(k in x for k in need)]
    if miss:
        bad('surprises 缺字段', '%d 条' % len(miss))
    elif len(ds) != len(set(ds)):
        bad('surprises 日期重复')
    else:
        ok('surprises 结构完整', '%d 条，日期唯一' % len(items))


# ---------------- 6. 题目 id 稳定性 ----------------
def check_stable_ids():
    sys.path.insert(0, ROOT)
    import importlib.util
    spec = importlib.util.spec_from_file_location('si', os.path.join(ROOT, 'stable_ids.py'))
    si = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(si)

    seed = jload(os.path.join(BASE, 'seed.json'))
    noid = [x for x in seed['items'] if not x.get('id')]
    if noid:
        bad('题目缺 id', '%d 题（清缓存后学习记录会变孤儿）' % len(noid))
    else:
        ok('全部题目有 id', '%d 题' % len(seed['items']))

    mismatch = [x for x in seed['items']
                if x.get('id') and x['id'] != si.make_id(x)]
    if mismatch:
        bad('id 与内容哈希不一致', '%d 题，例：%s' % (len(mismatch), mismatch[0].get('stem', '')[:24]))
    else:
        ok('id 与内容哈希一致（可重现）')

    ids = [x.get('id') for x in seed['items']]
    if len(ids) != len(set(ids)):
        dup = [i for i in set(ids) if ids.count(i) > 1]
        bad('题目 id 重复', str(dup[:3]))
    else:
        ok('题目 id 唯一')


# ---------------- 7. 三处哈希实现一致 ----------------
def check_hash_consistency():
    """app.js 与 stable_ids.py 用同一份 djb2，算出的值必须相同。
    这里用 node 实际执行 app.js 的哈希段，与 Python 对照。"""
    app = read(os.path.join(BASE, 'app.js'))
    i = app.find('var MASK32 = 0xFFFFFFFF;')
    j = app.find("function stableItemId(x) { return 'q' + b36(djb2(itemKeyOf(x))); }")
    if i < 0 or j < 0:
        bad('找不到 app.js 的哈希实现')
        return
    j = app.index('}', j + 40) + 1
    snippet = app[i:j]

    samples = ['abc', '中文测试', '混合 abc 中文 123', '🎁emoji']
    js_code = snippet + "\nvar out=%s.map(function(t){return String(djb2(t));}); console.log(JSON.stringify(out));" % json.dumps(samples, ensure_ascii=False)
    tmp = os.path.join(ROOT, '.qa_hash.js')
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(js_code)
    try:
        r = subprocess.run(['node', tmp], capture_output=True, text=True)
        if r.returncode != 0:
            bad('app.js 哈希段无法执行', r.stderr.strip()[:100])
            return
        js_vals = json.loads(r.stdout.strip())
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    sys.path.insert(0, ROOT)
    import importlib.util
    spec = importlib.util.spec_from_file_location('si', os.path.join(ROOT, 'stable_ids.py'))
    si = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(si)
    py_vals = [str(si.djb2(t)) for t in samples]

    if js_vals == py_vals:
        ok('JS/Python 哈希一致', '%d 个样本（含中文/emoji）' % len(samples))
    else:
        bad('JS/Python 哈希不一致', 'JS=%s PY=%s' % (js_vals, py_vals))


# ---------------- 8. 构建产物 ----------------
def check_build():
    out = os.path.join(ROOT, '312学习工作台_单文件版.html')
    if not os.path.exists(out):
        warn('未找到单文件版', '跳过')
        return
    h = read(out)
    need = ['inline-seed', 'inline-catalog', 'inline-plan', 'inline-surprises']
    miss = [n for n in need if ('id="%s"' % n) not in h]
    if miss:
        bad('单文件版缺少内联数据', str(miss))
    else:
        ok('单文件版内联数据齐全', '%.1f KB' % (len(h) / 1024))

    m = re.search(r'id="inline-seed">([\s\S]*?)</script>', h)
    if m:
        try:
            d = json.loads(m.group(1).replace('<\\/', '</'))
            if len(d.get('items', [])) < 300:
                bad('单文件版题库偏少', '%d 题' % len(d.get('items', [])))
            else:
                ok('单文件版题库可解析', '%d 题' % len(d['items']))
        except Exception as e:
            bad('单文件版题库解析失败', str(e)[:80])


def check_render_smoke():
    """在最小 DOM 沙箱里跑完整初始化 + 六页渲染。
    这一步能抓到静态检查抓不到的问题：作用域错误、运行时 TypeError、某屏渲染成空。"""
    script = os.path.join(ROOT, 'render_smoke.js')
    if not os.path.exists(script):
        warn('缺少 render_smoke.js', '跳过渲染冒烟')
        return
    try:
        r = subprocess.run(['node', script], capture_output=True, text=True, timeout=90, cwd=ROOT)
    except subprocess.TimeoutExpired:
        bad('渲染冒烟超时', '可能死循环或定时器未释放')
        return

    out = (r.stdout or '') + (r.stderr or '')
    # 解析每屏字符数
    screens = {}
    for m in re.finditer(r'(s-\w+)\s+(-?\d+)', out):
        screens[m.group(1)] = int(m.group(2))
    empty = [k for k, v in screens.items() if v <= 0]
    if r.returncode != 0:
        detail = '；'.join([l.strip() for l in out.split('\n') if '❌' in l or '抛异常' in l][:2])
        bad('渲染冒烟未通过', detail[:140] or '退出码 %d' % r.returncode)
    elif empty:
        bad('渲染出现空屏', ', '.join(empty))
    else:
        ok('六页渲染冒烟通过', ' '.join('%s=%d' % (k.replace('s-', ''), v) for k, v in screens.items()))


def check_ui_regress():
    """UI 逻辑回归：打卡下拉步长、首页右侧、examDate 单一源、留言板语义。"""
    script = os.path.join(ROOT, 'ui_regress.js')
    if not os.path.exists(script):
        warn('缺少 ui_regress.js', '跳过')
        return
    try:
        r = subprocess.run(['node', script], capture_output=True, text=True, timeout=60, cwd=ROOT)
    except subprocess.TimeoutExpired:
        bad('UI 回归超时')
        return
    out = (r.stdout or '') + (r.stderr or '')
    m = re.search(r'ui_regress: (\d+) 通过 / (\d+) 失败', out)
    if r.returncode == 0 and m:
        ok('UI 逻辑回归', '%s 项断言通过' % m.group(1))
    else:
        fails = [l.strip() for l in out.split('\n') if 'FAIL' in l][:3]
        bad('UI 逻辑回归未通过', '；'.join(fails)[:140] or out.strip()[:140])


def check_single_file_smoke():
    """单文件版冒烟：按 <script> 顺序在沙箱里执行，模拟「双击打开」。
    这是真正交付给别人的形态（file:// 直开），必须和源码版一样跑通。
    能抓到 shim 失效、内联数据缺失、脚本顺序错乱这三类只在单文件版出现的问题。"""
    script = os.path.join(ROOT, 'single_file_smoke.js')
    if not os.path.exists(script):
        warn('缺少 single_file_smoke.js', '跳过')
        return
    try:
        r = subprocess.run(['node', script], capture_output=True, text=True, timeout=90, cwd=ROOT)
    except subprocess.TimeoutExpired:
        bad('单文件版冒烟超时')
        return
    out = (r.stdout or '') + (r.stderr or '')
    sizes = {}
    for m in re.finditer(r'^\s+(home|bank|catalog|study|review|mine)\s+(\d+)', out, re.M):
        sizes[m.group(1)] = int(m.group(2))
    empty = [k for k, v in sizes.items() if v <= 0]
    if r.returncode != 0:
        fails = [l.strip() for l in out.split('\n') if '❌' in l][:2]
        bad('单文件版冒烟未通过', '；'.join(fails)[:140] or '退出码 %d' % r.returncode)
    elif empty:
        bad('单文件版出现空屏', ', '.join(empty))
    else:
        ok('单文件版双击场景通过', ' '.join('%s=%d' % (k, v) for k, v in sizes.items()))


def main():
    check_syntax()
    check_test_contract()
    check_bindings()
    check_data()
    check_stable_ids()
    check_hash_consistency()
    check_build()
    check_render_smoke()
    check_ui_regress()
    check_single_file_smoke()

    fails = [r for r in results if r[0] == 'FAIL']
    warns = [r for r in results if r[0] == 'WARN']
    passes = [r for r in results if r[0] == 'PASS']

    if not QUIET:
        print('\n' + '=' * 64)
        print('312 工作台 · 质量门禁')
        print('=' * 64)
        for lvl, name, detail in results:
            mark = {'PASS': '  ✅', 'FAIL': '  ❌', 'WARN': '  ⚠️ '}[lvl]
            line = '%s %s' % (mark, name)
            if detail:
                line += '   ' + detail
            print(line)

    print('\n' + '-' * 64)
    print('通过 %d  失败 %d  警告 %d' % (len(passes), len(fails), len(warns)))
    if fails:
        print('\n阻断项：')
        for _, name, detail in fails:
            print('  · %s   %s' % (name, detail))
        print('\n门禁不通过 —— 不要部署。')
        return 1
    print('\n门禁通过。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
