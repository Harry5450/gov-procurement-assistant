# GovProcure Assistant｜公務採購文件智慧助理

Local-first 的公務採購文件輔助系統。目標是讓一般承辦人從「只有採購需求」開始，快速整理案件資料、取得應備文件清單、套用工程會官方範本版本資訊，並在不把完整案件送往外部 LLM 的前提下產出可供後續審查的文件初稿。

> 本專案目前為 MVP。系統提供文件整理與風險提示，不取代採購、法制、主計、工程或其他專業審查。

## 核心原則

1. **Local-first**：案件資料預設存於瀏覽器 IndexedDB。
2. **Server 不保存案件內容**：MVP 無案件後端資料庫。
3. **AI 預設關閉**：外部 AI Gateway 目前直接拒絕呼叫。
4. **敏感資料不可外送**：底價、評選委員、議價、內部簽核等 RESTRICTED 資料硬性阻擋。
5. **規則優先於 Prompt**：文件清單與檢核使用 deterministic TypeScript Rule Engine。
6. **官方範本不可覆寫**：PCC Watcher 只產生 candidate；人工核准後才可更新 active Registry。
7. **官方檔案不可靜默漂移**：同一 ROC 版本若 SHA-256 改變，Watcher 直接失敗並要求人工調查。
8. **單一資料來源**：案件欄位以 `ProcurementCase` 為唯一資料來源，避免跨文件不一致。

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
- 核心範本 DOCX / ODT / PDF 自動下載與檔案簽章驗證
- SHA-256 manifest 與 immutable 歷史版本目錄
- GitHub Actions 工作日自動檢查 PCC 索引與官方檔案
- 發現更新時建立／刷新 candidate PR，不自動升版
- 匯出案件 JSON 備份
- 本機產生 DOCX 案件設定與文件檢核表
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

手動更新 PCC 官方索引：

```bash
npm run pcc:watch
```

下載與驗證核心官方範本：

```bash
npm run pcc:assets
```

只驗證、不寫入檔案：

```bash
npm run pcc:assets -- --dry-run
```

## 專案結構

```text
.github/workflows/
├── ci.yml                    # Build / watcher syntax verification
└── pcc-template-watcher.yml  # PCC 公開索引＋官方檔案監測

scripts/
├── pcc-watcher.mjs           # 抓取索引、文件名稱、日期、detail URL
└── pcc-assets.mjs            # 下載核心範本、驗證格式、SHA-256、immutable archive

official-templates/
└── <template-id>/
    └── <ROC-version>/
        ├── <template-id>.docx
        ├── <template-id>.odt
        └── <template-id>.pdf

src/
├── data/
│   ├── pcc-template-index.json   # 最近確認的 PCC 公開索引快照
│   └── pcc-template-assets.json  # 官方檔案 hash / path / URL manifest
├── App.tsx
├── db.ts
├── export.ts
├── pcc.ts                        # active Registry、索引、archive manifest 比對
├── privacy.ts
├── rules.ts
├── templates.ts                  # 人工核准的 active Registry
├── types.ts
├── main.tsx
└── styles.css
```

## 資料流

```text
使用者
  ↓
React Web App
  ↓
ProcurementCase (single source of truth)
  ├─ IndexedDB（本機）
  ├─ Rule Engine（0 token）
  ├─ Document Export（本機）
  └─ Privacy Gateway
       └─ External LLM（預設關閉，只允許 SanitizedAIContext）

工程會公開網站
  ↓
PCC Index Watcher
  ↓
文件 detail page
  ↓
DOCX / ODT / PDF
  ↓
格式簽章驗證 + SHA-256
  ↓
official-templates/<id>/<ROC-version>/
  ↓
manifest
  ↓
若有新增／變更 → candidate PR
  ↓
人工確認
  ↓
active Template Registry
```

## PCC Template Watcher

目前包含兩層：

### 1. 索引監測層

```text
工程會官方清單
   ↓
抓取文件名稱＋最近更新日期＋detail URL
   ↓
Parser safety check
   ↓
Repo Snapshot
```

### 2. 官方檔案封存層

```text
核心範本 detail page
   ↓
辨識最新正式範本版本
   ↓
下載 DOCX / ODT / PDF
   ↓
檔案 signature validation
   ↓
SHA-256
   ↓
若版本不存在 → 新增 immutable 版本目錄
若同版本 hash 不同 → FAIL，禁止自動覆寫
   ↓
candidate PR
```

Watcher 每週一至週五自動執行，也可從 GitHub Actions 手動執行。當 watcher 程式或 workflow 合併到 `main` 時也會執行一次初始化檢查。它只讀取工程會公開資料，不讀取 IndexedDB、案件內容或任何機敏資料。

目前先封存 4 個核心範本：投標須知、工程採購契約、財物採購契約、勞務採購契約。後續可擴充其他工程會範本。

## 下一階段 TODO

### Phase 1 — 完成一般勞務 Happy Path
- [x] PCC 官方索引監測與 candidate PR
- [x] 下載並版本化核心官方 DOCX/ODT/PDF
- [x] SHA-256 immutable manifest
- [ ] 舊版／新版文件內容 Diff
- [ ] 官方範本欄位 mapping
- [ ] 產出真正的投標須知初稿
- [ ] 產出勞務採購契約初稿
- [ ] 需求規格書產生器
- [ ] 標價清單 XLSX
- [ ] Cross-document consistency checker

### Phase 2 — 財物採購
- [ ] 財物契約 mapping
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

## 官方來源

工程會「招標相關文件及表格」：

https://www.pcc.gov.tw/content/index?eid=10146&lang=1&type=C

---

Private MVP — 尚未開放一般使用者正式辦理採購案件。
