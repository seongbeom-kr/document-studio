import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  MAIL_MERGE_DRAFT_NAME,
  MAIL_MERGE_LIMITS,
  parseMailMergeData,
  serializeDelimited,
  type MailMergeTemplateInfo,
  type MailMergePreview,
  type MailMergeRequest,
  type EditorSnapshot,
  type createMailMergeSession,
} from "@document-studio/core";
import type {
  AutomationSession,
  AutomationDraftStatus,
} from "./automation-session";
import { GeneratedOutputActions } from "./generated-output-actions";

function download(bytes: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: mime }),
    ),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
interface Settings {
  mapping: Record<string, string>;
  fileNamePattern: string;
  allowEmpty: boolean;
  sourceName: string;
}
function readSettings(value: string): Settings {
  if (!value)
    return {
      mapping: {},
      fileNamePattern: "문서-{{#}}.docx",
      allowEmpty: false,
      sourceName: "",
    };
  const parsed: unknown = JSON.parse(value),
    record = parsed as Settings;
  if (
    !record ||
    typeof record !== "object" ||
    !record.mapping ||
    typeof record.mapping !== "object" ||
    Array.isArray(record.mapping) ||
    Object.entries(record.mapping).some(
      ([key, value]) =>
        typeof value !== "string" || key.length > 64 || value.length > 100,
    ) ||
    typeof record.fileNamePattern !== "string" ||
    typeof record.allowEmpty !== "boolean" ||
    typeof record.sourceName !== "string"
  )
    throw new Error(
      "보관한 필드 설정을 읽지 못했습니다. 입력을 내려받은 뒤 필드 설정을 초기화해 주세요.",
    );
  return record;
}
export function MailMergeTools({
  actions,
  registerCurrent,
  session,
  draftStatus,
  snapshot,
  disabled,
  readOnly,
}: {
  actions: ReturnType<typeof createMailMergeSession>;
  registerCurrent: () => Promise<MailMergeTemplateInfo>;
  session: AutomationSession;
  draftStatus: AutomationDraftStatus;
  snapshot: EditorSnapshot;
  disabled: boolean;
  readOnly?: boolean;
}) {
  const status = useSyncExternalStore(
    actions.subscribe,
    actions.getSnapshot,
    actions.getSnapshot,
  );
  const [templates, setTemplates] = useState<MailMergeTemplateInfo[]>([]),
    [selected, setSelected] = useState("");
  const [input, setInput] = useState(
      () => session.get(MAIL_MERGE_DRAFT_NAME).input,
    ),
    [delimiter, setDelimiter] = useState<MailMergeRequest["delimiter"]>(
      () =>
        session.get(MAIL_MERGE_DRAFT_NAME)
          .delimiter as MailMergeRequest["delimiter"],
    );
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return readSettings(session.get(MAIL_MERGE_DRAFT_NAME).argument);
    } catch {
      return readSettings("");
    }
  });
  const [settingsError, setSettingsError] = useState(() => {
    try {
      readSettings(session.get(MAIL_MERGE_DRAFT_NAME).argument);
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  const [preview, setPreview] = useState<MailMergePreview | null>(null),
    [notice, setNotice] = useState(""),
    [working, setWorking] = useState(false);
  const running = useRef(false),
    alive = useRef(true),
    fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!snapshot.ready) return;
    try {
      const value = actions.list();
      setTemplates(value);
      setSelected((old) =>
        value.some((t) => t.templateId === old)
          ? old
          : (value[0]?.templateId ?? ""),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [actions, status, snapshot.ready]);
  // Agent previews and recovery updates use this same owner-scoped draft store.
  useEffect(() => {
    if (!draftStatus.ready) return;
    const draft = session.get(MAIL_MERGE_DRAFT_NAME);
    setInput(draft.input);
    setDelimiter(draft.delimiter as MailMergeRequest["delimiter"]);
    try {
      setSettings(readSettings(draft.argument));
      setSettingsError("");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error));
    }
  }, [session, draftStatus]);
  const source = templates.find((t) => t.templateId === selected);
  let headers: string[] = [],
    dataError = "";
  if (input.trim())
    try {
      headers = parseMailMergeData(input, delimiter).headers;
    } catch (error) {
      dataError = error instanceof Error ? error.message : String(error);
    }
  const edit = (data = input, next = settings, separator = delimiter) => {
    setInput(data);
    setSettings(next);
    setDelimiter(separator);
    setPreview(null);
    setNotice("");
    session.put(
      MAIL_MERGE_DRAFT_NAME,
      {
        input: data,
        argument: JSON.stringify(next),
        delimiter: separator,
        transform: "trim",
      },
      { activate: false },
    );
  };
  const run = async (task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setWorking(true);
    setNotice("");
    try {
      await task();
    } catch (error) {
      if (alive.current)
        setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      running.current = false;
      if (alive.current) setWorking(false);
    }
  };
  const choose = (template: MailMergeTemplateInfo) => {
    setSelected(template.templateId);
    const mapping = Object.fromEntries(
      template.fields.map((field) => [
        field,
        headers.includes(settings.mapping[field] ?? "")
          ? settings.mapping[field]!
          : headers.includes(field)
            ? field
            : "",
      ]),
    );
    edit(input, {
      ...settings,
      mapping,
      sourceName: template.fileName,
      fileNamePattern:
        settings.fileNamePattern.replace(/\.(docx|hwpx)$/i, "") +
        `.${template.format}`,
    });
  };
  const busy = disabled || working || status.phase === "running",
    blocked =
      busy || !draftStatus.ready || !!draftStatus.error || !!settingsError;
  const stale = !!preview && preview.revision !== snapshot.revision;
  return (
    <section
      className="ds-mail-merge ds-tools-panel"
      aria-label="서식 메일머지"
    >
      <h3>서식 등록과 메일머지</h3>
      <p>
        문서에 <code>{"{{이름}}"}</code> 같은 필드를 넣고 데이터 열과
        연결합니다. 원본 서식을 유지한 새 파일을 최대{" "}
        {MAIL_MERGE_LIMITS.records}개 생성합니다.
      </p>
      <p className="ds-muted">
        등록한 서식과 생성 파일은 현재 편집 세션에 보관됩니다. 입력 데이터·필드
        연결은 이 앱의 자동화 초안 정책을 따르며, 재열기 후에는 서식 파일을 다시
        선택해야 합니다.
      </p>
      {!draftStatus.ready && (
        <p role="status">
          자동화 초안 복구를 먼저 완료해 주세요. 업무 자동화 탭에서 오류를
          확인할 수 있습니다.
        </p>
      )}
      {draftStatus.error && <p role="alert">{draftStatus.error}</p>}
      {settingsError && (
        <p role="alert">
          {settingsError}
          <button
            type="button"
            className="ds-button"
            onClick={() => {
              setSettingsError("");
              edit(input, readSettings(""));
            }}
          >
            필드 설정 초기화
          </button>
        </p>
      )}
      <div className="ds-quick-buttons">
        <button
          type="button"
          className="ds-button"
          disabled={blocked || !snapshot.ready}
          onClick={() =>
            void run(async () => {
              const value = await registerCurrent();
              if (alive.current) {
                setTemplates(actions.list());
                choose(value);
              }
            })
          }
        >
          현재 편집본을 서식으로 등록
        </button>
        <button
          type="button"
          className="ds-button"
          disabled={blocked}
          onClick={() => fileInput.current?.click()}
        >
          서식 파일 선택
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".docx,.hwpx"
          aria-label="메일머지 서식 파일"
          disabled={blocked}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file || blocked) return;
            void run(async () => {
              const format = /\.hwpx$/i.test(file.name)
                ? "hwpx"
                : /\.docx$/i.test(file.name)
                  ? "docx"
                  : undefined;
              if (!format || file.size > MAIL_MERGE_LIMITS.sourceBytes)
                throw new Error(
                  "8 MiB 이하의 DOCX 또는 HWPX 서식을 선택하세요.",
                );
              const bytes = new Uint8Array(await file.arrayBuffer());
              if (!alive.current) return;
              const value = await actions.register({
                id: crypto.randomUUID(),
                fileName: file.name,
                format,
                bytes,
              });
              if (alive.current) {
                setTemplates(actions.list());
                choose(value);
              }
            });
          }}
        />
      </div>
      <div className="ds-tools-row">
        <label>
          등록한 서식
          <select
            aria-label="메일머지 등록한 서식"
            value={selected}
            disabled={blocked}
            onChange={(event) => {
              const template = templates.find(
                (t) => t.templateId === event.target.value,
              );
              if (template) choose(template);
            }}
          >
            <option value="">서식을 선택하세요</option>
            {templates.map((template) => (
              <option key={template.templateId} value={template.templateId}>
                {template.fileName}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ds-button"
          disabled={blocked || !source}
          onClick={() => {
            if (source) {
              actions.remove(source.templateId);
              setPreview(null);
              setSelected("");
            }
          }}
        >
          서식 등록 해제
        </button>
      </div>
      {!source && settings.sourceName && (
        <p role="status">
          이전 서식: {settings.sourceName}. 계속하려면 해당 파일을 다시
          선택하거나 현재 편집본을 등록하세요.
        </p>
      )}
      {source && (
        <details>
          <summary>
            서식 필드 {source.fields.length}개 · 위치 {source.locations.length}
            곳
          </summary>
          <ul>
            {source.locations.map((location, i) => (
              <li key={i}>
                {location.field}: {location.address}
              </li>
            ))}
          </ul>
          {source.issues.map((text, i) => (
            <p role="alert" key={i}>
              {text}
            </p>
          ))}
        </details>
      )}
      <fieldset disabled={blocked}>
        <legend>데이터와 필드 연결</legend>
        <div className="ds-tools-row">
          <label>
            열 구분
            <select
              aria-label="메일머지 열 구분"
              value={delimiter}
              onChange={(event) =>
                edit(input, settings, event.target.value as typeof delimiter)
              }
            >
              <option value="auto">자동</option>
              <option value=",">CSV</option>
              <option value={"\t"}>TSV</option>
            </select>
          </label>
          <button
            type="button"
            className="ds-button"
            disabled={!source || !!input}
            onClick={() => {
              if (source) {
                const fields = [...source.fields];
                edit(
                  serializeDelimited(
                    [fields, fields.map((_, i) => `예시 ${i + 1}`)],
                    ",",
                  ),
                  {
                    ...settings,
                    mapping: Object.fromEntries(
                      fields.map((field) => [field, field]),
                    ),
                  },
                  ",",
                );
              }
            }}
          >
            빈 입력에 예제 채우기
          </button>
        </div>
        <label>
          입력 데이터
          <textarea
            aria-label="메일머지 입력 데이터"
            value={input}
            rows={7}
            onChange={(event) => edit(event.target.value)}
            placeholder={"이름,소속\n홍길동,기획팀"}
          />
        </label>
        <p className="ds-muted">
          첫 행은 데이터 열 이름입니다. 사번·날짜·앞자리 0도 원래 문자열로
          유지합니다.
        </p>
        {dataError && <p role="status">{dataError}</p>}
        <div className="ds-mail-mapping">
          {source?.fields.map((field) => (
            <label key={field}>
              {field}
              <select
                aria-label={`필드 ${field} 데이터 열`}
                value={settings.mapping[field] ?? ""}
                onChange={(event) =>
                  edit(input, {
                    ...settings,
                    mapping: {
                      ...settings.mapping,
                      [field]: event.target.value,
                    },
                  })
                }
              >
                <option value="">연결할 열 선택</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <label>
          출력 파일 이름
          <input
            aria-label="메일머지 출력 파일 이름"
            value={settings.fileNamePattern}
            onChange={(event) =>
              edit(input, { ...settings, fileNamePattern: event.target.value })
            }
          />
        </label>
        <p className="ds-muted">
          예: {`안내문-{{이름}}-{{#}}.${source?.format ?? "docx"}`} · {"{{#}}"}
          는 순번입니다.
        </p>
        <label className="ds-check">
          <input
            type="checkbox"
            checked={settings.allowEmpty}
            onChange={(event) =>
              edit(input, { ...settings, allowEmpty: event.target.checked })
            }
          />
          빈 값 허용 (미리보기에 표시)
        </label>
        <button
          type="button"
          className="ds-button"
          disabled={!source || !input}
          onClick={() => {
            setNotice("");
            try {
              setPreview(
                actions.preview({
                  templateId: source!.templateId,
                  data: input,
                  delimiter,
                  mapping: settings.mapping,
                  fileNamePattern: settings.fileNamePattern,
                  allowEmpty: settings.allowEmpty,
                }),
              );
            } catch (error) {
              setPreview(null);
              setNotice(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          메일머지 미리보기
        </button>
      </fieldset>
      <button
        type="button"
        className="ds-button"
        onClick={() => {
          download(
            new TextEncoder().encode(
              JSON.stringify(session.get(MAIL_MERGE_DRAFT_NAME), null, 2),
            ),
            "메일머지-입력.json",
            "application/json",
          );
          setNotice("입력 데이터와 필드 설정의 다운로드를 요청했습니다.");
        }}
      >
        입력·필드 설정 내려받기
      </button>
      {preview && (
        <div className="ds-mail-preview" aria-label="메일머지 결과 미리보기">
          <strong>
            {preview.template.fileName} → 새 파일 {preview.files.length}개
          </strong>
          {!!preview.issues.length && (
            <ul role="alert">
              {preview.issues.map((item, i) => (
                <li key={i}>
                  {item.row ? `${item.row}행 ` : ""}
                  {item.field ? `${item.field}: ` : ""}
                  {item.message}
                </li>
              ))}
            </ul>
          )}
          {!!preview.emptyValues.length && (
            <p>
              빈 값:{" "}
              {preview.emptyValues
                .map((item) => `${item.row}행 ${item.field}`)
                .join(", ")}
            </p>
          )}
          <div className="ds-mail-table-scroll">
            <table aria-label="생성할 파일과 필드 값">
              <thead>
                <tr>
                  <th>데이터 행</th>
                  <th>파일 이름</th>
                  {preview.template.fields.map((field) => (
                    <th key={field}>{field}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.files.map((file) => (
                  <tr key={file.row}>
                    <th>{file.row}행</th>
                    <td>{file.fileName}</td>
                    {preview.template.fields.map((field) => (
                      <td key={field}>{file.values[field] || "(빈 값)"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            모든 파일이 생성돼야 결과를 공개합니다. 생성은 서버 저장이 아니며
            다운로드 후 사용합니다.
          </p>
          {stale && (
            <p role="status">문서가 변경됐습니다. 다시 미리보기해 주세요.</p>
          )}
          <button
            type="button"
            className="ds-button"
            disabled={blocked || readOnly || stale || !!preview.issues.length}
            onClick={() =>
              void run(async () => {
                await actions.generate({
                  previewId: preview.previewId,
                  operationId: `mail-ui:${preview.previewId}`,
                });
                if (alive.current) {
                  setPreview(null);
                  setNotice(
                    "새 문서를 생성했습니다. 결과를 내려받아 주세요. 서버에는 저장하지 않았습니다.",
                  );
                }
              })
            }
          >
            확인한 {preview.files.length}개 문서 생성
          </button>
        </div>
      )}
      {(status.phase === "failed" || status.phase === "cancelled") && (
        <p role="status">이번 생성 결과는 모두 폐기했습니다. {status.error}</p>
      )}
      <GeneratedOutputActions
        status={status}
        controller={{
          exportMailMergeArchive: actions.archive,
          noteMailMergeDownload: actions.noteDownload,
          acknowledgeMailMergeDelivery: actions.acknowledgeDelivery,
          discardMailMergeResults: actions.discardResults,
          cancelMailMerge: actions.cancel,
        }}
        onError={(error) => setNotice(error.message)}
      />
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
