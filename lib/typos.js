'use strict';
// 錯字表比對（因該、八掛、頭發……）。

const { TYPO_LIST, crossesWord } = require('./dictionary');

// 依第一個字分組，長的錯字先比對
const BY_FIRST_CHAR = new Map();
for (const typo of TYPO_LIST) {
  const key = typo.wrong[0];
  if (!BY_FIRST_CHAR.has(key)) BY_FIRST_CHAR.set(key, []);
  BY_FIRST_CHAR.get(key).push(typo);
}
for (const group of BY_FIRST_CHAR.values()) group.sort((a, b) => b.wrong.length - a.wrong.length);

function diffPositions(a, b) {
  const out = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

function findListedTypos(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const group = BY_FIRST_CHAR.get(text[i]);
    if (!group) continue;
    for (const { wrong, right, level } of group) {
      if (!text.startsWith(wrong, i)) continue;
      const diffs = diffPositions(wrong, right);
      // 兩個字的錯字，任何一個字能跟外面組成詞就跳過；更長的只看寫錯的那幾個字
      const check = wrong.length <= 2 ? [...wrong].map((_, k) => i + k) : diffs.map((k) => i + k);
      if (crossesWord(text, i, i + wrong.length, check)) continue;
      const a = diffs[0];
      const b = diffs[diffs.length - 1] + 1;
      out.push({
        cat: 'typo',
        level,
        start: i + a,
        len: b - a,
        from: wrong.slice(a, b),
        to: right.slice(a, b),
        why: '「' + wrong + '」應為「' + right + '」。'
      });
      break;
    }
  }
  return out;
}

module.exports = { findListedTypos };
