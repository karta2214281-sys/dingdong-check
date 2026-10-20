'use strict';
// 成語比對：四個字裡只差一個同音字或形近字，就可能是寫錯的成語（莫名奇妙 → 莫名其妙）。

const { CONFUSION, IDIOMS, IDIOM_SKIP } = require('./words');
const { WORDS, ALL_IDIOMS, READINGS, sameChar, crossesWord } = require('./dictionary');
const { isHan } = require('./text');

// 形近字：每個字對應到同一組裡的其他字
const LOOKALIKES = new Map();
for (const group of CONFUSION) {
  const chars = [...group];
  for (const ch of chars) {
    if (!LOOKALIKES.has(ch)) LOOKALIKES.set(ch, []);
    for (const other of chars) if (other !== ch && !LOOKALIKES.get(ch).includes(other)) LOOKALIKES.get(ch).push(other);
  }
}

// 同音索引：把成語其中一個字換成它的注音當 key，例如「2莫名|ㄑㄧˊ|妙」→ ['莫名其妙']
const soundKey = (k, word, reading) => k + word.slice(0, k) + '|' + reading + '|' + word.slice(k + 1);
const SOUND_INDEX = new Map();
for (const idiom of ALL_IDIOMS) {
  for (let k = 0; k < 4; k++) {
    for (const reading of READINGS[idiom[k]] || []) {
      const key = soundKey(k, idiom, reading);
      if (!SOUND_INDEX.has(key)) SOUND_INDEX.set(key, []);
      SOUND_INDEX.get(key).push(idiom);
    }
  }
}

// 找出跟這四個字只差一個字的成語，k 是不同的那個字的位置
function nearbyIdioms(slice) {
  const hits = new Map();
  for (let k = 0; k < 4; k++) {
    const ch = slice[k];
    for (const reading of READINGS[ch] || []) {
      for (const idiom of SOUND_INDEX.get(soundKey(k, slice, reading)) || []) {
        if (idiom[k] !== ch && !sameChar(ch, idiom[k])) hits.set(idiom, { k, idiom });
      }
    }
    for (const other of LOOKALIKES.get(ch) || []) {
      const idiom = slice.slice(0, k) + other + slice.slice(k + 1);
      if (ALL_IDIOMS.has(idiom) && !hits.has(idiom)) hits.set(idiom, { k, idiom });
    }
  }
  return [...hits.values()];
}

function findIdiomTypos(text) {
  const out = [];
  for (let i = 0; i + 4 <= text.length; i++) {
    const slice = text.slice(i, i + 4);
    if (![...slice].every(isHan)) continue;
    if (ALL_IDIOMS.has(slice) || WORDS.has(slice) || IDIOM_SKIP.has(slice)) continue;
    const hits = nearbyIdioms(slice);
    if (hits.length !== 1) continue;
    const { k, idiom } = hits[0];
    if (crossesWord(text, i, i + 4, [i + k])) continue;
    out.push({
      cat: 'typo',
      // 手動清單裡的成語，同音或形近都當成確定錯誤；其餘成語只當建議
      level: IDIOMS.has(idiom) ? 'err' : 'sug',
      start: i + k,
      len: 1,
      from: slice[k],
      to: idiom[k],
      why: '「' + slice + '」應為成語「' + idiom + '」。'
    });
  }
  return out;
}

module.exports = { findIdiomTypos };
