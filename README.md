# GovProcure Assistant｜公務採購文件智慧助理

Local-first 的公務採購文件輔助系統。目標是讓一般承辦人從「只有採購需求」開始，快速整理案件資料、取得應備文件清單、套用工程會官方範本版本資訊，並在不把完整案件送往外部 LLM 的前提下產出可供後續審查的文件初稿。

> 本專案目前為 MVP。系統提供文件整理與風險提示，不取代採購、法制、主計、工程或其他專業審查。

## 核心原則

1. **Local-first**：案件資料預設存於瀏覽器 IndexedDB。
2. **Server 不保存案件內容**：MVP 無案件後端資料庫。
3. **AI 預設關閉**：外部 AI Gateway 目前直接拒絕呼叫。
4. **敏感資料不可外送**：底價、評選委員、議價、內部簽核等 RESTRICTED 資料硬性阻擋。
5. **規則優先於 Prompt**：文件清單與檢核使用 deterministic TypeScript Rule Engine。
6. **官方範本不可覆寫**：未來 PCC Watcher 下載新版後先進入 `candidate`，人工核准才可成為 `active`。
7. **單一資料來源**：案件欄位以 `ProcurementCase` 為唯一資料來源，避免跨文件不一致。

## 已完成 MVP 功能

- 建立／編輯／刪除採購案件
- IndexedDB 本機儲存（Dexie）
- 勞務／財物／工程基本文件清單判斷
- 案件完整度評分
- 人工確認與風險警示
- Security Level：PUBLIC / INTERNAL / SENSITIVE / RESTRICTED
- Privacy Gateway 與敏感內容偵測
- 預覽「若啟用 AI」實際可外送的去敏感內容
- 工程會範本 Registry 種子資料
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

## 專案結構

```text
src/
├── App.tsx          # MVP workflow / UI
├── db.ts            # IndexedDB / Dexie
├── export.ts        # 本機 DOCX / JSON 匯出
├── privacy.ts       # DLP / AI Gateway policy
├── rules.ts         # deterministic procurement rules
├── templates.ts     # PCC template registry seed
├── types.ts         # ProcurementCase schema
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
```

## PCC Template Watcher 規劃

正式版會建立獨立 `pcc-template-sync` 模組：

```text
工程會官方清單
   ↓
抓取文件名稱＋最近更新日期
   ↓
下載官方檔案
   ↓
SHA-256 比對
   ↓
candidate version
   ↓
舊版／新版 Diff
   ↓
管理者核准
   ↓
active
```

每一份正式產出文件都必須記錄使用的官方範本版本，不覆蓋歷史版本。

## 下一階段 TODO

### Phase 1 — 完成一般勞務 Happy Path
- [ ] 正式 PCC Template Watcher
- [ ] 下載並版本化官方 DOCX/ODT/PDF
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

## 官方來源

工程會「招標相關文件及表格」：

https://www.pcc.gov.tw/content/index?eid=10146&lang=1&type=C

---

Private MVP — 尚未開放一般使用者正式辦理採購案件。