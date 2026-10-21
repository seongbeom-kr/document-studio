import type { OfficeDateRequest } from "@document-studio/core";
export interface QuickActionSettings {
  baseDate: string;
  week: OfficeDateRequest["week"];
  format: OfficeDateRequest["format"];
  timeZone: string;
}
export function readQuickActionSettings(
  value: string,
  defaults: QuickActionSettings,
): QuickActionSettings {
  if (!value) return defaults;
  const data: unknown = JSON.parse(value);
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("보관한 날짜 설정을 확인해 주세요.");
  const settings = data as QuickActionSettings;
  if (
    typeof settings.baseDate !== "string" ||
    settings.baseDate.length > 10 ||
    !["workweek", "calendar"].includes(settings.week) ||
    !["official", "iso", "compact"].includes(settings.format) ||
    typeof settings.timeZone !== "string" ||
    settings.timeZone.length > 100
  )
    throw new Error("보관한 날짜 설정을 확인해 주세요.");
  new Intl.DateTimeFormat("en-US", { timeZone: settings.timeZone });
  return settings;
}
