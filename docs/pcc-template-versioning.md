# PCC Template Versioning Workflow

本文件說明工程會官方範本監測、封存與人工審查流程。

## Pipeline

```text
工程會公開索引
  ↓ pcc:watch
索引快照 + detail URL
  ↓ pcc:assets
最新正式 Word / ODT / PDF
  ↓
格式 signature 驗證
  ↓
SHA-256 + immutable binary archive
  ↓ pcc:text
ODT content.xml deterministic extraction
  ↓
immutable versioned normalized text
  + latest review text
  ↓
GitHub candidate PR
  ↓
人工閱讀 latest/*.txt diff
  ↓
人工核准後才更新 active Template Registry
```

## 為什麼以 ODT 做文字 Diff

工程會不同版本的 Word 格式不完全一致；例如最新勞務採購契約可能提供 `.doc` 而不是 `.docx`。ODT 則可直接從 ZIP 容器中的 `content.xml` deterministic 解析，適合作為跨版本文字比較的 canonical source。

normalized text 只用於版本審查，不取代官方原始檔。正式產出仍須記錄實際採用的官方版本與檔案 checksum。

## 目錄

```text
official-templates/
└── <template-id>/<ROC-version>/
    ├── <template-id>.doc 或 .docx
    ├── <template-id>.odt
    └── <template-id>.pdf

src/data/pcc-template-text/
├── versions/
│   └── <template-id>/<ROC-version>.txt
└── latest/
    └── <template-id>.txt
```

`versions` 為 immutable；同一版本若重新解析結果不同，流程直接失敗。

`latest` 是 review pointer。當工程會發布新版本時，這個檔案會被更新，因此 GitHub PR 的 Files changed 可以直接顯示舊版／新版文字差異。

## Commands

```bash
npm run pcc:watch
npm run pcc:assets
npm run pcc:text
```

只驗證 normalized text，不寫檔：

```bash
npm run pcc:text -- --dry-run
```

## Token 成本

此流程完全 deterministic：HTML parsing、binary signature validation、SHA-256、ODT XML extraction 與 Git diff 均不使用 LLM，正常監測成本為 0 AI token。

LLM 只應用在後續「變更摘要／風險解讀」等選配層，而且只能讀取公開官方 normalized text，不得帶入採購案件機敏內容。
