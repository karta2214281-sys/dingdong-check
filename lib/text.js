'use strict';
// 文字處理的小工具。

// 用空白分隔的詞表：list`慢慢 輕輕 靜靜` → ['慢慢', '輕輕', '靜靜']
function list(strings, ...values) {
  return String.raw(strings, ...values).split(/\s+/).filter(Boolean);
}

// 組成正規表示式的「或」，長的放前面，才不會先比對到短的
function alt(words) {
  return words.slice().sort((a, b) => b.length - a.length).join('|');
}

const HAN_RE = /[㐀-鿿]/;
const isHan = (ch) => !!ch && HAN_RE.test(ch);
const KANA_RE = /[぀-ヿ]/;

module.exports = { list, alt, isHan, KANA_RE };
