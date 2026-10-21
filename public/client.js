(function () {
/* ---------- 頁面元素 ---------- */
const $ = (id) => document.getElementById(id);
const src = $('src');
const out = $('out');
const outHl = $('outHl');
const list = $('list');
const listPane = list.closest('.list-pane');
const filters = $('filters');
const tabSrc = $('tabSrc');
const tabOut = $('tabOut');
const srcPanel = $('srcPanel');
const outPanel = $('outPanel');
const topBtn = $('topBtn');
const helpBtn = $('helpBtn');
const helpPanel = $('helpPanel');
const setBtn = $('setBtn');
const setPanel = $('setPanel');


/* ---------- 設定 ---------- */
const CHIPS = [['all', '全部'], ['typo', '錯字'], ['rep', '重複'], ['sug', '建議修正']];
const SAMPLE = '他發現發現剛剛有一筆資料出錯了，於是慢慢的打開檔案，一行一行地重新檢查。同事跑的很快，說等一下在來幫忙。\n\n「下次不要在犯同樣的錯了。」主管在三叮嚀，「現再就把它改好，改完我們在見。」\n\n他心裡其實很再意，卻只是默默的點頭。他覺的自己累的不行，但這份報告很值的再看一遍。他把檔案放再桌面上，看的出來大家都很緊張。';

/* ---------- 狀態 ---------- */
let filter = 'all';
let issues = [];
// 伺服器傳回的全部結果；issues 是套用設定後要顯示的
let found = [];
let corrected = '';
let reverted = new Set();
let failed = false;
let activeId = null;
let reqSeq = 0;
let checking = false;
let checkedText = null;
let view = 'src';
let anchor = 0;
let syncing = false;
let hold = false;
let mirror;
let toastTimer;
let flashTimer;

const MIN_CHECK_MS = 700;
// 一次最多檢查的字數（不算空白和換行），要跟 server.js 的 MAX_CHARS 一樣
const MAX_CHARS = 100000;

/* ---------- 小工具 ---------- */
const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
// 建議修正（level 為 sug）自成一類，預設不套用，由使用者決定
const isSug = (it) => it.level === 'sug';
// 建議修正和重複打字預設不套用，按「套用修正」才改
const optIn = (it) => isSug(it) || it.cat === 'rep';
const groupOf = (it) => isSug(it) ? 'sug' : it.cat;
const shown = () => filter === 'all' ? issues : issues.filter((it) => groupOf(it) === filter);
const activeIssues = () => issues.filter((it) => !reverted.has(it.id));
const charCount = (text) => text.replace(/\s/g, '').length;
const tooLong = (text) => charCount(text) > MAX_CHARS;
const smooth = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
const activeBox = () => view === 'out' ? out : src;
const isTouch = () => matchMedia('(pointer: coarse)').matches;

// 右下角的字數，例如「512/100,000」，超過上限變紅字
function setCount(text) {
  const n = charCount(text);
  const el = $('count');
  el.textContent = n.toLocaleString('en-US') + '/' + MAX_CHARS.toLocaleString('en-US');
  el.classList.toggle('over', n > MAX_CHARS);
}

/* ---------- 設定 ---------- */
const SETTINGS_KEY = 'dedide-settings';
const settings = { deDiSame: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) {}
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} };

// 依設定拿掉不需要的結果。「的」「地」不區分時，不把「的」改成「地」
const allowed = (it) => !(settings.deDiSame && it.from === '的' && it.to === '地');
const issueKey = (it) => it.start + ':' + it.len + ':' + it.to;

// 設定改了以後重新篩選，已經按過的套用／還原照舊保留
function refilter() {
  const off = new Set(issues.filter((it) => reverted.has(it.id)).map(issueKey));
  const known = new Set(issues.map(issueKey));
  issues = numberIssues(found.filter(allowed));
  reverted = new Set(issues
    .filter((it) => known.has(issueKey(it)) ? off.has(issueKey(it)) : optIn(it))
    .map((it) => it.id));
  activeId = null;
  if (checkedText !== null && checkedText === src.value) publish(src.value);
  paint();
}

/* ---------- 修正結果：原文和修正後文字的位置換算 ---------- */
function numberIssues(items) {
  items.forEach((it, i) => { it.id = i; });
  return items;
}

function buildCorrected(text, items) {
  const sorted = items.slice().sort((a, b) => a.start - b.start);
  let next = '';
  let pos = 0;
  for (const it of sorted) {
    next += text.slice(pos, it.start) + it.to;
    pos = it.start + it.len;
  }
  return next + text.slice(pos);
}

function toOutIndex(srcIndex) {
  let delta = 0;
  for (const it of activeIssues()) {
    if (it.start >= srcIndex) break;
    if (it.start + it.len <= srcIndex) delta += it.to.length - it.len;
    else return it.start + delta;
  }
  return srcIndex + delta;
}

function toSrcIndex(outIndex) {
  let srcPos = 0;
  let outPos = 0;
  for (const it of activeIssues()) {
    const plain = it.start - srcPos;
    if (outIndex <= outPos + plain) return srcPos + (outIndex - outPos);
    outPos += plain;
    if (outIndex <= outPos + it.to.length) return it.start;
    outPos += it.to.length;
    srcPos = it.start + it.len;
  }
  return srcPos + (outIndex - outPos);
}

/* ---------- 畫面：修正清單、修正結果的標示 ---------- */
function markHtml(it) {
  const del = it.to === '';
  const kind = (del ? 'del' : 'fix') + (isSug(it) ? ' sug' : '');
  const note = del ? '刪除' : it.to;
  return '<span class="mk ' + kind + '"><span class="note">' + esc(note) + '</span><span class="bad">' + esc(it.from) + '</span></span>';
}

function snippet(text, it) {
  let before = text.slice(Math.max(0, it.start - 10), it.start);
  let after = text.slice(it.start + it.len, it.start + it.len + 10);
  const cutBefore = it.start - 10 > 0;
  const cutAfter = it.start + it.len + 10 < text.length;
  if (before.includes('\n')) before = before.slice(before.lastIndexOf('\n') + 1);
  if (after.includes('\n')) after = after.slice(0, after.indexOf('\n'));
  const lead = cutBefore && !before.startsWith('\n') ? '…' : '';
  const tail = cutAfter ? '…' : '';
  return lead + esc(before) + markHtml(it) + esc(after) + tail;
}

function highlightHtml(text, items, flash) {
  const sorted = items.slice().sort((a, b) => a.start - b.start);
  let html = '';
  let srcPos = 0;
  let outPos = 0;
  const emit = (chunk, fixed) => {
    if (!chunk) return;
    const next = outPos + chunk.length;
    const write = (part, marked) => {
      if (!part) return;
      let piece = fixed ? '<span class="fixed">' + esc(part) + '</span>' : esc(part);
      if (marked) piece = '<mark class="flash">' + piece + '</mark>';
      html += piece;
    };
    if (!flash) write(chunk, false);
    else {
      const from = Math.max(outPos, flash.start);
      const to = Math.min(next, flash.end);
      if (to <= from) write(chunk, false);
      else {
        const a = from - outPos;
        const b = to - outPos;
        write(chunk.slice(0, a), false);
        write(chunk.slice(a, b), true);
        write(chunk.slice(b), false);
      }
    }
    outPos = next;
  };
  for (const it of sorted) {
    emit(text.slice(srcPos, it.start), false);
    emit(it.to, true);
    srcPos = it.start + it.len;
  }
  emit(text.slice(srcPos), false);
  return html;
}

function paragraphBounds(text, index) {
  const i = Math.max(0, Math.min(index, Math.max(0, text.length - 1)));
  const before = text.lastIndexOf('\n', i - 1);
  const start = before < 0 ? 0 : before + 1;
  const nl = text.indexOf('\n', i);
  return { start, end: nl < 0 ? text.length : nl };
}

function fitHighlight() {
  const pad = parseFloat(getComputedStyle(out).paddingRight) || 0;
  const bar = out.offsetWidth - out.clientWidth;
  outHl.style.width = out.offsetWidth + 'px';
  outHl.style.height = out.offsetHeight + 'px';
  outHl.style.paddingRight = (pad + bar) + 'px';
  outHl.scrollTop = out.scrollTop;
}

function renderHighlight(flash) {
  if (!out.value) outHl.textContent = '';
  else if (out.value === corrected) outHl.innerHTML = highlightHtml(src.value, activeIssues(), flash);
  else outHl.textContent = out.value;
  if (out.value.endsWith('\n')) outHl.appendChild(document.createElement('br'));
  fitHighlight();
}

// 短暫用黃底標出修正結果裡的一段（out 裡的位置）
function flashRange(range) {
  clearTimeout(flashTimer);
  renderHighlight(range);
  flashTimer = setTimeout(() => {
    outHl.querySelectorAll('mark.flash').forEach((el) => el.classList.add('off'));
  }, 700);
}

function publish(text) {
  if (!text) reverted = new Set();
  const next = text.trim() ? buildCorrected(text, activeIssues()) : '';
  const same = out.value === corrected && corrected === next;
  if (!same && view === 'out' && out.value === corrected) anchor = toSrcIndex(indexFromBox(out));
  corrected = next;
  if (out.value !== corrected) out.value = corrected;
  renderHighlight();
  if (!same && view === 'out') scrollBoxTo(out, toOutIndex(anchor));
}

function paint() {
  if (!hold) capture();
  const text = src.value;
  setCount(activeBox().value);
  const vis = shown();
  const counts = { all: issues.length, typo: 0, rep: 0, sug: 0 };
  issues.forEach((it) => counts[groupOf(it)]++);
  filters.innerHTML = CHIPS.map(([key, label]) =>
    '<button type="button" class="chip" data-f="' + key + '" aria-pressed="' + (filter === key) + '">' + label + ' <b>' + counts[key] + '</b></button>'
  ).join('');

  list.setAttribute('aria-busy', checking ? 'true' : 'false');
  paintCheckButton();

  if (checking) {
    list.innerHTML = '<li class="loading-card" role="status"><span class="spinner" aria-hidden="true"></span><span>正在檢查錯字</span></li>';
  } else if (failed) {
    list.innerHTML = '<li class="none">伺服器沒有回應，請稍後再試。文章沒有被存下來。</li>';
  } else if (!text.trim()) {
    list.innerHTML = '<li class="none">還沒有文章。把文章貼在上方，再按「檢查錯字」。</li>';
  } else if (tooLong(text)) {
    list.innerHTML = '<li class="none">文章超過 ' + MAX_CHARS.toLocaleString('en-US') + ' 字，請刪減或分段檢查。</li>';
  } else if (checkedText !== text) {
    list.innerHTML = '<li class="none">按「檢查錯字」開始檢查。</li>';
  } else if (!vis.length) {
    list.innerHTML = '<li class="none">' + (issues.length
      ? '這個分類沒有修正。'
      : '沒有要修正的地方。目前檢查錯字和重複打字。') + '</li>';
  } else {
    list.innerHTML = vis.map((it) => {
      const del = it.to === '';
      const on = activeId === it.id ? ' on' : '';
      const off = reverted.has(it.id);
      const label = off ? (optIn(it) ? '套用修正' : '重新套用修正') : '還原原文';
      const kind = (del ? 'del' : 'fix') + (isSug(it) ? ' sug' : '') + (off ? ' off' : '');
      return '<li class="card ' + kind + on + '" data-id="' + it.id + '" tabindex="0">' +
        '<p class="ctx">' + snippet(text, it) + '</p>' +
        '<button type="button" class="btn revert" data-id="' + it.id + '">' + label + '</button></li>';
    }).join('');
  }
}

/* ---------- 檢查：送出文章、接收結果 ---------- */
function showError() {
  failed = true;
  checking = false;
  issues = [];
  paint();
}

function paintCheckButton() {
  const btn = $('checkBtn');
  const hasResult = checkedText !== null && !failed;
  btn.hidden = view === 'out';
  btn.classList.toggle('is-busy', checking);
  btn.disabled = checking || !src.value.trim() || tooLong(src.value);
  btn.setAttribute('aria-busy', checking ? 'true' : 'false');
  btn.innerHTML = checking
    ? '<span class="spinner" aria-hidden="true"></span>檢查中'
    : (hasResult ? '重新檢查' : '檢查錯字');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetResults() {
  reqSeq++;
  checking = false;
  failed = false;
  issues = [];
  reverted = new Set();
  activeId = null;
  checkedText = null;
  publish('');
}

function refresh() {
  const text = src.value;
  if (!text.trim() || checking || tooLong(text)) return;
  const seq = ++reqSeq;
  failed = false;
  checking = true;
  issues = [];
  reverted = new Set();
  activeId = null;
  publish('');
  paint();
  const started = Date.now();
  const settle = () => {
    const elapsed = Date.now() - started;
    return elapsed >= MIN_CHECK_MS ? Promise.resolve() : wait(MIN_CHECK_MS - elapsed);
  };
  fetch('/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  }).then((res) => {
    if (!res.ok) throw new Error('bad');
    return res.json();
  }).then(async (data) => {
    if (seq !== reqSeq || src.value !== text) return;
    await settle();
    if (seq !== reqSeq || src.value !== text) return;
    checking = false;
    checkedText = text;
    found = (Array.isArray(data.issues) ? data.issues : []).filter((it) => it && typeof it.start === 'number');
    issues = numberIssues(found.filter(allowed));
    reverted = new Set(issues.filter(optIn).map((it) => it.id));
    publish(text);
    paint();
    // 檢查完自動切到「修正結果」，停在原稿看到的同一段
    setTab('out');
  }).catch(async () => {
    if (seq !== reqSeq || src.value !== text) return;
    await settle();
    if (seq !== reqSeq || src.value !== text) return;
    showError();
  });
}

function applyEdit(next, message) {
  src.value = next;
  resetResults();
  paint();
  toast(message);
}

/* ---------- 點選修正：跳到修正結果裡的位置 ---------- */
function scrollPageTo(el) {
  const nav = document.querySelector('.nav');
  const gap = (nav ? nav.offsetHeight : 0) + 16;
  const top = el.getBoundingClientRect().top + window.scrollY - gap;
  window.scrollTo({ top: Math.max(0, top), behavior: smooth() });
}

function revealInBox(box, index, para) {
  const value = box.value;
  if (!value) return;
  syncMirror(box);
  const paraTop = contentTop(para.start);
  const focusTop = contentTop(Math.min(index, value.length - 1));
  const last = Math.min(Math.max(para.start, para.end - 1), value.length - 1);
  const line = parseFloat(getComputedStyle(box).lineHeight) || 28;
  const paraHeight = contentTop(last) + line - paraTop;
  const top = paraHeight <= box.clientHeight - 16 ? Math.max(0, paraTop - 8) : Math.max(0, focusTop - 32);
  syncing = true;
  box.scrollTop = top;
  if (box === out) outHl.scrollTop = top;
  syncing = false;
}

function blurIssue() {
  activeId = null;
  paint();
  const end = out.selectionEnd;
  out.setSelectionRange(end, end);
}

function activateIssue(id) {
  if (activeId === id) blurIssue();
  else focusIssue(id);
}

function focusIssue(id) {
  const it = issues[id];
  if (!it) return;
  activeId = id;
  anchor = it.start;
  hold = true;
  setTab('out', false);
  paint();
  hold = false;
  // 觸控裝置上先設成唯讀再 focus，才能標出選取位置又不會叫出鍵盤
  if (isTouch()) out.readOnly = true;
  out.focus({ preventScroll: true });
  scrollPageTo(out);
  if (out.value !== corrected || !out.value) return;
  const len = reverted.has(it.id) ? it.len : it.to.length;
  const start = Math.max(0, Math.min(toOutIndex(it.start), out.value.length));
  const end = Math.max(start, Math.min(start + len, out.value.length));
  const para = paragraphBounds(out.value, start);
  out.setSelectionRange(start, end);
  revealInBox(out, start, para);
  // 只亮改過的字；刪除的地方沒有字，就亮刪除點前後各一個字
  const flash = end > start
    ? { start, end }
    : { start: Math.max(0, start - 1), end: Math.min(out.value.length, start + 1) };
  flashRange(flash);
}

/* ---------- 分類、修正清單、原稿的操作 ---------- */
filters.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  filter = chip.dataset.f;
  activeId = null;
  paint();
});

function toggleIssue(id) {
  if (!issues[id]) return;
  if (reverted.has(id)) reverted.delete(id);
  else reverted.add(id);
  corrected = src.value.trim() ? buildCorrected(src.value, activeIssues()) : '';
  out.value = corrected;
  renderHighlight();
  focusIssue(id);
}

list.addEventListener('click', (e) => {
  const btn = e.target.closest('.revert');
  if (btn) {
    toggleIssue(+btn.dataset.id);
    return;
  }
  const card = e.target.closest('.card');
  if (card) activateIssue(+card.dataset.id);
});
list.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('.revert')) return;
  const card = e.target.closest('.card');
  if (!card) return;
  e.preventDefault();
  activateIssue(+card.dataset.id);
});

src.addEventListener('input', () => {
  activeId = null;
  if (checking || checkedText !== null || issues.length || failed) resetResults();
  paint();
});
$('checkBtn').addEventListener('click', refresh);
// 使用者自己點修正結果時才解除唯讀，鍵盤照常出現
out.addEventListener('pointerdown', () => { out.readOnly = false; });
out.addEventListener('blur', () => { out.readOnly = false; });
out.addEventListener('input', () => {
  renderHighlight();
  if (view === 'out') setCount(out.value);
});

/* ---------- 清空、複製、提示訊息 ---------- */
const clearConfirm = $('clearConfirm');
let clearReturn = null;

function openClearConfirm() {
  if (!src.value) return;
  clearReturn = document.activeElement;
  clearConfirm.hidden = false;
  $('clearCancel').focus();
}

function closeClearConfirm() {
  if (clearConfirm.hidden) return;
  clearConfirm.hidden = true;
  if (clearReturn && clearReturn.focus) clearReturn.focus();
  clearReturn = null;
}

$('clear').addEventListener('click', openClearConfirm);
$('clearCancel').addEventListener('click', closeClearConfirm);
$('clearOk').addEventListener('click', () => {
  closeClearConfirm();
  if (src.value) applyEdit('', '已清空');
});
clearConfirm.addEventListener('click', (e) => {
  if (e.target === clearConfirm) closeClearConfirm();
});
clearConfirm.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeClearConfirm();
    return;
  }
  if (e.key !== 'Tab') return;
  const items = [...clearConfirm.querySelectorAll('button')];
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});
$('copy').addEventListener('click', () => {
  const value = out.value;
  const fallback = () => {
    setTab('out');
    out.focus();
    out.select();
    toast('已選取全文，請按複製');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(() => toast('已複製全文'), fallback);
  } else {
    fallback();
  }
});

function toast(message) {
  $('toastMsg').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}

/* ---------- 捲動位置：用隱藏的鏡像元素算出每個字在畫面上的高度 ---------- */
function syncMirror(box) {
  if (!mirror) {
    mirror = document.createElement('div');
    mirror.className = 'mirror';
    mirror.setAttribute('aria-hidden', 'true');
    document.body.appendChild(mirror);
  }
  const style = getComputedStyle(box);
  mirror.style.width = box.clientWidth + 'px';
  mirror.style.font = style.font;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.padding = style.padding;
  mirror.style.border = '0';
  if (mirror.textContent !== box.value) mirror.textContent = box.value;
}

function contentTop(index) {
  const node = mirror.firstChild;
  if (!node || index <= 0) return 0;
  const i = Math.min(index, node.textContent.length - 1);
  const range = document.createRange();
  range.setStart(node, i);
  range.setEnd(node, i + 1);
  const rect = range.getClientRects()[0] || range.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(mirror).paddingTop) || 0;
  return Math.max(0, rect.top - mirror.getBoundingClientRect().top - pad);
}

function indexFromBox(box) {
  const value = box.value;
  if (!value) return 0;
  syncMirror(box);
  const target = box.scrollTop + 1;
  let lo = 0;
  let hi = value.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (contentTop(mid) <= target) lo = mid;
    else hi = mid - 1;
  }
  const line = contentTop(lo);
  while (lo > 0 && Math.abs(contentTop(lo - 1) - line) < 1) lo--;
  return lo;
}

function scrollBoxTo(box, index) {
  const value = box.value;
  if (!value) {
    box.scrollTop = 0;
    return;
  }
  syncMirror(box);
  syncing = true;
  box.scrollTop = contentTop(Math.max(0, Math.min(index, value.length - 1)));
  if (box === out) outHl.scrollTop = box.scrollTop;
  syncing = false;
}

function capture() {
  if (hold) return;
  if (view === 'src') anchor = indexFromBox(src);
  else if (out.value === corrected) anchor = toSrcIndex(indexFromBox(out));
}

/* ---------- 原稿／修正結果分頁 ---------- */
function setTab(which, apply) {
  if (apply === undefined) apply = true;
  if (view !== which && !hold) capture();
  view = which;
  const srcOn = which === 'src';
  tabSrc.setAttribute('aria-selected', srcOn ? 'true' : 'false');
  tabOut.setAttribute('aria-selected', srcOn ? 'false' : 'true');
  tabSrc.tabIndex = srcOn ? 0 : -1;
  tabOut.tabIndex = srcOn ? -1 : 0;
  srcPanel.hidden = !srcOn;
  outPanel.hidden = srcOn;
  setCount(activeBox().value);
  paintCheckButton();
  if (!srcOn) fitHighlight();
  if (!apply) return;
  if (srcOn) scrollBoxTo(src, anchor);
  else if (out.value === corrected) scrollBoxTo(out, toOutIndex(anchor));
}

tabSrc.addEventListener('click', () => setTab('src'));
tabOut.addEventListener('click', () => setTab('out'));
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const which = e.key === 'ArrowRight' ? 'out' : 'src';
  setTab(which);
  (which === 'src' ? tabSrc : tabOut).focus();
});
src.addEventListener('scroll', () => { if (!syncing && view === 'src') anchor = indexFromBox(src); }, { passive: true });
out.addEventListener('scroll', () => {
  outHl.scrollTop = out.scrollTop;
  if (!syncing && view === 'out' && out.value === corrected) anchor = toSrcIndex(indexFromBox(out));
}, { passive: true });

/* ---------- 置頂、說明、尺寸、深色模式 ---------- */
function syncTop() {
  const show = listPane.scrollTop > 240;
  topBtn.hidden = !show;
  document.body.classList.toggle('has-top', show);
}
listPane.addEventListener('scroll', syncTop, { passive: true });
topBtn.addEventListener('click', (e) => {
  listPane.scrollTo({ top: 0, behavior: smooth() });
  if (e.detail > 0) topBtn.blur(); // 滑鼠或觸控點擊後不留下選取框
});
syncTop();

// 說明和設定兩個面板，一次只開一個
const POPUPS = [[helpBtn, helpPanel], [setBtn, setPanel]];
function setPopup(panel, open) {
  for (const [btn, p] of POPUPS) {
    const show = open && p === panel;
    btn.setAttribute('aria-expanded', show ? 'true' : 'false');
    p.hidden = !show;
  }
}
const setHelp = (open) => setPopup(helpPanel, open);
helpBtn.addEventListener('click', () => setPopup(helpPanel, helpPanel.hidden));
setBtn.addEventListener('click', () => setPopup(setPanel, setPanel.hidden));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !clearConfirm.hidden) return;
  if (e.key === 'Escape') setPopup(null, false);
});
document.addEventListener('click', (e) => {
  if (helpPanel.hidden && setPanel.hidden) return;
  if (POPUPS.some(([btn, p]) => e.target.closest('#' + btn.id) || e.target.closest('#' + p.id))) return;
  setPopup(null, false);
});

// 設定面板裡有 data-setting 的開關都會自動存起來；之後新增設定只要加一列 HTML
// 和 settings 的預設值，影響檢查結果的再寫進 allowed()
setPanel.querySelectorAll('input[data-setting]').forEach((input) => {
  const key = input.dataset.setting;
  input.checked = !!settings[key];
  input.addEventListener('change', () => {
    settings[key] = input.checked;
    saveSettings();
    refilter();
  });
});

const stack = src.closest('.view-stack');
function followResize(box, panel, other) {
  new ResizeObserver(() => {
    if (box === out) fitHighlight();
    if (panel.hidden || !box.style.height) return;
    const next = box.offsetHeight + 'px';
    if (stack.style.height !== next) stack.style.height = next;
    if (other.style.height) other.style.height = '';
  }).observe(box);
}
followResize(src, srcPanel, out);
followResize(out, outPanel, src);

const themeBtn = $('themeBtn');
function paintTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  themeBtn.setAttribute('aria-label', dark ? '切換淺色模式' : '切換深色模式');
}
paintTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  paintTheme(next);
  try { localStorage.setItem('dedide-theme', next); } catch (e) {}
});

/* ---------- 啟動 ---------- */
window.addEventListener('beforeunload', (e) => {
  if (!src.value.trim()) return;
  e.preventDefault();
  e.returnValue = '';
});

src.value = SAMPLE;
paint();
})();
