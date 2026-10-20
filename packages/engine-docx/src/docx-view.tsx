import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  DocxEditor,
  LocaleProvider,
  type Editor,
  type EditorCommand as NativeCommand,
  type TextMatch,
} from "@docx-editor.dev/react";
import {
  commandForSlotValue,
  createBrowserAutomationHost,
  type DocxEditorInstance,
} from "@docx-editor.dev/core/editor";
import type {
  AutomationHandle,
  AutomationOperation,
  AutomationValue,
} from "@docx-editor.dev/core/automation";
import "@docx-editor.dev/core/styles/editor.css";
import {
  COMMAND_IDS,
  RevisionState,
  SessionStore,
  SaveConflictError,
  SearchResultExpiredError,
  SelectionConflictError,
  captureExportSnapshot,
  type EditorCommand,
  type EditorSession,
  type CommandId,
  type SearchOptions,
  validateCommand,
  validateSearch,
  validateReplace,
} from "@document-studio/core";
import type { EngineDefinition, EngineViewProps } from "@document-studio/react";

import {
  nativeCommand,
  probeCommand,
  highlightRgb,
  WORD_HIGHLIGHT_CHOICES,
} from "./commands";
import { ko } from "./ko";
import { applyDocxPreset } from "./apply-preset";
import { docxSelectionKey } from "./selection";
import { createDocxTableColumn } from "./table-column";
import { koreanCommandReason } from "./command-reason";
export function DocxView({
  document,
  onReady,
  onError,
  onSaveRequest,
  advancedTools,
  inputBlocked = false,
}: EngineViewProps) {
  const surface = useRef<HTMLDivElement>(null);
  const setInputBlocked = async (blocked: boolean) => {
    if (!surface.current) return;
    surface.current.inert = blocked;
    if (blocked && surface.current.contains(window.document.activeElement))
      (window.document.activeElement as HTMLElement | null)?.blur();
  };
  useLayoutEffect(() => {
    void setInputBlocked(inputBlocked);
  }, [inputBlocked]);
  const disposeRef = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  useEffect(() => () => disposeRef.current?.(), []);
  const ready = useCallback(
    (editor: Editor) => {
      disposeRef.current?.();
      const store = new SessionStore();
      const revisions = new RevisionState(
        String(editor.getDocumentHandle().revision),
        Boolean(document.recovered),
      );
      let active = true;
      let matchSequence = 0;
      const matches = new Map<string, { revision: string; match: TextMatch }>();
      const currentRevision = () => String(editor.getDocumentHandle().revision);
      const checkRevision = (expected: string) => {
        if (expected !== currentRevision())
          throw new SaveConflictError(
            "검색 결과의 revision이 변경됐습니다. 다시 검색해 주세요.",
          );
      };
      let questionGuard: { revision: string; selectionKey: string } | undefined;
      const update = () => {
        if (!active) return;
        const native = editor.snapshot();
        if (native.parseError) {
          callbacks.current.onError(new Error(native.parseError));
          return;
        }
        const revision = String(editor.getDocumentHandle().revision);
        if (
          questionGuard &&
          (questionGuard.revision !== revision ||
            questionGuard.selectionKey !== docxSelectionKey(editor))
        ) {
          editor.clearAnchorHighlight({ animation: false });
          editor.clearHighlights("document-studio-question");
          questionGuard = undefined;
        }
        const commands = Object.fromEntries(
          COMMAND_IDS.map((id) => {
            const command = nativeCommand(probeCommand(id), editor);
            if (!command)
              return [
                id,
                {
                  supported: id === "zoom",
                  enabled: id === "zoom",
                  reason:
                    id === "zoom"
                      ? undefined
                      : "현재 선택에서 사용할 수 없습니다.",
                },
              ];
            const allowed =
              command.type === "insertImage"
                ? editor.canExecuteImageCommand(command)
                : editor.can(command);
            return [
              id,
              {
                supported: allowed.ok || allowed.code !== "unsupported",
                enabled: allowed.ok,
                active: editor.isActive(command),
                reason: allowed.ok
                  ? undefined
                  : koreanCommandReason(allowed.reason),
                ...(id === "highlightColor"
                  ? {
                      valueChoices: WORD_HIGHLIGHT_CHOICES,
                      valueSchema: {
                        type: "string",
                        enum: WORD_HIGHLIGHT_CHOICES.map(
                          (choice) => choice.value,
                        ),
                      },
                    }
                  : {}),
              },
            ];
          }),
        );
        store.update({
          atomicPresets: true,
          atomicTextInsertion: true,
          tableColumnEditing: true,
          ready: !native.isLoading && !native.isOpening,
          revision,
          dirty: revisions.dirty(revision),
          pageCount: native.page.total,
          zoom: native.zoom,
          fontFamily: native.formatting?.fontFamily,
          fontSize: native.formatting?.fontSizePt,
          lineSpacing:
            native.formatting?.lineSpacing?.rule === "multiple"
              ? native.formatting.lineSpacing.value
              : undefined,
          paragraph: {
            beforePt: native.formatting?.spaceBeforePt,
            afterPt: native.formatting?.spaceAfterPt,
            leftMm:
              native.formatting?.indent && !native.formatting.indent.mixed.left
                ? (native.formatting.indent.left * 25.4) / 1440
                : undefined,
            rightMm:
              native.formatting?.indent && !native.formatting.indent.mixed.right
                ? (native.formatting.indent.right * 25.4) / 1440
                : undefined,
            firstLineMm:
              native.formatting?.indent &&
              !native.formatting.indent.mixed.firstLine
                ? (native.formatting.indent.firstLine * 25.4) / 1440
                : undefined,
            lineSpacing: native.formatting?.lineSpacing,
          },
          page: native.pageSetup
            ? {
                widthMm: (native.pageSetup.pageWidthTwips * 25.4) / 1440,
                heightMm: (native.pageSetup.pageHeightTwips * 25.4) / 1440,
                topMm: (native.pageSetup.marginsTwips.top * 25.4) / 1440,
                bottomMm: (native.pageSetup.marginsTwips.bottom * 25.4) / 1440,
                leftMm: (native.pageSetup.marginsTwips.left * 25.4) / 1440,
                rightMm: (native.pageSetup.marginsTwips.right * 25.4) / 1440,
                orientation: native.pageSetup.orientation,
              }
            : undefined,
          textColor:
            native.formatting?.color?.kind === "hex"
              ? `#${native.formatting.color.value}`
              : undefined,
          highlightColor: highlightRgb(native.formatting?.highlight),
          table: native.table
            ? { rows: native.table.rows, columns: native.table.columns }
            : undefined,
          selectionCollapsed: native.selectionCollapsed,
          selectionKey: docxSelectionKey(editor),
          selectionText: editor.query({ type: "selectedText" }).slice(0, 160),
          selectionTextLength: editor.query({ type: "selectedText" }).length,
          selectionGuardedCommands: true,
          selectionStateScope: "selection",
          commands,
        });
      };
      const tableColumn = createDocxTableColumn(editor);
      const session: EditorSession = {
        async captureQuestionTarget() {
          const semantic = (editor as DocxEditorInstance).surface?.state()
            .selection;
          const selectedText = editor.query({ type: "selectedText" });
          if (selectedText && semantic) {
            if (semantic.anchor.paragraphId !== semantic.head.paragraphId)
              throw new Error("한 단락 안에서 질문할 부분을 선택해 주세요.");
            if (!selectedText.trim() || selectedText.length > 8000)
              throw new Error("질문할 텍스트는 8,000자까지 지원합니다.");
            const start = Math.min(
              semantic.anchor.offset,
              semantic.head.offset,
            );
            const end = Math.max(semantic.anchor.offset, semantic.head.offset);
            const blockId = semantic.anchor.paragraphId;
            const painted = editor.setHighlights(
              "document-studio-question",
              [
                {
                  blockId,
                  start,
                  length: end - start,
                  expectedText: selectedText,
                },
              ],
              {
                color: "#2563eb15",
                className: "ds-question-range",
                priority: 20,
              },
            );
            if (painted.applied !== 1)
              throw new Error(
                "선택 영역의 표시 위치를 확인하지 못했습니다. 다시 선택해 주세요.",
              );
            editor.clearAnchorHighlight({ animation: false });
            questionGuard = {
              revision: currentRevision(),
              selectionKey: docxSelectionKey(editor),
            };
            return {
              ...questionGuard,
              anchor: JSON.stringify({
                format: "docx",
                paragraphId: blockId,
                start,
                end,
              }),
              text: selectedText,
              description: "선택한 부분",
            };
          }
          editor.clearHighlights("document-studio-question");
          const range = editor.query({ type: "selection" });
          const anchor = range?.from;
          if (!anchor || !("paraId" in anchor))
            throw new Error("질문할 본문 단락을 먼저 클릭해 주세요.");
          const paragraphs = editor.query({ type: "paragraphs" });
          const index = paragraphs.findIndex(
            (paragraph) => paragraph.paraId === anchor.paraId,
          );
          const paragraph = paragraphs[index];
          if (!paragraph?.text.trim() || paragraph.text.length > 8000)
            throw new Error("텍스트가 있는 8,000자 이하 단락을 선택해 주세요.");
          if (
            !editor.highlightAnchor(
              { paraId: anchor.paraId },
              {
                borderWidth: 2,
                borderColor: "#2563eb",
                color: "#2563eb",
                opacity: 0.06,
                timeoutMs: null,
                animation: false,
                className: "ds-question-anchor",
              },
            )
          )
            throw new Error(
              "이 단락의 표시 위치를 확인하지 못했습니다. 본문 단락을 다시 선택해 주세요.",
            );
          questionGuard = {
            revision: currentRevision(),
            selectionKey: docxSelectionKey(editor),
          };
          return {
            ...questionGuard,
            anchor: JSON.stringify({ format: "docx", paraId: anchor.paraId }),
            text: paragraph.text,
            description: `${index + 1}번째 단락`,
          };
        },
        clearQuestionTarget() {
          questionGuard = undefined;
          editor.clearAnchorHighlight({ animation: false });
          editor.clearHighlights("document-studio-question");
        },
        async getQuestionRects() {
          if (
            !questionGuard ||
            questionGuard.revision !== currentRevision() ||
            questionGuard.selectionKey !== docxSelectionKey(editor)
          )
            return [];
          return Array.from(
            surface.current?.querySelectorAll(
              ".ds-question-anchor, .ds-question-range",
            ) ?? [],
          ).map((node) => {
            const { left, top, right, bottom } = node.getBoundingClientRect();
            return { left, top, right, bottom };
          });
        },
        readTable: tableColumn.read,
        async applyTableChanges(table, changes, assertCurrent) {
          await tableColumn.apply(table, changes, assertCurrent);
          update();
        },
        setInputBlocked,
        getSnapshot: store.getSnapshot,
        subscribe: store.subscribe,
        async executePreset(commands, options) {
          applyDocxPreset(editor, commands, options);
          update();
        },
        async execute(command, options) {
          validateCommand(command);
          options?.assertCurrent?.();
          if (
            options?.expectedSelectionKey !== undefined &&
            options.expectedSelectionKey !== docxSelectionKey(editor)
          )
            throw new SelectionConflictError();
          if (
            options?.expectedRevision !== undefined &&
            options.expectedRevision !==
              String(editor.getDocumentHandle().revision)
          )
            throw new SaveConflictError("편집 revision이 변경됐습니다.");
          if (
            command.id === "fontSize" &&
            (!Number.isFinite(command.value) ||
              command.value < 1 ||
              command.value > 200)
          )
            throw new Error("글자 크기는 1~200pt로 입력해 주세요.");
          if (
            command.id === "fontFamily" &&
            (!command.value.trim() || command.value.length > 128)
          )
            throw new Error("올바른 글꼴 이름을 입력해 주세요.");
          if (
            command.id === "lineSpacing" &&
            (!Number.isFinite(command.value) ||
              command.value < 0.5 ||
              command.value > 5)
          )
            throw new Error("행간은 0.5~5배로 입력해 주세요.");
          const mapped = nativeCommand(command, editor);
          if (!mapped && command.id !== "zoom")
            throw new Error("현재 선택에서 사용할 수 없습니다.");
          const result =
            command.id === "zoom"
              ? editor.setZoom(command.value)
              : mapped?.type === "insertImage"
                ? await editor.executeImageCommand(mapped)
                : editor.exec(mapped!);
          if (!result.ok) throw new Error(result.reason);
          editor.focus();
          update();
        },
        async readDocument() {
          const paragraphs = editor.query({ type: "paragraphs" });
          const selected = paragraphs.slice(0, 10_000).map((p, index) => ({
            id: p.paraId ?? `paragraph:${index}`,
            text: p.text,
          }));
          return {
            revision: currentRevision(),
            paragraphs: selected,
            text: selected.map((p) => p.text).join("\n"),
            truncated: paragraphs.length > selected.length,
            scope: "body-and-tables",
          };
        },
        async search(input) {
          validateSearch(input);
          const found = editor.findMatches(input.query, {
            matchCase: input.matchCase,
            wholeWord: input.wholeWord,
          });
          const revision = currentRevision();
          for (const [id, entry] of matches)
            if (entry.revision !== revision) matches.delete(id);
          const selected = found
            .slice(0, input.maxResults ?? 100)
            .map((match) => {
              const id = `${revision}:${++matchSequence}`;
              matches.set(id, { revision, match });
              while (matches.size > 1000)
                matches.delete(matches.keys().next().value!);
              return {
                id,
                text: match.text,
                before: match.contextBefore ?? "",
                after: match.contextAfter ?? "",
              };
            });
          return {
            revision,
            matches: selected,
            total: found.length,
            truncated: found.length > selected.length,
          };
        },
        async selectMatch(id, expected) {
          checkRevision(expected);
          const found = matches.get(id);
          if (!found || found.revision !== expected)
            throw new SearchResultExpiredError();
          const result = editor.selectMatch(found.match);
          if (!result.ok) throw new Error(result.reason);
          editor.focus();
          update();
        },
        async replace(input, expected) {
          validateReplace(input);
          checkRevision(expected);
          let foundMatches: readonly TextMatch[];
          if (input.all) {
            foundMatches = editor.findMatches(input.query!, {
              matchCase: input.matchCase,
              wholeWord: input.wholeWord,
            });
          } else {
            const found = matches.get(input.matchId!);
            if (!found || found.revision !== expected)
              throw new SearchResultExpiredError();
            foundMatches = [found.match];
          }
          if (!foundMatches.length) return { count: 0 };
          if (input.all) {
            // The painted editor's replaceMatch command is unavailable in this pin.
            // Its public automation host commits a planned batch as ONE native undo unit.
            if (
              foundMatches.some(
                (match) => match.scope && match.scope.kind !== "body",
              )
            )
              throw new Error(
                "본문 외 영역의 모두 바꾸기는 지원하지 않습니다. 해당 검색 결과를 개별 치환해 주세요.",
              );
            // React's callback narrows the concrete instance to the generic Editor contract.
            if (!("surface" in editor))
              throw new Error("이 편집기는 원자적 치환을 지원하지 않습니다.");
            const host = createBrowserAutomationHost(
              editor as DocxEditorInstance,
            );
            try {
              const query = (
                operation: AutomationOperation,
              ): AutomationValue => {
                const response = host.execute({
                  operations: [operation],
                  expectedRevision: Number(expected),
                });
                const result = response.results[0];
                if (!response.ok || result?.status !== "ok")
                  throw new Error(
                    result?.status === "error"
                      ? result.error.message
                      : "치환 대상을 확인하지 못했습니다.",
                  );
                return result.value;
              };
              const handle = (value: AutomationValue): AutomationHandle => {
                if (value.kind !== "handle")
                  throw new Error("문서 영역을 확인하지 못했습니다.");
                return value.handle;
              };
              const body = handle(
                query({
                  op: "getBody",
                  document: handle(query({ op: "getDocument" })),
                }),
              );
              const paragraphs = query({ op: "getParagraphs", body });
              if (paragraphs.kind !== "handles")
                throw new Error("문단을 확인하지 못했습니다.");
              const operations: AutomationOperation[] = [...foundMatches]
                .reverse()
                .map((match) => {
                  const paragraph = paragraphs.handles[match.paragraphIndex];
                  if (!paragraph)
                    throw new Error("검색 결과의 문단이 변경됐습니다.");
                  return {
                    op: "replaceSpan",
                    span: {
                      start: { paragraph, offset: match.start },
                      end: { paragraph, offset: match.start + match.length },
                    },
                    text: input.replacement,
                  };
                });
              const result = host.execute({
                operations,
                expectedRevision: Number(expected),
              });
              if (!result.ok) {
                const failed = result.results.find(
                  (item) => item.status === "error",
                );
                throw new Error(
                  failed?.status === "error"
                    ? failed.error.message
                    : "모두 바꾸기를 적용하지 못했습니다.",
                );
              }
              matches.clear();
              editor.focus();
              update();
              return { count: result.changed ? foundMatches.length : 0 };
            } finally {
              host.dispose();
            }
          }
          const replacementCommand = (): NativeCommand =>
            input.replacement.length
              ? { type: "pasteWithoutFormatting", text: input.replacement }
              : // Pinned live-selection deletion differs from its DocTarget type declaration.
                // can() checks the actual runtime before any deletion.
                ({ type: "deleteText" } as NativeCommand);
          for (const match of foundMatches) {
            if (match.scope?.kind === "frame")
              throw new Error(
                "이 개체 안의 텍스트는 자동 치환을 지원하지 않습니다.",
              );
            const selected = editor.selectMatch(match);
            if (!selected.ok) throw new Error(selected.reason);
            const allowed = editor.can(replacementCommand());
            if (!allowed.ok) throw new Error(allowed.reason);
          }
          // The pinned React tree editor refuses replaceMatch despite declaring it.
          // Select each native match, then use its supported plain-text replacement lane.
          let count = 0;
          for (const match of [...foundMatches].reverse()) {
            const selected = editor.selectMatch(match);
            if (!selected.ok) throw new Error(selected.reason);
            const result = editor.exec(replacementCommand());
            if (!result.ok) throw new Error(result.reason);
            if (result.changed) count++;
          }
          matches.clear();
          editor.focus();
          update();
          return { count };
        },
        async exportDocument() {
          return captureExportSnapshot(
            "docx",
            currentRevision,
            async () => new Uint8Array(await editor.save()),
            update,
          );
        },
        async markSaved(revision) {
          revisions.acknowledge(revision);
          update();
        },
      };
      const unsubs = [
        editor.on("change", update),
        editor.on("selectionChange", update),
        editor.on("error", (error) => callbacks.current.onError(error)),
      ];
      const timer = setInterval(update, 300);
      disposeRef.current = () => {
        active = false;
        clearInterval(timer);
        unsubs.forEach((off) => off());
      };
      update();
      callbacks.current.onReady(session);
    },
    [document.recovered],
  );
  return (
    <div ref={surface} className="ds-docx-surface docx-editor">
      <LocaleProvider i18n={ko}>
        <DocxEditor.Root
          document={document.bytes}
          mode="edit"
          onReady={ready}
          zoom={1}
          locale="ko-KR"
        >
          {advancedTools && (
            <div className="ds-native-tools" aria-label="DOCX 확장 도구">
              <DocxEditor.Menu
                preset={false}
                reportIssue={false}
                onSave={onSaveRequest}
              >
                <DocxEditor.Menu.File preset={false}>
                  <DocxEditor.Menu.PageSetup />
                </DocxEditor.Menu.File>
                <DocxEditor.Menu.Format />
                <DocxEditor.Menu.Insert />
              </DocxEditor.Menu>
              <DocxEditor.HorizontalRuler />
            </div>
          )}
          <DocxEditor.Viewport>
            <DocxEditor.Content />
          </DocxEditor.Viewport>
        </DocxEditor.Root>
      </LocaleProvider>
    </div>
  );
}
