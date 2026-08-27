# GovProcure Assistant｜公務採購文件智慧助理

Local-first 的公務採購文件輔助系統。目標是讓一般承辦人從「只有採購需求」開始，快速整理案件資料、取得應備文件清單、套用工程會官方範本版本資訊，並在不把完整案件送往外部 LLM 的前提下產出可供後續審查的文件初稿。

> 本專案目前為 MVP。系統提供文件整理與風險提示，不取代採購、法制、主計、工程或其他專業審查。

## 核心原則

1. **Local-first**：案件資料預設存於瀏覽器 IndexedDB。
2. **Server 不保存案件內容**：MVP 無案件後端資料庫。
3. **AI 預設關閉**：外部 AI Gateway 目前直接拒絕呼叫。
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

Mapping Engine 目前只負責「欄位來源、目標欄位、官方文字 Anchor、必要性與完整度」，不會自動替承辦人決定法定招標方式、決標原則或保證金設定。這些欄位由承辦人輸入後，系統負責讓所有文件使用同一個值。

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
- [ ] 管理者 Provider 設定
- [ ] Local DLP Scanner
- [ ] Placeholder tokenization
- [ ] AI 外送內容逐次預覽
- [ ] Audit log（不保存原始機敏內容）

### Phase 4 — 全國通用
- [ ] Agency Profile
- [ ] 機關自訂附件與內控表格
- [ ] 資訊服務／技術服務／評選文件
- [ ] 歷史優良案件去識別 Skill

## 安全設計底線

- Frontend 不得直接呼叫 OpenAI / Gemini / Claude 等 API。
- 所有 AI 呼叫只能透過 `privacy.ts` 定義的 Gateway。
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
