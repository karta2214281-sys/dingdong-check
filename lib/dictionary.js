'use strict';
// 載入 lib/data 的資料檔（由 tools/build-data.py 產生），以及共用的查詞工具。

const fs = require('fs');
const path = require('path');
const { IDIOMS, TYPOS, EQUIV } = require('./words');

const DATA_DIR = path.join(__dirname, 'data');

function readData(name, fallback) {
  try {
    return fs.readFileSync(path.join(DATA_DIR, name), 'utf8');
  } catch {
    return fallback;
  }
}

const lines = (name) => readData(name, '').split('\n').filter(Boolean);

// 辭典詞＋常用詞（斷詞檢查用）
const WORDS = new Set(lines('words.txt'));

// 成語：資料檔＋ lib/words.js 的手動清單
const ALL_IDIOMS = new Set(lines('idioms.txt'));
for (const word of IDIOMS) ALL_IDIOMS.add(word);

// 每個字的注音，例如 { 在: ['ㄗㄞˋ'] }
const READINGS = JSON.parse(readData('readings.json', '{}'));

// 簡繁對照：chars 簡體字→繁體候選、phrases 簡體詞→繁體詞、ts 繁體字→簡體字、
// legit 古文也會用的簡體字、jp 跟日文漢字同形的簡體字
const SIMPLIFIED = JSON.parse(readData('simplified.json', '{"chars":{},"phrases":{},"ts":{}}'));

// 錯字表：lib/words.js 的 TYPOS（確定錯誤）＋ lib/data/typos.txt（「錯字 正字 [sug]」）
const TYPO_LIST = [];
{
  const seen = new Set();
  const add = (wrong, right, level) => {
    if (!wrong || !right || wrong === right || wrong.length !== right.length || seen.has(wrong)) return;
    seen.add(wrong);
    TYPO_LIST.push({ wrong, right, level: level === 'sug' ? 'sug' : 'err' });
  };
  for (const [wrong, right] of TYPOS) add(wrong, right, 'err');
  for (const line of lines('typos.txt')) {
    if (line[0] === '#') continue;
    const [wrong, right, level] = line.trim().split(/\s+/);
    add(wrong, right, level);
  }
}

// 通行異體字：sameChar('台', '臺') 為 true
const EQUIV_MAP = new Map();
for (const group of EQUIV) {
  for (const a of group) {
    for (const b of group) {
      if (a === b) continue;
      if (!EQUIV_MAP.has(a)) EQUIV_MAP.set(a, new Set());
      EQUIV_MAP.get(a).add(b);
    }
  }
}
const sameChar = (a, b) => a === b || (EQUIV_MAP.has(a) && EQUIV_MAP.get(a).has(b));

// 斷詞檢查：如果 positions 上的字能跟 [start, end) 以外的字組成辭典裡的詞，
// 就可能只是兩個詞剛好接在一起（例如「回頭發現」的「頭發」），不算錯字。
// 整段被包在更長的詞裡也算。
function crossesWord(text, start, end, positions) {
  for (const p of positions) {
    for (let x = Math.max(0, p - 4); x <= p; x++) {
      for (let y = p + 1; y <= Math.min(text.length, x + 5); y++) {
        if (y - x < 2 || (x >= start && y <= end)) continue;
        if (WORDS.has(text.slice(x, y))) return true;
      }
    }
  }
  for (let x = Math.max(0, end - 5); x <= start; x++) {
    for (let y = end; y <= Math.min(text.length, x + 5); y++) {
      if ((x < start || y > end) && WORDS.has(text.slice(x, y))) return true;
    }
  }
  return false;
}

module.exports = { WORDS, ALL_IDIOMS, READINGS, SIMPLIFIED, TYPO_LIST, sameChar, crossesWord };
