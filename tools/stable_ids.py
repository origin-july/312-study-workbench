# -*- coding: utf-8 -*-
"""
给 seed.json 的每道题写回稳定 id。

背景（缺陷）：seed.json 原本没有 id，app.js 的 normItem 用
`String(x.id || uid())` 兜底，而 uid() 是「时间戳 + 随机数」。
结果：localStorage 一旦清空/换浏览器/换设备，305 题全部重新分配随机 id，
而 qmeta（笔记、草稿）、answers（作答记录）都按 id 索引 —— 进度全部变孤儿，无法恢复。

方案：id 从内容派生（djb2 哈希），JS 与 Python 用同一算法，保证两边算出的值一致。
     id = 'q' + djb2(subject | ch | node | type | stem) 的 base36

幂等：已有合法 id 的题目保持不变。
"""
import json
import os
import sys

BASE = os.path.join('pkg', '312学习工作台_交付包_20261026', '02_网站webapp')
SEED = os.path.join(BASE, 'seed.json')

MASK = 0xFFFFFFFF
CJK_SAFE = True


def djb2(text):
    """djb2 变体：逐字符累加，32 位无符号截断。与 app.js 的 itemHash 一致。"""
    h = 5381
    for ch in text:
        h = ((h << 5) + h + ord(ch)) & MASK
    return h


def item_key(x):
    """参与哈希的字段。刻意不含 keys/src/points —— 那些可能被后续校订，
    改动不应导致 id 变化、进而丢失学习记录。"""
    parts = [
        str(x.get('subject') or ''),
        str(x.get('ch') or ''),
        str(x.get('node') or ''),
        str(x.get('type') or ''),
        str(x.get('stem') or ''),
    ]
    return '|'.join(parts)


def base36(n):
    if n == 0:
        return '0'
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    out = []
    while n:
        n, r = divmod(n, 36)
        out.append(digits[r])
    return ''.join(reversed(out))


def make_id(x):
    return 'q' + base36(djb2(item_key(x)))


def main():
    if not os.path.exists(SEED):
        print('找不到 seed.json：%s' % SEED, file=sys.stderr)
        return 1

    with open(SEED, encoding='utf-8') as f:
        data = json.load(f)

    items = data.get('items') or []
    if not items:
        print('seed.items 为空，终止', file=sys.stderr)
        return 1

    before = sum(1 for x in items if x.get('id'))
    seen = {}
    collisions = []
    assigned = 0
    already = 0

    for x in items:
        new_id = make_id(x)
        if x.get('id') == new_id:
            already += 1
        elif x.get('id') and not x.get('id', '').startswith('q'):
            # 旧的是随机 id，覆盖成稳定 id
            x['id'] = new_id
            assigned += 1
        else:
            if not x.get('id'):
                x['id'] = new_id
                assigned += 1

        if new_id in seen:
            collisions.append((new_id, seen[new_id], x.get('stem', '')[:34]))
        else:
            seen[new_id] = x.get('stem', '')[:34]

    data['items'] = items
    # 记录数据版本，方便以后迁移判断
    data['v'] = max(int(data.get('v') or 1), 4)

    with open(SEED, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))

    print('seed.json 已写回稳定 id')
    print('  题目总数      : %d' % len(items))
    print('  原本已有 id   : %d' % before)
    print('  本次写入/覆盖 : %d' % assigned)
    print('  已是最新      : %d' % already)
    print('  id 唯一数     : %d' % len(seen))
    if collisions:
        print('  ⚠ 哈希冲突 %d 组（同 subject/ch/node/type/stem，内容重复题）：' % len(collisions))
        for cid, s1, s2 in collisions[:8]:
            print('    %s  %s  ≈  %s' % (cid, s1, s2))
    else:
        print('  ✅ 无哈希冲突')

    # 抽样展示
    print('\n  样例:')
    for x in items[:3]:
        print('    %-10s %s' % (x['id'], x.get('stem', '')[:40]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
