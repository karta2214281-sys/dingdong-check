# 訂咚錯字檢查器

檢查錯字和重複打字。錯字包含「的、地、得」「在、再」、成語、常見易錯詞、繁簡轉換錯字和混進文章的簡體字，畫面上一律歸在「錯字」。

- 同一個 Node 程式同時提供頁面和檢查。`npm start` 後打開首頁即可。
- 頁面在 `public/`（`index.html`、`style.css`、`client.js`）。檢查規則在 `lib/`，只在伺服器載入，不會送給瀏覽器。
- 文章只在檢查時送到伺服器，檢查完即丟棄，不會寫進資料庫或 log，也不會拿去做 AI 學習。
- 檢查全部用寫好的規則和詞表，不用 AI、不呼叫外部 API。

## 啟動

```bash
npm start
```

預設位址是 http://127.0.0.1:3000/ 。可用環境變數 `PORT` 改埠。

## 檔案

```
server.js            網站伺服器（頁面＋ POST /check）
public/              頁面
lib/check.js         檢查的入口，合併各種檢查的結果
lib/rules.js         正規表示式規則：重複打字、的地得、因該／以經、在再
lib/typos.js         錯字表比對
lib/idioms.js        成語同音字、形近字比對
lib/script.js        簡體字、非台灣標準字
lib/dictionary.js    載入 lib/data 的資料檔，斷詞檢查
lib/words.js         手動維護的清單：錯字、成語、形近字、異體字
lib/text.js          小工具
lib/data/            產生的資料檔（詞表、成語、注音、簡繁對照、錯字表）
tools/build-data.py  產生 lib/data
tools/curated.txt    人工整理的錯字清單
tools/cases.txt      測試句（npm test）
```

## 檢查了什麼

| 類別 | 例子 | 怎麼判斷 |
|---|---|---|
| 重複打字 | 發現發現、的的 | 規則（`lib/rules.js`） |
| 的地得、在再 | 跑的很快、等一下在說 | 規則 |
| 常見錯字 | 因該、以經、自已、跟本、八掛、時侯、眼晴、震憾、按扭 | 錯字表（約 2,300 組） |
| 成語錯字 | 莫名奇妙、不容質疑、見人見智、可見一般 | 錯字表，加上 1.7 萬個成語的同音字、形近字比對 |
| 繁簡轉換錯字 | 頭發、沒關系、幹淨、皇後、鬧鍾、復雜 | 錯字表（由 OpenCC 對照表產生） |
| 簡體字 | 这个、们、说 | 簡繁對照表，會看前後文決定「发」是「發」還是「髮」 |

為了不誤判，每一個錯字都會做「斷詞檢查」：如果錯字的字能跟前後的字組成正常的詞，就當成兩個詞剛好接在一起，不算錯字。例如「回頭發現」的「頭發」、「幾天後」的「天後」、「這只是」的「這只」都不會被改。

附近有日文假名的字不檢查簡體字；整段幾乎都是簡體中文的段落，也不做繁體的錯字檢查。

## 確定錯誤和建議

每一條結果有 `level`：

- `err`：確定是錯的。頁面歸在「錯字」或「重複」，自動套用修正。
- `sug`：可能是錯的，要看上下文，例如「部份／部分」、日文漢字「内」、一般文字剛好跟成語差一個同音字。頁面歸在「建議修正」，預設不套用，按「套用修正」才改。

`check(text)` 只回傳確定錯誤（規則找到的結果例外，全部回傳），`check(text, { suggestions: true })` 回傳全部。`server.js` 用的是後者。

## 新增或調整錯字

- 要馬上加一組錯字：在 `lib/data/typos.txt` 最後加一行 `錯字 正字`，只當建議就加 ` sug`。重開伺服器即生效。
- 要長期維護：改 `tools/curated.txt`（錯字）、`tools/exclude.txt`（不算錯的寫法）、`tools/sug.txt`（只當建議），再重新產生資料（見下方）。
- 兩種寫法都通行的字（例如「台／臺」）列在 `lib/words.js` 的 `EQUIV`，檢查器和產生工具共用這份清單。
- 改完跑 `npm test`。`tools/cases.txt` 是測試句，左邊是原句，右邊是應該改成的樣子；沒有 `=>` 的句子不應該被改。

## 重新產生資料

`lib/data/` 裡的檔案由 `tools/build-data.py` 產生。需要先下載原始資料到 `tools/sources/`：

```bash
cd tools/sources
git clone --depth 1 https://github.com/g0v/moedict-data.git
xz -dk moedict-data/dict-revised.json.xz
git clone --depth 1 https://github.com/BYVoid/OpenCC.git
curl -L -o jieba-dict.txt.big https://raw.githubusercontent.com/fxsjy/jieba/master/extra_dict/dict.txt.big
cd ../..
npm run build-data
```

詞頻檔（`wordfreq.pkl` 等）是選用的，用來挑常用成語、排除在正常文章裡常見的寫法。沒有詞頻檔也能產生，只是成語表會比較大、少了一些排除。

## 資料來源

- 教育部《重編國語辭典修訂本》，創用 CC 姓名標示－禁止改作 3.0 臺灣版。資料取自 [g0v/moedict-data](https://github.com/g0v/moedict-data)。用來建立詞表、成語表和注音。
- [OpenCC](https://github.com/BYVoid/OpenCC) 簡繁對照表，Apache License 2.0。
- [jieba](https://github.com/fxsjy/jieba) 詞庫，MIT License。只用來補充斷詞檢查的現代詞彙。
- 錯字表另外參考了常見錯別字整理，並用 PTT 公開語料（[Gossiping-Chinese-Corpus](https://github.com/zake7749/Gossiping-Chinese-Corpus)）找出實際常打錯的字、測試誤判。語料沒有放進專案。

網站上線時，請在頁面上標示教育部辭典的出處。

## 上線

把整個專案放到一台 Node 18 以上的主機（或一個容器），執行 `npm start`。
不需要資料庫。不要只上傳 `public/`，那樣沒有檢查伺服器。`lib/data/` 也要一起上傳。
