import { useId, useState, useLayoutEffect, useRef } from "react";
import { AUTOMATION_FIELD_LIMIT } from "./automation-validation";
import { downloadAutomationDraft } from "./automation-drafts";
import { TemplatePreview } from "./template-preview";
import {
  AutomationSession,
  type AutomationDraftStatus,
  type AutomationDraft,
} from "./automation-session";
import {
  formatAccountingAmount,
  formatOfficeDate,
  ageOn,
  datePeriod,
  safeCalculate,
  parseDelimited,
  serializeDelimited,
  transformCells,
  percentageAnalysis,
  reverseTotals,
  consolidateRows,
  sortByOrganization,
  markdownTemplate,
  meetingTemplate,
  organizationTemplate,
  buildReportPrompt,
  buildChartSvg,
  buildOrganizationSvg,
  drawNames,
  assignTeams,
  OFFICE_AUTOMATION_FORMS,
  type CellTransform,
  type DocumentTemplate,
  type EditorCommand,
  type EditorDocument,
} from "@document-studio/core";
interface Props {
  creationContext?: unknown;
  session?: AutomationSession;
  draftStatus?: AutomationDraftStatus;
  execute(command: EditorCommand): Promise<void>;
  createDocument?(template: DocumentTemplate): Promise<EditorDocument>;
  onCreateDocument?(document: EditorDocument): void | Promise<void>;
  onError(error: Error): void;
  disabled: boolean;
  format?: string;
  saveLocation?: string;
}
const UTILITIES = [
  "금액 한글화",
  "날짜 변환",
  "만 나이",
  "기간 계산",
  "산출근거 계산",
  "표 데이터 정리",
  "비율 분석",
  "역합계",
  "자료 취합",
  "직제순 정렬",
  "마크다운 보고서",
  "참석자 명단",
  "회의명패",
  "명찰",
  "조직도",
  "보고서 작성 프롬프트",
  "차트",
  "조직도 그림",
  "추첨",
  "조 편성",
] as const;
export function ReportAutomation(props: Props) {
  const ownSession = useRef(new AutomationSession());
  const session = props.session ?? ownSession.current;
  const [utility, setUtility] = useState<(typeof UTILITIES)[number]>(
    session.utility as (typeof UTILITIES)[number],
  );
  const [input, setInput] = useState(() => session.get(utility).input),
    [argument, setArgument] = useState(() => session.get(utility).argument),
    [output, setOutput] = useState("");
  const [transform, setTransform] = useState<CellTransform>(
    () => session.get(utility).transform,
  );
  const [template, setTemplate] = useState<DocumentTemplate | null>(null),
    [working, setWorking] = useState(false);
  const [graphic, setGraphic] = useState("");
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const groups = [
    {
      label: "계산",
      names: UTILITIES.slice(0, 5).concat(UTILITIES.slice(6, 8)),
    },
    { label: "표 정리", names: ["표 데이터 정리", "자료 취합", "직제순 정렬"] },
    {
      label: "문서 작성",
      names: ["마크다운 보고서", "조직도", "보고서 작성 프롬프트"],
    },
    {
      label: "행사 자료",
      names: ["참석자 명단", "회의명패", "명찰", "추첨", "조 편성"],
    },
    { label: "그림", names: ["차트", "조직도 그림"] },
  ];
  const utilityLabel = (name: string) =>
    name === "명찰" || name === "회의명패" ? `${name} 내용 초안` : name;
  const searchQuery = filter.trim().toLocaleLowerCase("ko-KR");
  const matchesSearch = (name: string) =>
    [
      name,
      utilityLabel(name),
      groups.find((group) => group.names.some((value) => value === name))
        ?.label ?? "",
    ].some((value) => value.toLocaleLowerCase("ko-KR").includes(searchQuery));
  const matchingUtilities = UTILITIES.filter(matchesSearch);
  const keepsCurrentSelection = !matchingUtilities.includes(utility);
  const generated = useRef<{
    template: DocumentTemplate;
    document: EditorDocument;
  } | null>(null);
  const [delimiter, setDelimiter] = useState(
    () => session.get(utility).delimiter,
  );
  useLayoutEffect(() => {
    session.put(utility, { input, argument, transform, delimiter });
  }, [session, utility, input, argument, transform, delimiter]);
  const alive = useRef(true);
  const permission = useRef(0);
  const latest = useRef(props);
  useLayoutEffect(() => {
    if (
      latest.current.disabled !== props.disabled ||
      Boolean(latest.current.onCreateDocument) !==
        Boolean(props.onCreateDocument) ||
      latest.current.creationContext !== props.creationContext
    )
      permission.current++;
    latest.current = props;
  });
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const loadDraft = (name: typeof utility, reset = false) => {
    const draft = reset ? session.defaults(name) : session.get(name);
    setUtility(name);
    setRecent((previous) =>
      [name, ...previous.filter((value) => value !== name)].slice(0, 3),
    );
    setInput(draft.input);
    setArgument(draft.argument);
    setTransform(draft.transform);
    setDelimiter(draft.delimiter);
    invalidate();
  };
  const [validationError, setValidationError] = useState("");
  const [resetBackup, setResetBackup] = useState<{
    utility: typeof utility;
    draft: AutomationDraft;
  } | null>(null);
  const helpId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sizeId = `${helpId}-size`;
  const inputTooLong = input.length > AUTOMATION_FIELD_LIMIT;
  const argumentTooLong = argument.length > AUTOMATION_FIELD_LIMIT;
  const draftStatus = props.draftStatus ?? session.getSnapshot();
  const structuredResult = [
    "마크다운 보고서",
    "참석자 명단",
    "회의명패",
    "명찰",
    "조직도",
    "차트",
    "조직도 그림",
  ].includes(utility);
  const graphicResult = utility === "차트" || utility === "조직도 그림";
  const documentResult = structuredResult && !graphicResult;
  const canCreateDocument = Boolean(
    props.createDocument && props.onCreateDocument,
  );
  const resultGuidance = graphicResult
    ? "미리보기를 만든 뒤 현재 문서에 그림으로 삽입할 수 있습니다. 텍스트 결과도 별도로 삽입할 수 있습니다."
    : documentResult
      ? canCreateDocument
        ? "결과를 확인한 뒤 구조를 유지해 새 문서를 만들거나 표·서식을 제외한 텍스트로 현재 문서에 삽입할 수 있습니다."
        : "이 앱에서는 새 문서 생성을 지원하지 않습니다. 미리보기 결과를 표·서식을 제외한 텍스트로 현재 문서에 삽입할 수 있습니다."
      : "결과 텍스트를 확인·수정한 뒤 현재 문서에 삽입할 수 있습니다.";
  const form = OFFICE_AUTOMATION_FORMS.find((item) => item.name === utility)!;
  const cellArguments: Partial<
    Record<
      CellTransform,
      { label: string; defaultValue: string; type?: "number" | "text" }
    >
  > = {
    prefix: { label: "앞에 붙일 문구", defaultValue: "", type: "text" },
    suffix: { label: "뒤에 붙일 문구", defaultValue: "", type: "text" },
    multiply: { label: "곱할 수", defaultValue: "1", type: "number" },
    divide: { label: "나눌 수", defaultValue: "1", type: "number" },
    sequence: { label: "순번 시작 값", defaultValue: "1", type: "number" },
  };
  const argumentField =
    utility === "표 데이터 정리" ? cellArguments[transform] : form.argument;
  const tableInput = [
    "표 데이터 정리",
    "자료 취합",
    "직제순 정렬",
    "참석자 명단",
    "회의명패",
    "명찰",
    "조직도",
    "차트",
    "조직도 그림",
  ].includes(utility);
  const parseRows = (text: string) =>
    parseDelimited(
      text,
      delimiter === "auto" ? (text.includes("\t") ? "\t" : ",") : delimiter,
    );
  const invalidate = () => {
    generated.current = null;
    setMessage("");
    setValidationError("");
    setOutput("");
    setTemplate(null);
    setGraphic("");
  };
  const run = async (task: () => Promise<void> | void) => {
    if (working) return;
    setWorking(true);
    try {
      await task();
    } catch (cause) {
      if (alive.current)
        props.onError(
          cause instanceof Error ? cause : new Error(String(cause)),
        );
    } finally {
      setWorking(false);
    }
  };
  const generate = () => {
    setValidationError("");
    setOutput("");
    setTemplate(null);
    setGraphic("");
    if (!input.trim())
      throw new Error(`${form.inputLabel}을 입력하세요. ${form.help}`);
    if (argumentField && argumentField.type !== "text" && !argument.trim())
      throw new Error(`${argumentField.label}을 입력하세요. ${form.help}`);
    let text = "",
      document: DocumentTemplate | null = null;
    switch (utility) {
      case "금액 한글화":
        text = input
          .split(/\r?\n/)
          .filter(Boolean)
          .map(formatAccountingAmount)
          .join("\n");
        break;
      case "날짜 변환":
        text = input
          .split(/\r?\n/)
          .filter(Boolean)
          .map((value) => formatOfficeDate(value))
          .join("\n");
        break;
      case "만 나이":
        text = String(ageOn(input.trim(), argument.trim()));
        break;
      case "기간 계산": {
        const period = datePeriod(
          input.trim(),
          argument.trim() === "다음달" ? "nextMonth" : "nextWeek",
        );
        text = `${formatOfficeDate(period.from)} ~ ${formatOfficeDate(period.to)}`;
        break;
      }
      case "산출근거 계산":
        text = input
          .split(/\r?\n/)
          .filter(Boolean)
          .map((value) => `${value}\t${safeCalculate(value)}`)
          .join("\n");
        break;
      case "표 데이터 정리":
        text = serializeDelimited(
          transformCells(parseRows(input), transform, argument),
        );
        break;
      case "비율 분석":
        text = percentageAnalysis(
          input
            .split(/[\s,\t]+/)
            .filter(Boolean)
            .map(Number),
        )
          .map((value) => `${value.value}\t${value.percentage}%`)
          .join("\n");
        break;
      case "역합계":
        text = reverseTotals(
          input
            .split(/\s+/)
            .filter(Boolean)
            .map((value) => Number(value.replaceAll(",", ""))),
        ).join("\n");
        break;
      case "자료 취합":
        text = serializeDelimited(
          consolidateRows(input.split(/\r?\n---\r?\n/).map(parseRows), {
            startRow: Number(argument),
          }),
        );
        break;
      case "직제순 정렬":
        text = serializeDelimited(
          sortByOrganization(
            parseRows(input),
            0,
            argument.split(/\r?\n/).filter(Boolean),
          ),
        );
        break;
      case "마크다운 보고서":
        document = markdownTemplate(input, "보고서.docx");
        text = document.blocks
          .map((block) =>
            block.kind === "table"
              ? serializeDelimited(block.rows)
              : block.text,
          )
          .join("\n");
        break;
      case "참석자 명단":
      case "회의명패":
      case "명찰": {
        const people = parseRows(input).map((row) => ({
          name: row[0] ?? "",
          organization: row[1],
          role: row[2],
        }));
        document = meetingTemplate(
          people,
          utility === "참석자 명단"
            ? "attendance"
            : utility === "회의명패"
              ? "nameCards"
              : "nameTags",
          `${utility}.docx`,
        );
        text = document.blocks
          .map((block) =>
            block.kind === "table"
              ? serializeDelimited(block.rows)
              : block.text,
          )
          .join("\n");
        break;
      }
      case "조직도":
        document = organizationTemplate(
          parseRows(input).map((row) => ({
            id: row[0] ?? "",
            parentId: row[1] || undefined,
            label: row[2] ?? row[0] ?? "",
          })),
          "조직도.docx",
        );
        text = document.blocks
          .map((block) =>
            block.kind === "table"
              ? serializeDelimited(block.rows)
              : block.text,
          )
          .join("\n");
        break;
      case "보고서 작성 프롬프트":
        text = buildReportPrompt({
          title: argument || "보고서",
          purpose: "제공된 사실을 보고서로 정리",
          facts: input,
        });
        break;
      case "차트": {
        const data = parseRows(input)
          .filter((row) => row.some(Boolean))
          .map((row) => ({
            label: row[0]!,
            value: Number(row[1]?.replaceAll(",", "")),
          }));
        const kind =
          argument === "line" || argument === "pie" ? argument : "bar";
        setGraphic(buildChartSvg(data, kind));
        text = serializeDelimited(
          data.map((item) => [item.label, String(item.value)]),
        );
        break;
      }
      case "조직도 그림": {
        const nodes = parseRows(input).map((row) => ({
          id: row[0]!,
          parentId: row[1] || undefined,
          label: row[2] || row[0]!,
        }));
        setGraphic(buildOrganizationSvg(nodes));
        text = serializeDelimited(
          nodes.map((n) => [n.id, n.parentId ?? "", n.label]),
        );
        break;
      }
      case "추첨":
        text = drawNames(
          input
            .split(/\r?\n/)
            .map((name) => name.trim())
            .filter(Boolean),
          Number(argument),
        ).join("\n");
        break;
      case "조 편성":
        text = assignTeams(
          input
            .split(/\r?\n/)
            .map((name) => name.trim())
            .filter(Boolean),
          Number(argument),
        )
          .map((names, index) => `${index + 1}조\t${names.join(" · ")}`)
          .join("\n");
        break;
    }
    setOutput(text);
    setTemplate(document);
    if (document) {
      const title = document.blocks.find((block) => block.kind === "heading");
      const stem =
        (title && title.kind === "heading"
          ? title.text
          : (document.title ?? utility)
        )
          .replace(/[\x00-\x1f<>:"/\\|?*]/g, "_")
          .replace(/[. ]+$/, "")
          .slice(0, 80) || "새 문서";
      setFileName(`${stem}.${props.format ?? "docx"}`);
    }
  };
  const textResult = (
    <details open={!structuredResult} className="ds-text-result">
      <summary>텍스트 결과{structuredResult ? " · 표·서식 제외" : ""}</summary>
      <label>
        결과
        <textarea
          aria-label="업무 자동화 결과"
          readOnly={structuredResult}
          value={output}
          onChange={(e) => {
            setOutput(e.target.value);
            setTemplate(null);
            setGraphic("");
          }}
        />
      </label>
    </details>
  );
  return (
    <fieldset className="ds-tools-panel" disabled={props.disabled || working}>
      <legend>업무 자동화</legend>
      <div className="ds-tools-row">
        <label className="ds-field">
          기능 찾기
          <input
            aria-label="자동화 기능 찾기"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        <label className="ds-field">
          자동화 기능
          <select
            aria-label="자동화 기능"
            value={utility}
            onChange={(e) => {
              loadDraft(e.target.value as typeof utility);
            }}
          >
            {keepsCurrentSelection && (
              <optgroup label="현재 선택 · 입력 유지">
                <option value={utility}>{utilityLabel(utility)}</option>
              </optgroup>
            )}
            {groups.map((group) => {
              const names = group.names.filter(matchesSearch);
              return names.length ? (
                <optgroup label={group.label} key={group.label}>
                  {names.map((name) => (
                    <option key={name} value={name}>
                      {utilityLabel(name)}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        <button
          type="button"
          className="ds-button"
          onClick={() => {
            setResetBackup({
              utility,
              draft: { input, argument, transform, delimiter },
            });
            loadDraft(utility, true);
          }}
        >
          예제로 초기화
        </button>
        {resetBackup && (
          <button
            type="button"
            className="ds-button"
            onClick={() => {
              const saved = resetBackup;
              setUtility(saved.utility);
              setInput(saved.draft.input);
              setArgument(saved.draft.argument);
              setTransform(saved.draft.transform);
              setDelimiter(saved.draft.delimiter);
              setResetBackup(null);
              invalidate();
            }}
          >
            초기화 전 입력 복구
          </button>
        )}
        {tableInput && (
          <label className="ds-field">
            열 구분
            <select
              aria-label="열 구분"
              value={delimiter}
              onChange={(e) => {
                setDelimiter(e.target.value);
                invalidate();
              }}
            >
              <option value="auto">탭/쉼표 자동 감지</option>
              <option value={"\t"}>탭</option>
              <option value=",">쉼표 (CSV)</option>
            </select>
          </label>
        )}
        {argumentField && (
          <label className="ds-field">
            {argumentField.label}
            {"options" in argumentField && argumentField.options ? (
              <select
                aria-label={argumentField.label}
                value={argument}
                onChange={(e) => {
                  setArgument(e.target.value);
                  invalidate();
                }}
              >
                {argumentField.options.map((value) => (
                  <option key={value} value={value}>
                    {(
                      { bar: "막대", line: "꺾은선", pie: "원" } as Record<
                        string,
                        string
                      >
                    )[value] ?? value}
                  </option>
                ))}
              </select>
            ) : utility === "직제순 정렬" ? (
              <textarea
                aria-label={argumentField.label}
                aria-describedby={sizeId}
                aria-invalid={argumentTooLong}
                value={argument}
                onChange={(e) => {
                  setArgument(e.target.value);
                  invalidate();
                }}
              />
            ) : (
              <input
                data-automation-argument
                aria-label={argumentField.label}
                aria-describedby={sizeId}
                aria-invalid={argumentTooLong}
                type={argumentField.type ?? "text"}
                value={argument}
                step={argumentField.type === "number" ? "any" : undefined}
                onChange={(e) => {
                  setArgument(e.target.value);
                  invalidate();
                }}
              />
            )}
          </label>
        )}
        {utility === "표 데이터 정리" && (
          <label className="ds-field">
            셀 변환
            <select
              aria-label="셀 변환"
              value={transform}
              onChange={(e) => {
                setTransform(e.target.value as CellTransform);
                setArgument(
                  cellArguments[e.target.value as CellTransform]
                    ?.defaultValue ?? "",
                );
                invalidate();
              }}
            >
              {(
                [
                  ["trim", "앞뒤 공백 제거"],
                  ["collapseSpaces", "공백 정리"],
                  ["commas", "천 단위 쉼표"],
                  ["koreanAmount", "금액 한글화"],
                  ["dateOfficial", "공문 날짜"],
                  ["dateIso", "ISO 날짜"],
                  ["prefix", "앞에 붙임"],
                  ["suffix", "뒤에 붙임"],
                  ["multiply", "곱하기"],
                  ["divide", "나누기"],
                  ["sequence", "순번 채우기"],
                ] as const
              ).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="ds-button ds-primary"
          onClick={() => {
            void run(() => {
              try {
                generate();
              } catch (error) {
                setValidationError(
                  error instanceof Error ? error.message : String(error),
                );
              }
            });
          }}
        >
          결과 미리보기
        </button>
      </div>
      {searchQuery && (
        <p role="status" className="ds-automation-help">
          {matchingUtilities.length
            ? `검색 결과 ${matchingUtilities.length}개.`
            : "검색 결과가 없습니다."}
          {keepsCurrentSelection && " 현재 선택과 입력을 유지합니다."}
        </p>
      )}
      {recent.length > 1 && (
        <div className="ds-tools-row" aria-label="최근 사용 기능">
          최근 사용:{" "}
          {recent.map((name) => (
            <button
              type="button"
              className="ds-button"
              key={name}
              onClick={() => loadDraft(name as typeof utility)}
            >
              {utilityLabel(name)}
            </button>
          ))}
        </div>
      )}
      {(utility === "명찰" || utility === "회의명패") && (
        <p className="ds-automation-help">
          이름과 소속의 내용 초안입니다. 생성 파일은 일반 문단이며 인쇄용 카드
          크기·격자·재단선은 제공하지 않습니다.
        </p>
      )}
      {utility === "보고서 작성 프롬프트" && (
        <p className="ds-automation-help">
          보고서 요청 문장을 만드는 기능입니다. 에이전트를 실행하거나 보고서를
          자동 작성하지 않습니다.
        </p>
      )}
      <p id={helpId} className="ds-automation-help">
        {form.help}
      </p>
      {validationError && (
        <p role="alert" className="ds-automation-help">
          {validationError}
        </p>
      )}
      <div
        className={`ds-automation-data${structuredResult ? " ds-automation-structured" : ""}`}
      >
        <label>
          {form.inputLabel}
          <textarea
            ref={inputRef}
            aria-label={form.inputLabel}
            aria-describedby={`${helpId} ${sizeId}`}
            aria-invalid={!!validationError || inputTooLong}
            data-automation-input
            placeholder={form.example}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              invalidate();
            }}
          />
        </label>
        {structuredResult ? (
          <div className="ds-automation-preview">
            {template ? (
              <TemplatePreview template={template} utility={utility} />
            ) : graphic ? (
              <img
                alt="업무 자동화 그림 미리보기"
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(graphic)}`}
              />
            ) : (
              <p className="ds-automation-help">
                원본을 입력하고 결과 미리보기를 누르면 이곳에 구조·그림을
                표시합니다.
              </p>
            )}
          </div>
        ) : (
          textResult
        )}
      </div>
      <p className="ds-automation-help" role="status">
        {draftStatus.storage === "local"
          ? draftStatus.error
            ? "자동화 입력을 보관하지 못했습니다."
            : draftStatus.pending
              ? "자동화 입력을 이 브라우저에 보관 중…"
              : "자동화 입력은 이 브라우저에 별도로 보관됩니다. 닫고 다시 열어도 복구할 수 있습니다."
          : "자동화 입력은 문서 저장에 포함되지 않습니다. 편집기를 닫으면 사라집니다."}
      </p>
      {draftStatus.error && (
        <p role="alert" className="ds-automation-help">
          {draftStatus.error} 현재 입력은 유지됩니다.
          <button
            type="button"
            className="ds-button"
            onClick={() => {
              void session.flush().catch(props.onError);
            }}
          >
            자동화 입력 보관 재시도
          </button>
        </p>
      )}
      <p id={sizeId} className="ds-automation-help" data-automation-length>
        원본 입력 {input.length.toLocaleString("ko-KR")} /{" "}
        {AUTOMATION_FIELD_LIMIT.toLocaleString("ko-KR")}자
        {argumentField && (
          <>
            {" "}
            · 추가 입력 {argument.length.toLocaleString("ko-KR")} /{" "}
            {AUTOMATION_FIELD_LIMIT.toLocaleString("ko-KR")}자
          </>
        )}
        {(inputTooLong || argumentTooLong) &&
          " · 한도를 초과해 보관하지 않았습니다. 현재 입력은 유지됩니다. 수정하거나 내려받아 주세요."}
      </p>
      <button
        type="button"
        className="ds-button"
        onClick={() => {
          try {
            downloadAutomationDraft(session.snapshot());
          } catch (cause) {
            props.onError(
              cause instanceof Error ? cause : new Error(String(cause)),
            );
          }
        }}
      >
        모든 자동화 입력 내려받기
      </button>
      {structuredResult && textResult}
      {structuredResult && (
        <p className="ds-automation-help">
          {graphicResult ? "그림" : "문서"} 미리보기는 원본 입력으로 만듭니다.
          결과 미리보기는 읽기 전용입니다.
          <button
            type="button"
            className="ds-button"
            onClick={() => inputRef.current?.focus()}
          >
            원본 입력 수정
          </button>
        </p>
      )}
      {template && canCreateDocument && (
        <div className="ds-tools-row">
          <label className="ds-field">
            새 문서 파일명
            <input
              aria-label="새 문서 파일명"
              value={fileName}
              maxLength={120}
              onChange={(event) => {
                setFileName(event.target.value);
                generated.current = null;
              }}
            />
          </label>
          <span className="ds-automation-help">
            형식: {(props.format ?? "docx").toUpperCase()} · 저장 위치:{" "}
            {props.saveLocation ?? "연결된 앱에서 결정"} · 같은 이름은 고유
            번호를 붙여 보관합니다.
          </span>
        </div>
      )}
      <div
        className="ds-tools-row ds-automation-actions"
        data-has-result={Boolean(output)}
      >
        {graphic && (
          <button
            type="button"
            className="ds-button"
            onClick={() => {
              void run(async () => {
                const url = URL.createObjectURL(
                  new Blob([graphic], { type: "image/svg+xml" }),
                );
                try {
                  const image = new Image();
                  image.src = url;
                  await image.decode();
                  const canvas = document.createElement("canvas");
                  canvas.width = image.naturalWidth;
                  canvas.height = image.naturalHeight;
                  const context = canvas.getContext("2d");
                  if (!context)
                    throw new Error("그림 변환을 준비하지 못했습니다.");
                  context.drawImage(image, 0, 0);
                  const blob = await new Promise<Blob>((resolve, reject) =>
                    canvas.toBlob(
                      (result) =>
                        result
                          ? resolve(result)
                          : reject(new Error("그림 변환에 실패했습니다.")),
                      "image/png",
                    ),
                  );
                  const factor = Math.min(
                    160 / canvas.width,
                    220 / canvas.height,
                  );
                  await props.execute({
                    id: "insertImage",
                    value: {
                      bytes: new Uint8Array(await blob.arrayBuffer()),
                      mimeType: "image/png",
                      widthMm: canvas.width * factor,
                      heightMm: canvas.height * factor,
                      alt: utility,
                    },
                  });
                } finally {
                  URL.revokeObjectURL(url);
                }
              });
            }}
          >
            그림을 선택 위치에 삽입
          </button>
        )}
        <button
          type="button"
          className="ds-button"
          disabled={!output}
          onClick={() => {
            void run(async () => {
              await props.execute({ id: "insertText", value: output });
              setMessage(
                `텍스트 ${output.split(/\r?\n/).length}줄을 선택 위치에 삽입했습니다. 표·서식은 제외됐습니다.`,
              );
            });
          }}
        >
          텍스트로 삽입 · 표/서식 제외
        </button>
        {documentResult && (
          <button
            type="button"
            className="ds-button"
            disabled={
              !template ||
              !fileName.trim() ||
              !props.createDocument ||
              !props.onCreateDocument
            }
            onClick={() => {
              void run(async () => {
                const generation = permission.current;
                const document =
                  generated.current?.template === template
                    ? generated.current.document
                    : await props.createDocument!({ ...template!, fileName });
                if (
                  !alive.current ||
                  generation !== permission.current ||
                  latest.current.disabled ||
                  !latest.current.onCreateDocument
                )
                  return;
                generated.current = { template: template!, document };
                await latest.current.onCreateDocument(document);
              });
            }}
          >
            구조를 유지해 새 문서 만들기
          </button>
        )}
        <span className="ds-automation-help">
          미리보기는 문서를 바꾸지 않습니다. 입력은 현재 편집 세션에서 기능별로
          유지됩니다. {resultGuidance}
        </span>
      </div>
      {message && (
        <p role="status" className="ds-tools-message">
          {message}
        </p>
      )}
    </fieldset>
  );
}
