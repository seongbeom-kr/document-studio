import type { EditorCommand } from "./commands";
export interface DocumentPreset {
  id: string;
  name: string;
  description: string;
  commands: readonly EditorCommand[];
}
/** Original presets. Institutions can supply their own; these are not official government templates. */
export const REPORT_PRESETS: readonly DocumentPreset[] = [
  {
    id: "report-title",
    name: "보고서 제목",
    description: "16pt·가운데·문단 뒤 12pt",
    commands: [
      { id: "fontSize", value: 16 },
      { id: "alignCenter" },
      {
        id: "paragraphFormat",
        value: {
          afterPt: 12,
          lineSpacing: { rule: "multiple", value: 1.5 },
          keepNext: true,
        },
      },
    ],
  },
  {
    id: "report-body",
    name: "보고서 본문",
    description: "12pt·행간 160%·왼쪽 정렬",
    commands: [
      { id: "fontSize", value: 12 },
      { id: "alignLeft" },
      {
        id: "paragraphFormat",
        value: {
          beforePt: 0,
          afterPt: 6,
          lineSpacing: { rule: "multiple", value: 1.6 },
        },
      },
    ],
  },
  {
    id: "report-note",
    name: "주석과 설명",
    description: "10pt·행간 130%·문단 뒤 3pt",
    commands: [
      { id: "fontSize", value: 10 },
      {
        id: "paragraphFormat",
        value: { afterPt: 3, lineSpacing: { rule: "multiple", value: 1.3 } },
      },
    ],
  },
  {
    id: "report-table",
    name: "표 본문",
    description: "10pt·행간 130%·문단 앞뒤 0pt",
    commands: [
      { id: "fontSize", value: 10 },
      {
        id: "paragraphFormat",
        value: {
          beforePt: 0,
          afterPt: 0,
          lineSpacing: { rule: "multiple", value: 1.3 },
        },
      },
    ],
  },
];
