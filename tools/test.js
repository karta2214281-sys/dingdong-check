'use strict';
// 用 tools/cases.txt 測試檢查規則。執行：node tools/test.js
const fs = require('fs');
const path = require('path');
const { check } = require('../lib/check');

function apply(text, issues) {
  let out = '';
  let pos = 0;
  for (const it of issues.slice().sort((a, b) => a.start - b.start)) {
    out += text.slice(pos, it.start) + it.to;
    pos = it.start + it.len;
  }
  return out + text.slice(pos);
}

const lines = fs.readFileSync(path.join(__dirname, 'cases.txt'), 'utf8').split('\n');
let pass = 0;
let fail = 0;
for (const raw of lines) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const [input, expected = input] = line.split('=>').map((s) => s.trim());
  const issues = check(input);
  const got = apply(input, issues);
  if (got === expected) {
    pass++;
  } else {
    fail++;
    console.log('✗ ' + input);
    console.log('  預期：' + expected);
    console.log('  結果：' + got);
    for (const it of issues) console.log('    ' + it.from + ' → ' + (it.to || '（刪除）') + '　' + it.why);
  }
}
console.log('\n通過 ' + pass + '，失敗 ' + fail);
process.exitCode = fail ? 1 : 0;
