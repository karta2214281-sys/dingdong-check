'use strict';
// 錯字檢查的入口。只在伺服器載入，不要把 lib/ 放到 public。
//
//   check(text)                        → 確定錯誤（level: 'err'）＋規則找到的所有結果
//   check(text, { suggestions: true }) → 再加上建議（level: 'sug'）
//
// 每筆結果：{ cat: 'typo'|'rep', level: 'err'|'sug', start, len, from, to, why }
// start、len 是在原文裡的位置；from 是原文的字，to 是建議改成的字（空字串表示刪除）。

const { runRules } = require('./rules');
const { findListedTypos } = require('./typos');
const { findIdiomTypos } = require('./idioms');
const { findScriptIssues, isMostlySimplified } = require('./script');

// 檢查一段（不含換行）。簡體中文的段落不檢查。
function checkParagraph(para) {
  if (!para || isMostlySimplified(para)) return [];
  const found = findScriptIssues(para);

  // 先把確定的簡體字換成繁體，再查錯字表（例如「这里」要改成「這裡」）
  const sure = new Map(found.filter((f) => f.level === 'err').map((f) => [f.start, f.to]));
  let normalized = para;
  if (found.length) {
    normalized = '';
    for (let k = 0; k < para.length; k++) normalized += sure.has(k) ? sure.get(k) : para[k];
  }
  for (const item of [...findListedTypos(normalized), ...findIdiomTypos(normalized)]) {
    // 錯字跟簡體字重疊時，from 要用原文的字
    item.from = para.slice(item.start, item.start + item.len);
    found.push(item);
  }
  return found;
}

// 位置重疊時只留一筆：位置在前的優先，同位置確定錯誤優先，再來是比較長的
function removeOverlaps(items) {
  items.sort(
    (a, b) => a.start - b.start || (a.level === 'err' ? -1 : 1) - (b.level === 'err' ? -1 : 1) || b.len - a.len
  );
  const kept = [];
  let end = -1;
  for (const item of items) {
    if (item.start < end) continue;
    kept.push(item);
    end = item.start + item.len;
  }
  return kept;
}

function check(text, options) {
  const withSuggestions = !!(options && options.suggestions);
  const out = runRules(text);
  let offset = 0;
  for (const para of text.split('\n')) {
    for (const item of checkParagraph(para)) {
      if (!withSuggestions && item.level !== 'err') continue;
      item.start += offset;
      out.push(item);
    }
    offset += para.length + 1;
  }
  return removeOverlaps(out);
}

module.exports = { check };
