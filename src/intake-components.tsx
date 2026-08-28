import { useId } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import {
  INTAKE_FILE_ACCEPT,
  validateIntakeFile,
  type IntakeFileValidationResult,
} from './intake-file';

export type RequirementsIntakeMode = 'guided' | 'upload';

export interface RequirementsIntakeProps {
  /** The selected source mode. Keep this in the parent so navigation is controlled. */
  mode?: RequirementsIntakeMode | null;
  /** Result from the parent, if a file has already been selected and validated. */
  fileResult?: IntakeFileValidationResult | null;
  onModeChange?: (mode: RequirementsIntakeMode) => void;
  /** Called with metadata/validation only; the File object is never forwarded. */
  onFileValidated?: (result: IntakeFileValidationResult) => void;
  /**
   * Optional local-only hand-off for a parent that parses DOCX/ODT in memory.
   * The component itself never uploads the File or sends it to an AI service.
   */
  onLocalFileSelected?: (file: File, result: IntakeFileValidationResult) => void;
  onStartGuided?: () => void;
  onConfirmUpload?: (result: IntakeFileValidationResult) => void;
  onClearFile?: () => void;
  disabled?: boolean;
  maxFileBytes?: number;
  heading?: string;
  description?: string;
}

const panelStyle: CSSProperties = {
  display: 'grid',
  gap: '1rem',
  width: '100%',
};

const optionGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))',
  gap: '0.75rem',
};

const optionStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '0.7rem',
  alignItems: 'start',
  minHeight: '8.5rem',
  padding: '1rem',
  border: '1px solid #cfd8e6',
  borderRadius: '0.75rem',
  background: '#fff',
  cursor: 'pointer',
};

const supportStyle: CSSProperties = {
  margin: 0,
  padding: '0.8rem 1rem',
  borderRadius: '0.65rem',
  background: '#f4f7fc',
  color: '#465875',
  fontSize: '0.875rem',
  lineHeight: 1.6,
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * First screen of the requirements workflow. It only chooses a source and
 * validates selected-file metadata; it does not persist state or upload data.
 */
export function RequirementsIntake({
  mode = null,
  fileResult = null,
  onModeChange,
  onFileValidated,
  onLocalFileSelected,
  onStartGuided,
  onConfirmUpload,
  onClearFile,
  disabled = false,
  maxFileBytes,
  heading = '先建立或匯入需求',
  description = '先決定您要從哪裡開始。完成需求確認後，系統才會引導您製作投標須知與契約。',
}: RequirementsIntakeProps) {
  const id = useId();
  const sourceName = `requirements-source-${id}`;
  const fileInputId = `requirements-file-${id}`;
  const fileHelpId = `requirements-file-help-${id}`;
  const filePanelId = `requirements-file-panel-${id}`;

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    // Pass only the metadata result. In particular, do not read the file or
    // pass the File object to a network/API callback from this component.
    const result = validateIntakeFile(file, { maxBytes: maxFileBytes });
    onFileValidated?.(result);
    if (result.ok) onLocalFileSelected?.(file, result);

    // Permit selecting the same file again after a validation correction.
    event.currentTarget.value = '';
  }

  const canConfirmUpload = Boolean(fileResult?.ok);

  return (
    <section className="requirements-intake" aria-labelledby={`${id}-heading`} style={panelStyle}>
      <div>
        <p className="eyebrow">需求入口</p>
        <h2 id={`${id}-heading`} style={{ margin: '0.25rem 0 0.4rem' }}>{heading}</h2>
        <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>{description}</p>
      </div>

      <fieldset className="intake-source-fieldset" disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 800, marginBottom: '0.65rem' }}>選擇需求資料來源</legend>
        <div className="intake-source-options" role="radiogroup" aria-label="需求資料來源" style={optionGridStyle}>
          <label
            className={`intake-source-option${mode === 'guided' ? ' is-selected' : ''}`}
            htmlFor={`${sourceName}-guided`}
            style={{
              ...optionStyle,
              borderColor: mode === 'guided' ? '#3d70dc' : '#cfd8e6',
              background: mode === 'guided' ? '#f5f8ff' : optionStyle.background,
            }}
          >
            <input
              id={`${sourceName}-guided`}
              type="radio"
              name={sourceName}
              value="guided"
              checked={mode === 'guided'}
              onChange={() => onModeChange?.('guided')}
            />
            <span>
              <strong>我還沒有完整的需求說明書</strong>
              <span style={{ display: 'block', marginTop: '0.35rem', color: '#5f6f87', lineHeight: 1.5 }}>
                用分段問答整理採購目的、範圍、成果、期程、驗收、付款、資格與風險。
              </span>
            </span>
          </label>

          <label
            className={`intake-source-option${mode === 'upload' ? ' is-selected' : ''}`}
            htmlFor={`${sourceName}-upload`}
            style={{
              ...optionStyle,
              borderColor: mode === 'upload' ? '#3d70dc' : '#cfd8e6',
              background: mode === 'upload' ? '#f5f8ff' : optionStyle.background,
            }}
          >
            <input
              id={`${sourceName}-upload`}
              type="radio"
              name={sourceName}
              value="upload"
              checked={mode === 'upload'}
              onChange={() => onModeChange?.('upload')}
            />
            <span>
              <strong>我已有需求說明書</strong>
              <span style={{ display: 'block', marginTop: '0.35rem', color: '#5f6f87', lineHeight: 1.5 }}>
                先在本機檢查格式，再逐項確認從文件擷取的內容；不會自動取代您的原文。
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <p className="intake-support" style={supportStyle} aria-label="檔案支援與隱私說明">
        <strong>檔案支援：</strong>DOCX、ODT 可在本機擷取文字；PDF 可附加為來源，但本版尚不自動擷取文字。舊式 .doc 請先另存為 .docx。
        <br />
        DOCX／ODT 只在這個瀏覽器分頁的記憶體中讀取；原始檔不會持久化、不會自動上傳，也不會呼叫 AI。
      </p>

      {mode === 'guided' && (
        <section className="intake-guided-panel" aria-labelledby={`${id}-guided-heading`} style={{ ...supportStyle, background: '#f8fbf8' }}>
          <h3 id={`${id}-guided-heading`} style={{ margin: '0 0 0.55rem' }}>需求引導會依序完成</h3>
          <ol style={{ margin: 0, paddingLeft: '1.35rem', lineHeight: 1.7 }}>
            <li>採購目的與要解決的問題</li>
            <li>工作範圍與不包含事項</li>
            <li>交付成果、數量、單位與格式</li>
            <li>履約期程、地點與里程碑</li>
            <li>驗收方式、標準與證明文件</li>
            <li>付款節點與請款條件</li>
            <li>廠商資格、設定理由及限制</li>
            <li>風險、保險、個資、資訊安全與保密</li>
          </ol>
          <div className="actions" style={{ marginTop: '0.9rem' }}>
            <button type="button" onClick={onStartGuided} disabled={disabled || !onStartGuided}>
              開始建立需求
            </button>
          </div>
        </section>
      )}

      {mode === 'upload' && (
        <section className="intake-upload-panel" id={filePanelId} aria-labelledby={`${id}-upload-heading`} style={panelStyle}>
          <h3 id={`${id}-upload-heading`} style={{ margin: 0 }}>選擇需求說明書</h3>
          <p id={fileHelpId} className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
            先檢查副檔名與大小；後續若要擷取內容，仍會在本機處理並要求您逐項確認。
          </p>
          <label htmlFor={fileInputId} style={{ fontWeight: 800 }}>
            需求說明書檔案
            <input
              id={fileInputId}
              type="file"
              accept={INTAKE_FILE_ACCEPT}
              aria-describedby={fileHelpId}
              onChange={handleFileChange}
              disabled={disabled}
              style={{ display: 'block', marginTop: '0.5rem' }}
            />
          </label>

          {fileResult && (
            <div
              className={`intake-file-result${fileResult.ok ? ' is-valid' : ' is-invalid'}`}
              role={fileResult.ok ? 'status' : 'alert'}
              aria-live="polite"
              style={{
                padding: '0.9rem 1rem',
                borderRadius: '0.65rem',
                background: fileResult.ok ? '#edf8f0' : '#fff3f1',
                color: fileResult.ok ? '#1c6b42' : '#7e2929',
              }}
            >
              <strong>{fileResult.ok ? '檔案格式可以進入下一步' : '檔案尚不能進入下一步'}</strong>
              <div style={{ marginTop: '0.35rem', overflowWrap: 'anywhere' }}>
                {fileResult.metadata.name || '未命名檔案'} · {formatFileSize(fileResult.metadata.size)}
              </div>
              {fileResult.issues.length > 0 && (
                <ul style={{ margin: '0.55rem 0 0', paddingLeft: '1.25rem' }}>
                  {fileResult.issues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              )}
              {fileResult.advisories.length > 0 && (
                <ul style={{ margin: '0.55rem 0 0', paddingLeft: '1.25rem' }}>
                  {fileResult.advisories.map((advisory) => <li key={advisory}>{advisory}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="actions">
            {onClearFile && (
              <button type="button" className="secondary" onClick={onClearFile} disabled={disabled || !fileResult}>
                清除選擇
              </button>
            )}
            <button
              type="button"
              onClick={() => fileResult && onConfirmUpload?.(fileResult)}
              disabled={disabled || !canConfirmUpload || !onConfirmUpload}
            >
              確認檔案並繼續
            </button>
          </div>
        </section>
      )}
    </section>
  );
}

export default RequirementsIntake;
