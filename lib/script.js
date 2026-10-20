'use strict';
// 簡體字和非台灣標準字（这 → 這、爲 → 為）。

const { TW_VARIANTS } = require('./words');
const { SIMPLIFIED } = require('./dictionary');
const { KANA_RE } = require('./text');

const SIMP_CHARS = SIMPLIFIED.chars || {};
const SIMP_PHRASES = SIMPLIFIED.phrases || {};
const TRAD_TO_SIMP = SIMPLIFIED.ts || {};
// 古文也會用的字（并、洒……）和跟日文漢字同形的字（恋、内……），只當建議
const MAYBE_NOT_SIMPLIFIED = new Set([...(SIMPLIFIED.legit || ''), ...(SIMPLIFIED.jp || '')]);

const toSimp = (ch) => TRAD_TO_SIMP[ch] || ch;

// 決定簡體字要換成哪個繁體字。一對多的字（发 → 發／髮）看前後組成的詞。
function resolve(text, i) {
  const options = SIMP_CHARS[text[i]];
  if (options.length === 1) return { to: options[0], sure: true };
  let best = null;
  for (let x = Math.max(0, i - 3); x <= i; x++) {
    for (let y = Math.min(text.length, x + 4); y > i; y--) {
      if (best && y - x <= best.len) continue;
      let key = '';
      for (let k = x; k < y; k++) key += toSimp(text[k]);
      const trad = SIMP_PHRASES[key];
      if (trad && trad.length === y - x) best = { len: y - x, to: trad[i - x] };
    }
  }
  if (best) return { to: best.to, sure: true };
  return { to: options[0], sure: false };
}

// 這段幾乎都是簡體中文：「只有簡體才有的字」比「只有繁體才有的字」多很多
function isMostlySimplified(text) {
  let simp = 0;
  let trad = 0;
  for (const ch of text) {
    if (SIMP_CHARS[ch]) simp++;
    else if (TRAD_TO_SIMP[ch] && TRAD_TO_SIMP[ch] !== ch) trad++;
  }
  return simp >= 3 && simp > 2 * trad;
}

function findScriptIssues(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!SIMP_CHARS[ch] && !TW_VARIANTS[ch]) continue;
    // 附近有日文假名，就當成日文，不檢查
    if (KANA_RE.test(text.slice(Math.max(0, i - 12), i + 13))) continue;
    if (SIMP_CHARS[ch]) {
      const { to, sure } = resolve(text, i);
      out.push({
        cat: 'typo',
        level: sure && !MAYBE_NOT_SIMPLIFIED.has(ch) ? 'err' : 'sug',
        start: i,
        len: 1,
        from: ch,
        to,
        why: '「' + ch + '」是簡體字，繁體寫作「' + to + '」。'
      });
    } else {
      out.push({
        cat: 'typo',
        level: 'sug',
        start: i,
        len: 1,
        from: ch,
        to: TW_VARIANTS[ch],
        why: '台灣通常寫作「' + TW_VARIANTS[ch] + '」。'
      });
    }
  }
  return out;
}

module.exports = { findScriptIssues, isMostlySimplified };
