import { describe, it, expect, vi } from "vitest";
import {
  planMailMerge,
  parseMailMergeData,
  MAIL_MERGE_DRAFT_NAME,
  type MailMergeRequest,
  type MailMergeTemplateInfo,
} from "../../packages/core/src/index";
import { AutomationSession } from "../../packages/react/src/automation-session";
import { validateAutomationDraftState } from "../../packages/react/src/automation-validation";
import type { AutomationDraftState } from "../../packages/react/src/automation-drafts";
const template: MailMergeTemplateInfo = {
  templateId: "t",
  digest: "source",
  fileName: "서식.docx",
  format: "docx",
  fields: ["이름", "사번"],
  locations: [
    { field: "이름", address: "본문 1번 문단", token: "{{이름}}" },
    { field: "사번", address: "본문 1번 표 1행 1번째 셀", token: "{{사번}}" },
  ],
  issues: [],
};
const request: MailMergeRequest = {
  templateId: "t",
  data: "이름,식별번호\n홍길동,001234\n김철수,20261016",
  delimiter: "auto",
  mapping: { 이름: "이름", 사번: "식별번호" },
  fileNamePattern: "안내-{{이름}}-{{#}}.docx",
  allowEmpty: false,
};
describe("mail merge planning", () => {
  it("preserves identifiers and dates exactly and gives each output a deterministic name", () => {
    const result = planMailMerge(template, request);
    expect(result.issues).toEqual([]);
    expect(result.files.map((f) => [f.fileName, f.values.사번])).toEqual([
      ["안내-홍길동-01.docx", "001234"],
      ["안내-김철수-02.docx", "20261016"],
    ]);
  });
  it("reads quoted CSV, TSV and Unicode without numeric coercion", () => {
    expect(
      parseMailMergeData('이름,소속\n"가,나","A""B"', ",").records,
    ).toEqual([["가,나", 'A"B']]);
    expect(
      parseMailMergeData("이름\t소속\n👩‍💻\t기획팀", "auto").records[0],
    ).toEqual(["👩‍💻", "기획팀"]);
  });
  it.each([
    "이름,이름\na,b",
    "이름,\na,b",
    "이름\na,b",
    "이름",
    "이름\n" + Array(21).fill("이름").join("\n"),
  ])("rejects invalid data %s", (data) =>
    expect(() => parseMailMergeData(data, ",")).toThrow(),
  );
  it("reports missing mapping, unknown mapping and unsupported template fields", () => {
    const result = planMailMerge(
      { ...template, issues: ["unsupported paragraph"] },
      { ...request, mapping: { 이름: "없는 열", 잘못: "이름" } },
    );
    expect(result.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([
        "unsupported paragraph",
        "서식에 없는 필드 매핑입니다.",
        "연결할 데이터 열이 없습니다.",
      ]),
    );
  });
  it("shows every empty field and requires an explicit choice", () => {
    const input = { ...request, data: "이름,식별번호\n홍길동," };
    expect(planMailMerge(template, input).emptyValues).toEqual([
      { row: 2, field: "사번" },
    ]);
    expect(planMailMerge(template, input).issues).toHaveLength(1);
    expect(
      planMailMerge(template, { ...input, allowEmpty: true }).issues,
    ).toHaveLength(0);
  });
  it.each([
    "../{{이름}}.docx",
    "{{이름}}/문서.docx",
    "CON.docx",
    "NUL.docx",
    "A?.docx",
    "{{없음}}.docx",
    "이름.hwpx",
    "이름.docx ",
    ".숨김.docx",
  ])("blocks unsafe output filename %s", (fileNamePattern) =>
    expect(
      planMailMerge(template, { ...request, fileNamePattern }).issues.some(
        (i) => i.message.includes("파일 이름"),
      ),
    ).toBe(true),
  );
  it("rejects case insensitive output collisions", () => {
    const result = planMailMerge(template, {
      ...request,
      data: "이름,식별번호\nALICE,01\nalice,02",
      fileNamePattern: "{{이름}}.docx",
    });
    expect(result.issues.some((i) => i.message.includes("중복"))).toBe(true);
  });
  it.each([
    "line\nfeed",
    "tab\tvalue",
    "\0",
    "\ud800",
    "\uffff",
    "a".repeat(2001),
  ])("blocks unsupported field data %#", (value) => {
    const data = `이름,식별번호\n"${value}",123`;
    expect(
      planMailMerge(template, { ...request, data, delimiter: "," }).issues.some(
        (i) => i.field === "이름",
      ),
    ).toBe(true);
  });
  it("does not mutate source inputs or treat prototype-named fields as inherited values", () => {
    const special = { ...template, fields: ["constructor", "__proto__"] };
    const input = {
      ...request,
      data: "a,b\nx,y",
      mapping: JSON.parse('{"constructor":"a","__proto__":"b"}'),
      fileNamePattern: "{{#}}.docx",
    };
    const before = JSON.stringify(input);
    const result = planMailMerge(special, input);
    expect(result.issues).toEqual([]);
    expect(result.files[0]?.values["__proto__"]).toBe("y");
    expect(JSON.stringify(input)).toBe(before);
  });
});
describe("mail merge input drafts", () => {
  it("persists data and mapping without changing the active automation tool", async () => {
    let saved: AutomationDraftState | undefined;
    const store = {
      get: vi.fn(async () => saved),
      put: vi.fn(async (_key: string, value: AutomationDraftState) => {
        saved = structuredClone(value);
      }),
      delete: vi.fn(async () => {}),
    };
    const session = new AutomationSession({ store, key: "owner:doc" });
    await session.start();
    session.put("날짜 변환", {
      input: "2026-10-16",
      argument: "",
      transform: "trim",
      delimiter: "auto",
    });
    const draft = {
      input: request.data,
      argument: JSON.stringify({
        mapping: request.mapping,
        fileNamePattern: request.fileNamePattern,
        allowEmpty: false,
        sourceName: "서식.docx",
      }),
      transform: "trim" as const,
      delimiter: "auto",
    };
    session.put(MAIL_MERGE_DRAFT_NAME, draft, { activate: false });
    expect(session.utility).toBe("날짜 변환");
    await session.flush();
    validateAutomationDraftState(saved);
    session.dispose();
    const restored = new AutomationSession({ store, key: "owner:doc" });
    await restored.start();
    expect(restored.get(MAIL_MERGE_DRAFT_NAME)).toEqual(draft);
    expect(restored.utility).toBe("날짜 변환");
    restored.dispose();
  });
});
