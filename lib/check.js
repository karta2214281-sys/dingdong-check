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
const { findScriptIssues, isMostlySimplified, toTraditional, toSimplified } = require('./script');

// 檢查一段繁體中文（不含換行）。夾在裡面的簡體字會標出來。
function checkParagraph(para) {
  if (!para) return [];
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

// 簡體中文的段落：先整段轉成繁體來檢查，結果再轉回簡體。
// 轉回簡體後跟原文一樣的（例如繁體才分得出來的「頭發／頭髮」），就不算錯。
function toSimplifiedIssue(item, text) {
  item.from = text.slice(item.start, item.start + item.len);
  item.to = toSimplified(item.to);
  item.why = toSimplified(item.why || '');
  return item.to === item.from ? null : item;
}

function check(text, options) {
  const withSuggestions = !!(options && options.suggestions);
  const paras = text.split('\n');
  const simp = paras.map((para) => !!para && isMostlySimplified(para));
  const checked = paras.map((para, i) => simp[i] ? toTraditional(para) : para);

  // 每個字屬於哪一段是簡體段落
  const ranges = [];
  let offset = 0;
  paras.forEach((para, i) => {
    if (simp[i]) ranges.push([offset, offset + para.length]);
    offset += para.length + 1;
  });
  const inSimp = (item) => ranges.some(([a, b]) => item.start >= a && item.start < b);

  const items = runRules(checked.join('\n'));
  offset = 0;
  checked.forEach((para, i) => {
    for (const item of checkParagraph(para)) {
      item.start += offset;
      items.push(item);
    }
    offset += paras[i].length + 1;
  });

  const out = [];
  for (const item of items) {
    if (!withSuggestions && item.level !== 'err') continue;
    const fixed = inSimp(item) ? toSimplifiedIssue(item, text) : item;
    if (fixed) out.push(fixed);
  }
  return removeOverlaps(out);
}

module.exports = { check };
