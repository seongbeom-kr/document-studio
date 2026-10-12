/** Shared with UI and agent clients: each utility has its own input contract and examples. */
export interface AutomationForm {
  name: string;
  inputLabel: string;
  example: string;
  help: string;
  argument?: {
    label: string;
    defaultValue: string;
    type?: "date" | "number" | "text";
    options?: readonly string[];
  };
}
export const OFFICE_AUTOMATION_FORMS: readonly AutomationForm[] = [
  {
    name: "금액 한글화",
    inputLabel: "금액 목록",
    example: "12340",
    help: "한 줄에 한 금액을 입력하세요. 예: 12340.",
  },
  {
    name: "날짜 변환",
    inputLabel: "변환할 날짜 목록",
    example: "2026-10-06",
    help: "YYYY-MM-DD 날짜를 한 줄에 하나씩 입력하세요.",
  },
  {
    name: "만 나이",
    inputLabel: "생년월일",
    example: "2000-01-01",
    help: "생년월일과 나이를 계산할 기준일을 YYYY-MM-DD로 입력하세요.",
    argument: {
      label: "나이 계산 기준일",
      defaultValue: "today",
      type: "date",
    },
  },
  {
    name: "기간 계산",
    inputLabel: "기간 계산 기준일",
    example: "2026-10-06",
    help: "기준일부터 다음 주 또는 다음 달의 기간을 계산합니다.",
    argument: {
      label: "계산할 기간",
      defaultValue: "다음주",
      options: ["다음주", "다음달"],
    },
  },
  {
    name: "산출근거 계산",
    inputLabel: "계산식 목록",
    example: "12000 * 3 + 500",
    help: "숫자와 + - * / ( )를 사용하세요. 계산식은 한 줄에 하나씩 입력합니다.",
  },
  {
    name: "표 데이터 정리",
    inputLabel: "정리할 표 데이터",
    example: "이름,금액\n홍길동,12340",
    help: "쉼표 또는 탭으로 열을 구분하세요. 셀 변환을 선택하면 필요한 값만 입력란에 표시됩니다.",
  },
  {
    name: "비율 분석",
    inputLabel: "비율을 계산할 수치",
    example: "30 20 50",
    help: "공백·쉼표·탭으로 숫자를 구분하세요. 합계를 기준으로 각 비율을 계산합니다.",
  },
  {
    name: "역합계",
    inputLabel: "누적 합계를 계산할 수치",
    example: "10\n20\n30",
    help: "숫자를 공백이나 줄바꿈으로 구분하세요.",
  },
  {
    name: "자료 취합",
    inputLabel: "취합할 표 데이터",
    example: "이름,금액\n홍길동,100\n---\n이름,금액\n김철수,200",
    help: "표 사이에 ---만 있는 줄을 넣으세요. 시작 행은 1부터 셉니다. 시작 행 이전의 제목은 제외합니다.",
    argument: { label: "취합 시작 행", defaultValue: "2", type: "number" },
  },
  {
    name: "직제순 정렬",
    inputLabel: "정렬할 표 데이터",
    example: "기획팀,홍길동\n개발팀,김철수",
    help: "첫 열이 조직명인 표를 입력하세요. 조직명을 원하는 순서대로 한 줄에 하나씩 적습니다.",
    argument: {
      label: "조직 정렬 순서",
      defaultValue: "기획팀\n개발팀",
      type: "text",
    },
  },
  {
    name: "마크다운 보고서",
    inputLabel: "보고서 마크다운",
    example: "# 업무 보고서\n\n오늘의 업무 내용을 입력하세요.",
    help: "제목·문단·목록·표를 문서로 변환합니다.",
  },
  {
    name: "참석자 명단",
    inputLabel: "참석자 정보",
    example: "홍길동,기획팀,팀장\n김철수,개발팀,담당",
    help: "이름,소속,직책 순서로 한 줄에 한 사람씩 입력하세요.",
  },
  {
    name: "회의명패",
    inputLabel: "명패에 넣을 참석자 정보",
    example: "홍길동,기획팀,팀장",
    help: "이름,소속,직책 순서로 입력하세요. 결과는 일반 문단의 내용 초안이며 인쇄용 크기·격자·재단선을 제공하지 않습니다.",
  },
  {
    name: "명찰",
    inputLabel: "명찰에 넣을 참석자 정보",
    example: "홍길동,기획팀,팀장",
    help: "이름,소속,직책 순서로 입력하세요. 결과는 일반 문단의 내용 초안이며 인쇄용 크기·격자·재단선을 제공하지 않습니다.",
  },
  {
    name: "조직도",
    inputLabel: "조직 관계",
    example: "root,,본부\nteam,root,기획팀",
    help: "ID,상위 ID,조직명 순서입니다. 최상위 조직의 상위 ID는 비워 두세요.",
  },
  {
    name: "보고서 작성 프롬프트",
    inputLabel: "보고서에 포함할 사실",
    example: "사업 일정과 진행 현황을 입력하세요.",
    help: "확인된 사실을 입력하고 보고서 제목을 정하세요.",
    argument: {
      label: "보고서 제목",
      defaultValue: "업무 보고서",
      type: "text",
    },
  },
  {
    name: "차트",
    inputLabel: "차트 데이터",
    example: "기획,30\n개발,50\n지원,20",
    help: "항목명,숫자 순서로 입력하세요.",
    argument: {
      label: "차트 종류",
      defaultValue: "bar",
      options: ["bar", "line", "pie"],
    },
  },
  {
    name: "조직도 그림",
    inputLabel: "조직도 그림의 관계",
    example: "root,,본부\nteam,root,기획팀",
    help: "ID,상위 ID,조직명 순서입니다. 상위 ID는 실제 등록된 ID여야 합니다.",
  },
  {
    name: "추첨",
    inputLabel: "추첨 대상 이름",
    example: "홍길동\n김철수\n이영희",
    help: "한 줄에 한 이름을 입력하세요. 추첨 인원은 대상 인원을 넘을 수 없습니다.",
    argument: { label: "추첨 인원", defaultValue: "1", type: "number" },
  },
  {
    name: "조 편성",
    inputLabel: "조를 편성할 이름",
    example: "홍길동\n김철수\n이영희\n박민수",
    help: "한 줄에 한 이름을 입력하세요. 가능한 균등하게 조를 나눕니다.",
    argument: { label: "조 수", defaultValue: "2", type: "number" },
  },
];
export function automationDefault(value: string): string {
  if (value !== "today") return value;
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
