#!/usr/bin/env python3
"""產生 lib/data/ 底下的資料檔。

用法：python3 tools/build-data.py [--src 原始資料資料夾]

原始資料（預設放在 tools/sources/）：
  moedict-data/dict-revised.json   教育部《重編國語辭典修訂本》 https://github.com/g0v/moedict-data
  OpenCC/data/dictionary/          OpenCC 繁簡對照表 https://github.com/BYVoid/OpenCC
  jieba-dict.txt.big               （選用）jieba 詞庫 https://github.com/fxsjy/jieba/tree/master/extra_dict
  wordfreq.pkl, charfreq.pkl       （選用）語料詞頻，用來挑常用成語和常用字
  moecharfreq.pkl                  （選用）辭典正文的字頻，用來分辨古文用字和簡體字

人工維護的清單：
  tools/curated.txt   錯字（錯字>正字）
  tools/exclude.txt   不算錯的寫法
  tools/sug.txt       只當建議的錯字
  lib/words.js        EQUIV：兩種寫法都通行的字（跟檢查器共用）

產生的檔案：
  lib/data/words.txt        詞表（斷詞檢查用）
  lib/data/idioms.txt       成語表
  lib/data/readings.json    每個字的注音
  lib/data/simplified.json  簡繁對照
  lib/data/typos.txt        錯字表
  tools/dropped.json        被排除的錯字和原因（給人看的）
"""
import argparse
import collections
import json
import os
import pickle
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'lib', 'data')
HAN = re.compile(r'^[㐀-鿿\U00020000-\U0002ffff]+$')

# 這幾組在台灣有明確的標準寫法，但兩種都很常見，只列成「建議」。
SUG_PAIRS = {frozenset(p) for p in ['份分', '裏裡', '划劃', '併並', '檯臺']}

# 在辭典正文裡常出現、但在台灣現代文章裡一定是錯的字，不管字頻都直接改。
ALWAYS_SIMPLIFIED = set('别户')


# ---------- 清單 ----------

def read_equiv():
    """lib/words.js 的 EQUIV：兩種寫法都通行的字。"""
    src = open(os.path.join(ROOT, 'lib', 'words.js'), encoding='utf-8').read()
    m = re.search(r'const EQUIV = list`(.*?)`', src, re.S)
    if not m:
        sys.exit('lib/words.js 裡找不到 EQUIV')
    equiv = {}
    for group in m.group(1).split():
        for a in group:
            for b in group:
                if a != b:
                    equiv.setdefault(a, set()).add(b)
    return equiv


EQUIV = read_equiv()


def diff_positions(a, b):
    return [i for i in range(len(a)) if a[i] != b[i]]


def only_equiv(a, b):
    """a 跟 b 只差在通行異體字。"""
    return all(b[i] in EQUIV.get(a[i], ()) for i in diff_positions(a, b))


def sug_pair(a, b):
    """a 跟 b 只差在 SUG_PAIRS 的字。"""
    return all(frozenset((a[i], b[i])) in SUG_PAIRS for i in diff_positions(a, b))


def read_list(name):
    """讀 tools/ 底下的清單。「錯>正」傳回 (錯, 正)，單獨的詞傳回 (詞, None)。# 後面是註解。"""
    pairs = []
    path = os.path.join(HERE, name)
    if not os.path.exists(path):
        return pairs
    for line in open(path, encoding='utf-8'):
        for tok in line.split('#', 1)[0].split():
            if '>' in tok:
                a, b = tok.split('>', 1)
                pairs.append((a, b))
            else:
                pairs.append((tok, None))
    return pairs


# ---------- 原始資料 ----------

def load_moedict(src):
    """辭典的詞條，以及單字的注音。"""
    entries = json.load(open(os.path.join(src, 'moedict-data', 'dict-revised.json'), encoding='utf-8'))
    words, readings = set(), collections.defaultdict(set)
    for entry in entries:
        title = re.sub(r'[{}\[\]]', '', entry.get('title', ''))
        if not title:
            continue
        words.add(title)
        if len(title) == 1:
            for h in entry.get('heteronyms', []):
                b = re.sub(r'（.*?）', '', h.get('bopomofo', '') or '').replace(' ', '').strip()
                if b:
                    readings[title].add(b)
    return words, readings


def load_pickle(src, name, default):
    path = os.path.join(src, name)
    return pickle.load(open(path, 'rb')) if os.path.exists(path) else default


def load_opencc(src, name):
    m = {}
    path = os.path.join(src, 'OpenCC', 'data', 'dictionary', name)
    for line in open(path, encoding='utf-8'):
        if line.startswith('#') or '\t' not in line:
            continue
        k, v = line.rstrip('\n').split('\t')
        m[k] = v.split()
    return m


def load_jp_shinjitai(src):
    """日文新字體。檔案左邊是日文字，右邊是對應的繁體字。"""
    path = os.path.join(src, 'OpenCC', 'data', 'dictionary', 'JPShinjitaiCharacters.txt')
    chars = set()
    for line in open(path, encoding='utf-8'):
        if line.startswith('#') or '\t' not in line:
            continue
        chars.add(line.split('\t', 1)[0])
    return chars


# ---------- 產生資料 ----------

def write_text(name, lines):
    open(os.path.join(OUT, name), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')


def write_json(name, obj):
    json.dump(obj, open(os.path.join(OUT, name), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))


def build_idioms(words, popularity, has_freq):
    """四字詞條。有詞頻時只留語料裡出現過 3 次以上的。"""
    return sorted(w for w in words if HAN.match(w) and len(w) == 4 and (not has_freq or popularity(w) >= 3))


def build_readings(readings, idioms, char_freq):
    """成語用到的字和常用字的注音。"""
    need = set(''.join(idioms))
    common = {c for c, n in char_freq.items() if n >= 50} if char_freq else set(readings)
    return {c: sorted(readings[c]) for c in sorted(readings) if c in need or c in common}


def build_simplified(st, sp, ts, to_tw, char_freq, moe_char_freq, jp_chars):
    # 簡體字 → 繁體候選。台灣文章裡常見的字（例如「床」「群」）不算簡體字。
    chars = {}
    for k, v in st.items():
        if len(k) != 1 or k in v:
            continue
        if char_freq and char_freq.get(k, 0) > 0.05 * max(1, char_freq.get(to_tw(v[0]), 0)):
            continue
        chars[k] = [to_tw(x) for x in v]

    # 一對多的字（发 → 發／髮）要靠詞來決定
    multi = {k for k, v in chars.items() if len(v) > 1}
    phrases = {}
    for s, tv in sp.items():
        if any(c in multi for c in s) and len(s) <= 4:
            phrases[s] = ''.join(to_tw(c) for c in tv[0])

    # 在辭典正文（古文引文）裡也常出現的字，只當建議
    legit = ''.join(sorted(k for k in chars if k not in ALWAYS_SIMPLIFIED and moe_char_freq.get(k, 0) >= 10))
    # 跟日文漢字同形的字，只當建議
    jp = ''.join(sorted(k for k in chars if k in jp_chars))
    return {
        'chars': chars,
        'phrases': phrases,
        'ts': {k: v[0] for k, v in ts.items() if len(k) == 1},
        'legit': legit,
        'jp': jp
    }


def build_typos(words, st, sp, to_tw, popularity, has_freq):
    """傳回 (錯字表, 被排除的錯字)。錯字表的每一列是 (錯字, 正字, level)。"""
    exclude = {a for a, _ in read_list('exclude.txt')}
    forced_sug = {a for a, _ in read_list('sug.txt')}
    rows, seen, dropped = [], set(), []

    def add(wrong, right, level, from_curated):
        if not wrong or not right or wrong == right or len(wrong) != len(right):
            return
        if wrong in seen or wrong in exclude or not HAN.match(wrong) or not HAN.match(right):
            return
        if wrong in words:
            dropped.append((wrong, right, 'dict'))
            return
        if only_equiv(wrong, right):
            if sug_pair(wrong, right):
                level = 'sug'
            elif not from_curated:
                # 自動產生的錯字，如果只差在通行異體字就不算錯；人工清單則照列
                dropped.append((wrong, right, 'equiv'))
                return
        seen.add(wrong)
        if wrong in forced_sug:
            level = 'sug'
        rows.append((wrong, right, level))

    # 人工清單
    for wrong, right in read_list('curated.txt'):
        if right:
            add(wrong, right, 'sug' if sug_pair(wrong, right) else 'err', True)

    # 繁簡轉換時最常選錯的字（例如「頭發」「皇後」）：逐字轉換的結果跟整詞轉換不同
    for s, tv in sp.items():
        if not 2 <= len(s) <= 4:
            continue
        right = ''.join(to_tw(c) for c in tv[0])
        wrong = ''.join(to_tw(st.get(c, [c])[0]) for c in s)
        if wrong == right or len(wrong) != len(right):
            continue
        if has_freq and popularity(right) < 20:
            continue
        add(wrong, right, 'err', False)

    return rows, dropped


def build_words(words, src, to_tw, simplified_chars, typo_forms):
    """辭典詞＋ jieba 常用詞，排除錯字形式和含簡體字的詞。"""
    result = {w for w in words if HAN.match(w) and 2 <= len(w) <= 5}
    path = os.path.join(src, 'jieba-dict.txt.big')
    if os.path.exists(path):
        for line in open(path, encoding='utf-8'):
            p = line.split()
            if len(p) < 2 or not p[1].isdigit() or int(p[1]) < 20:
                continue
            w = ''.join(to_tw(c) for c in p[0])
            if HAN.match(w) and 2 <= len(w) <= 5 and not any(c in simplified_chars for c in w):
                result.add(w)
    return sorted(result - typo_forms)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.path.join(HERE, 'sources'))
    src = ap.parse_args().src

    words, readings = load_moedict(src)
    ptt_freq, moe_freq = load_pickle(src, 'wordfreq.pkl', ({}, {}))
    char_freq = load_pickle(src, 'charfreq.pkl', {})
    moe_char_freq = load_pickle(src, 'moecharfreq.pkl', {})
    has_freq = bool(ptt_freq)
    popularity = lambda w: ptt_freq.get(w, 0) + moe_freq.get(w, 0)

    st = load_opencc(src, 'STCharacters.txt')
    sp = load_opencc(src, 'STPhrases.txt')
    ts = load_opencc(src, 'TSCharacters.txt')
    tw_variants = load_opencc(src, 'TWVariants.txt')
    to_tw = lambda c: tw_variants.get(c, [c])[0]

    idioms = build_idioms(words, popularity, has_freq)
    reading_map = build_readings(readings, idioms, char_freq)
    simplified = build_simplified(st, sp, ts, to_tw, char_freq, moe_char_freq, load_jp_shinjitai(src))
    typos, dropped = build_typos(words, st, sp, to_tw, popularity, has_freq)
    word_list = build_words(words, src, to_tw, simplified['chars'], {wrong for wrong, _, _ in typos})

    write_text('idioms.txt', idioms)
    write_json('readings.json', reading_map)
    write_json('simplified.json', simplified)
    write_text('words.txt', word_list)
    write_text('typos.txt', [
        '# 錯字 正字 [sug]',
        '# 由 tools/build-data.py 產生。要新增錯字請改 tools/curated.txt 再重跑；',
        '# 臨時新增也可以直接加在這個檔案最後面，一行一組。'
    ] + [wrong + ' ' + right + (' sug' if level == 'sug' else '') for wrong, right, level in typos])
    json.dump(dropped, open(os.path.join(HERE, 'dropped.json'), 'w', encoding='utf-8'), ensure_ascii=False)

    print('詞表', len(word_list), '成語', len(idioms), '注音', len(reading_map), '簡體字', len(simplified['chars']),
          '簡繁詞', len(simplified['phrases']), '錯字', len(typos), '排除', len(dropped))


if __name__ == '__main__':
    main()
