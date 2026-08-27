# GovProcure Assistant｜公務採購文件智慧助理

Local-first 的公務採購文件輔助系統。目標是讓一般承辦人從「只有採購需求」開始，快速整理案件資料、取得應備文件清單、套用工程會官方範本版本資訊，並在不把完整案件送往外部 LLM 的前提下產出可供後續審查的文件初稿。

> 本專案目前為 MVP。系統提供文件整理與風險提示，不取代採購、法制、主計、工程或其他專業審查。

## 核心原則

1. **Local-first**：案件資料預設存於瀏覽器 IndexedDB。
2. **Server 不保存案件內容**：MVP 無案件後端資料庫。
3. **AI 明確選擇加入**：使用者自行輸入 Gemini API Key 並驗證後才會啟用；Key 不進案件資料或持久化儲存。
4. **敏感資料不可外送**：底價、評選委員、議價、內部簽核等 RESTRICTED 資料硬性阻擋。
5. **規則優先於 Prompt**：文件清單、版本比對、Mapping 與檢核均採 deterministic workflow。
6. **官方範本不可覆寫**：PCC Watcher 只產生 candidate；人工核准後才可更新 active Registry。
7. **官方檔案不可靜默漂移**：同一 ROC 版本若 SHA-256 改變，Watcher 直接失敗並要求人工調查。
8. **單一資料來源**：案件欄位以 `ProcurementCase` 為唯一資料來源，所有文件 mapping 都由同一份 canonical context 產生。

## 已完成 MVP 功能

- 建立／編輯／刪除採購案件
- IndexedDB 本機儲存（Dexie）
- 勞務／財物／工程基本文件清單判斷
- 案件完整度評分
- 人工確認與風險警示
- Security Level：PUBLIC / INTERNAL / SENSITIVE / RESTRICTED
- Privacy Gateway 與敏感內容偵測
- 預覽「若啟用 AI」實際可外送的去敏感內容
- 使用者自備 Gemini API Key（僅保留在目前頁面記憶體）
- 由 Gemini Models API 自動選擇最新穩定文字 Flash，命名無法辨識時改用官方 latest 別名
- Gemini 案件缺漏檢核（只回傳建議，不自動修改案件或法定選項）
- Gemini 履約草稿（付款、驗收、廠商資格、交付成果及不含價格的標價項目；預覽後只套用空白欄位）
- 依採購金額、採購類型與前置選擇連動的招標／決標下拉選單、法源說明及人工確認建議
- 工程會 active Template Registry
- PCC 官方索引快照與版本日期比對
- PCC 核心範本 detail page 解析
- 核心範本 Word（DOCX/DOC）/ ODT / PDF 自動下載與檔案簽章驗證
- SHA-256 manifest 與 immutable 歷史版本目錄
- ODT canonical text 正規化與 human-readable Git Diff baseline
- GitHub Actions 工作日自動檢查 PCC 索引、官方檔案與 normalized text
- 發現更新時建立／刷新 candidate PR，不自動升版
- Canonical Template Field Mapping Engine
- 投標須知與各採購契約的 mapping coverage 預覽
- 招標方式、決標原則、決標方式、押標金、履約保證金、契約價金計算方式等跨文件共用欄位
- 基本 Cross-document consistency check
- 匯出案件 JSON 備份
- 本機產生 DOCX 案件設定、文件檢核與 Mapping audit
- RWD 手機／桌面介面

## 開始使用

```bash
npm install
npm run dev
```

正式建置：

```bash
npm run build
npm run preview
```

更新 PCC 資料：

```bash
npm run pcc:watch
npm run pcc:assets
npm run pcc:text
```

只驗證 normalized text、不寫入檔案：

```bash
npm run pcc:text -- --dry-run
```

## 專案結構

```text
.github/workflows/
├── ci.yml                    # Build / watcher / text parser verification
└── pcc-template-watcher.yml  # PCC 索引＋官方檔案＋normalized text 監測

scripts/
├── pcc-watcher.mjs           # 抓取索引、文件名稱、日期、detail URL
├── pcc-assets.mjs            # 下載核心範本、驗證格式、SHA-256、immutable archive
└── pcc-text.mjs              # ODT content.xml → canonical normalized text

official-templates/
└── <template-id>/
    └── <ROC-version>/
        ├── <template-id>.docx 或 .doc
        ├── <template-id>.odt
        └── <template-id>.pdf

src/
├── data/
│   ├── pcc-template-index.json
│   ├── pcc-template-assets.json
│   ├── pcc-template-text.json
│   └── pcc-template-text/
│       ├── latest/           # 供 GitHub PR 顯示新舊文字 diff
│       └── versions/         # immutable normalized text history
├── App.tsx
├── db.ts
├── export.ts
├── mapping.ts                # ProcurementCase → 官方範本欄位 mapping
├── pcc.ts
├── privacy.ts
├── rules.ts
├── templates.ts
├── types.ts
├── main.tsx
└── styles.css
```

## 案件與文件資料流

```text
使用者只填一次
  ↓
ProcurementCase (single source of truth)
  ↓
Canonical Document Context
  ├─ 投標須知 Mapping
  ├─ 勞務契約 Mapping
  ├─ 財物契約 Mapping
  ├─ 工程契約 Mapping
  └─ Cross-document consistency check
  ↓
Mapping coverage / 缺漏欄位
  ↓
後續 Template Writer 寫入官方範本
```

Mapping Engine 目前只負責「欄位來源、目標欄位、官方文字 Anchor、必要性與完整度」。規則模組會依金額與採購類型縮小合法候選選項並提出建議，但不會替承辦人自動選定法定招標方式、決標原則或保證金設定；使用者確認後，系統才讓所有文件使用同一個值。

## 採購程序關聯規則

- 目前內建的是中央機關基準：15 萬元以下為小額採購；逾 15 萬元、未達 150 萬元原則依採購法第 49 條公開取得書面報價或企劃書；150 萬元以上原則公開招標。門檻來源：[工程會公告](https://www.pcc.gov.tw/content/index?eid=3950&lang=1&ltype=N&nn=E7BDAFCB081133B5&sms=53E09032BF601A56)。
- 例如 50 萬元勞務採購，系統建議「公開取得書面報價或企劃書」；若成果品質具有差異，另建議承辦人評估「參考最有利標精神」，但不會自動選取或把它當成正式最有利標。
- 選擇性招標、限制性招標、正式／準用最有利標與複數決標均顯示法定條件或人工敘明提醒。依據：[政府採購法](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0030057)、[中央機關未達公告金額採購招標辦法](https://www.pcc.gov.tw/content/cp.aspx?n=C3B971E6865398D9)。
- 地方機關仍須先確認直轄市或縣（市）的另定規定；所有建議都只是決策輔助，使用者必須從下拉選單確認後才會視為完成。

## PCC Template Watcher

```text
工程會官方索引
   ↓
detail page
   ↓
Word / ODT / PDF
   ↓
signature validation + SHA-256
   ↓
immutable archive
   ↓
ODT content.xml
   ↓
normalized text
   ↓
Git Diff
   ↓
candidate PR
   ↓
人工確認
   ↓
active Template Registry
```

Watcher 每週一至週五自動執行，也可從 GitHub Actions 手動執行。它只讀取工程會公開資料，不讀取 IndexedDB、案件內容或任何機敏資料。

## 下一階段 TODO

### Phase 1 — 完成一般勞務 Happy Path
- [x] PCC 官方索引監測與 candidate PR
- [x] 下載並版本化核心官方 Word/ODT/PDF
- [x] SHA-256 immutable manifest
- [x] 舊版／新版 human-readable 文件內容 Diff pipeline
- [x] 官方範本欄位 Mapping Engine
- [x] 基本 Cross-document consistency checker
- [ ] Anchor Resolver：將 Mapping 定位到實際 DOCX/ODT XML 節點
- [ ] 產出真正的投標須知初稿
- [ ] 產出勞務採購契約初稿
- [ ] 需求規格書產生器
- [ ] 標價清單 XLSX
- [ ] 完整跨文件一致性驗證

### Phase 2 — 財物採購
- [ ] 財物契約實際欄位寫入
- [ ] 規格對照表
- [ ] 驗收與保固規則

### Phase 3 — Privacy-first AI Assist
- [x] 使用者自備 Gemini API Key
- [x] Gemini 最新穩定 Flash 自動探索與 latest alias fallback
- [x] Local DLP Scanner（白名單 context＋敏感詞阻擋）
- [x] 結構化履約與標價項目草稿（人工預覽、只填空白欄位、不產生價格）
- [ ] Placeholder tokenization
- [x] AI 外送內容逐次預覽
- [ ] Audit log（不保存原始機敏內容）

### Phase 4 — 全國通用
- [ ] Agency Profile
- [ ] 機關自訂附件與內控表格
- [ ] 資訊服務／技術服務／評選文件
- [ ] 歷史優良案件去識別 Skill

## Gemini BYOK 使用方式

1. 使用者在頁面「機敏資料控管」區貼上自己的 Gemini API Key。
2. 系統以 `x-goog-api-key` header 驗證 Key，Key 不放在網址、請求本文或 log。
3. 系統從 `models.list` 回傳結果選擇最高版本的穩定文字 Flash；若未來命名規則改變，才使用 `gemini-flash-latest`。
4. Key 只存在目前 React 頁面的記憶體；重新整理、關閉頁面或按「清除」後即消失，不寫入 IndexedDB、JSON、DOCX、XLSX 或 ZIP。
5. 每次外送前仍會經過 `privacy.ts` 白名單與敏感內容檢查；AI 結果先以結構化草稿預覽，只有使用者按下「套用到空白欄位」才會寫入，既有內容不會被覆蓋。
6. 標案名稱、機關名稱、預算、底價、內部備註與預估單價都不會送給 Gemini；AI 也不得產生底價、保額、單價或法定招決標選項。

Google 官方仍建議正式產品使用後端代理保護 API Key。GitHub Pages 是純靜態網站，本專案採用的是「使用者自備 Key、明確知情、當頁記憶體保存」模式；請建立專用 Key、限制用途並設定用量／帳務警示。參考：[Gemini API Key 安全說明](https://ai.google.dev/gemini-api/docs/api-key)。

## 安全設計底線

- 所有 Gemini 呼叫只能透過 `privacy.ts` 定義的 Gateway；UI 不得直接傳送完整 `ProcurementCase`。
- GitHub Pages 不得內建或共用開發者 API Key；BYOK Key 不得持久化、匯出、寫入 URL 或記錄。
- `ProcurementCase` 不得整包送往外部 LLM。
- `reservePrice`、`internalNotes` 永遠不得進入 AI context。
- SENSITIVE / RESTRICTED 案件預設禁止外部 AI。
- 工程會官方範本版本必須 immutable。
- PCC Watcher 只能建立 candidate 更新，不能自動修改 active Registry。
- 同一官方版本若內容 hash 發生漂移，必須人工調查，不可自動接受。
- Mapping Engine 不得自行推定招標方式、決標原則、押標金或履約保證金等需承辦判斷之欄位。

## 官方來源

工程會「招標相關文件及表格」：

https://www.pcc.gov.tw/content/index?eid=10146&lang=1&type=C

## GitHub Pages 公開 Beta

本專案可部署為 `https://harry5450.github.io/gov-procurement-assistant/`。Pages 版本只定位為公開 Beta，請勿輸入正式機敏採購資料。

1. 在 GitHub repository 的 **Settings → Pages**，將 Source 設為 **GitHub Actions**。
2. 合併或 push 到 `main` 後，CI 會先執行 PCC 文字驗證、範本 Anchor audit、Writer smoke test 與 Pages production build。
3. 驗證全部通過後，`deploy` job 才會發布 `dist/`。

本機驗證 Pages 子路徑建置：

```bash
npm ci
npm run build:pages
```

一般本機開發仍使用根路徑：

```bash
npm run dev
```

案件只儲存在目前瀏覽器的 IndexedDB；清除網站資料、使用無痕模式或更換裝置都可能造成案件遺失。GitHub Pages 不提供帳號登入、集中備份或機關內部存取控制。

---

Private MVP — 尚未開放一般使用者正式辦理採購案件。
