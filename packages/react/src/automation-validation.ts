import { OFFICE_AUTOMATION_FORMS } from "@document-studio/core";
import type { AutomationDraft } from "./automation-session";
import type { AutomationDraftState } from "./automation-drafts";

/** Same UTF-16 length measure as browser text controls and JavaScript strings. */
export const AUTOMATION_FIELD_LIMIT = 1_000_000;
const transforms = new Set([
  "trim",
  "collapseSpaces",
  "commas",
  "koreanAmount",
  "dateOfficial",
  "dateIso",
  "prefix",
  "suffix",
  "multiply",
  "divide",
  "sequence",
]);
const utilities = new Set(OFFICE_AUTOMATION_FORMS.map((form) => form.name));
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateDraft(
  name: string,
  value: unknown,
  allowOversize: boolean,
): asserts value is AutomationDraft {
  if (!utilities.has(name) || !record(value))
    throw new Error("자동화 초안 값이 올바르지 않습니다.");
  for (const [field, label] of [
    ["input", "원본 입력"],
    ["argument", "추가 입력"],
    ["delimiter", "열 구분"],
  ] as const) {
    const text = value[field];
    if (typeof text !== "string")
      throw new Error(`${name}: 자동화 초안 값이 올바르지 않습니다.`);
    if (!allowOversize && text.length > AUTOMATION_FIELD_LIMIT)
      throw new Error(
        `${name}: ${label}은 최대 ${AUTOMATION_FIELD_LIMIT.toLocaleString("ko-KR")}자까지 보관할 수 있습니다. 현재 ${text.length.toLocaleString("ko-KR")}자입니다. 입력을 수정하거나 내려받아 주세요.`,
      );
  }
  if (
    typeof value.transform !== "string" ||
    !transforms.has(value.transform) ||
    !["auto", ",", "\t"].includes(value.delimiter as string)
  )
    throw new Error(`${name}: 자동화 초안 값이 올바르지 않습니다.`);
}
function validate(
  value: unknown,
  allowOversize: boolean,
): asserts value is AutomationDraftState {
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.utility !== "string" ||
    !utilities.has(value.utility) ||
    !record(value.drafts) ||
    Object.keys(value.drafts).length > utilities.size
  )
    throw new Error("자동화 초안 형식이 올바르지 않습니다.");
  for (const [name, draft] of Object.entries(value.drafts))
    validateDraft(name, draft, allowOversize);
}
/** Read and durable write boundaries must apply this same contract. */
export function validateAutomationDraftState(
  value: unknown,
): asserts value is AutomationDraftState {
  validate(value, false);
}
/** Only for explicit in-memory repair of legacy records; never a storage validator. */
export function validateAutomationDraftForRepair(
  value: unknown,
): asserts value is AutomationDraftState {
  validate(value, true);
}
