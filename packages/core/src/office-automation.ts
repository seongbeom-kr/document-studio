/** Original, deterministic report utilities. No eval, desktop macros or network calls. */
const digitNames = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const groupNames = ["", "만", "억", "조", "경", "해"];
export function koreanNumber(input: string | number | bigint): string {
  if (typeof input === "number" && !Number.isSafeInteger(input))
    throw new Error("정확한 정수는 문자열로 입력해 주세요.");
  const text = String(input).replaceAll(",", "").trim();
  if (!/^-?\d{1,24}$/.test(text))
    throw new Error("금액은 24자리 이하 정수로 입력해 주세요.");
  const amount = BigInt(text),
    negative = amount < 0n;
  let remaining = negative ? -amount : amount;
  if (!remaining) return "영";
  const pieces: string[] = [];
  for (let group = 0; remaining; group++, remaining /= 10000n) {
    const value = Number(remaining % 10000n);
    if (!value) continue;
    let piece = "";
    for (let position = 3; position >= 0; position--) {
      const digit = Math.floor(value / 10 ** position) % 10;
      if (digit)
        piece +=
          (digit === 1 && position ? "" : digitNames[digit]!) +
          ["", "십", "백", "천"][position]!;
    }
    pieces.unshift(piece + groupNames[group]);
  }
  return (negative ? "마이너스 " : "") + pieces.join("");
}
export function formatAccountingAmount(
  input: string | number | bigint,
): string {
  const words = koreanNumber(input),
    amount = BigInt(String(input).replaceAll(",", "").trim());
  const formatted = amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `금${formatted}원(금${words}원)`;
}
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}
export function parseCalendarDate(input: string): CalendarDate {
  const matched = /^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})\.?$/.exec(
    input.trim(),
  );
  if (!matched)
    throw new Error("날짜는 YYYY-MM-DD 또는 YYYYMMDD로 입력해 주세요.");
  const year = Number(matched[1]),
    month = Number(matched[2]),
    day = Number(matched[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    year > 9999 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  )
    throw new Error("존재하지 않는 날짜입니다.");
  return { year, month, day };
}
const utc = (date: CalendarDate) =>
  Date.UTC(date.year, date.month - 1, date.day);
export function formatOfficeDate(
  input: string,
  format: "official" | "iso" | "compact" = "official",
): string {
  const { year, month, day } = parseCalendarDate(input);
  if (format === "compact")
    return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
  if (format === "iso")
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return `${year}. ${month}. ${day}.(${["일", "월", "화", "수", "목", "금", "토"][new Date(utc({ year, month, day })).getUTCDay()]})`;
}
export function ageOn(birth: string, on: string): number {
  const b = parseCalendarDate(birth),
    d = parseCalendarDate(on);
  if (utc(b) > utc(d)) throw new Error("생년월일이 기준일보다 늦습니다.");
  return (
    d.year -
    b.year -
    (d.month < b.month || (d.month === b.month && d.day < b.day) ? 1 : 0)
  );
}
export function datePeriod(
  input: string,
  kind: "nextWeek" | "nextMonth",
): { from: string; to: string } {
  if (!["nextWeek", "nextMonth"].includes(kind))
    throw new Error("기간 종류가 올바르지 않습니다.");
  const d = parseCalendarDate(input),
    date = new Date(utc(d));
  let from: Date, to: Date;
  if (kind === "nextWeek") {
    const offset = (date.getUTCDay() + 6) % 7;
    from = new Date(utc(d) + (7 - offset) * 86400000);
    to = new Date(from.getTime() + 6 * 86400000);
  } else {
    from = new Date(Date.UTC(d.year, d.month, 1));
    to = new Date(Date.UTC(d.year, d.month + 1, 0));
  }
  if (to.getUTCFullYear() > 9999)
    throw new Error("날짜 계산 결과가 지원 범위를 넘습니다.");
  const iso = (v: Date) => v.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}
export function parseDelimited(text: string, delimiter = "\t"): string[][] {
  if (text.length > 8_000_000 || delimiter.length !== 1)
    throw new Error("표 입력 크기 또는 구분자가 올바르지 않습니다.");
  const rows: string[][] = [],
    row: string[] = [];
  let cell = "",
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (quoted || !cell) quoted = !quoted;
      else cell += char;
    } else if (!quoted && char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell);
      rows.push([...row]);
      row.length = 0;
      cell = "";
    } else cell += char;
    if (rows.length > 10000 || row.length > 1000)
      throw new Error("표 입력 제한을 넘었습니다.");
  }
  if (quoted) throw new Error("닫히지 않은 따옴표가 있습니다.");
  if (cell || row.length || !rows.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export function serializeDelimited(
  rows: readonly (readonly string[])[],
  delimiter = "\t",
): string {
  return rows
    .map((row) =>
      row
        .map((value) =>
          /["\r\n]/.test(value) || value.includes(delimiter)
            ? `"${value.replaceAll('"', '""')}"`
            : value,
        )
        .join(delimiter),
    )
    .join("\n");
}
export type CellTransform =
  | "trim"
  | "collapseSpaces"
  | "commas"
  | "koreanAmount"
  | "dateOfficial"
  | "dateIso"
  | "prefix"
  | "suffix"
  | "multiply"
  | "divide"
  | "sequence";
export function transformCells(
  rows: readonly (readonly string[])[],
  operation: CellTransform,
  argument: string | number = "",
): string[][] {
  if (
    ![
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
    ].includes(operation)
  )
    throw new Error("셀 변환 종류가 올바르지 않습니다.");
  let sequence =
    typeof argument === "number" ? argument : Number(argument || 1);
  return rows.map((row) =>
    row.map((value) => {
      switch (operation) {
        case "trim":
          return value.trim();
        case "collapseSpaces":
          return value.replace(/\s+/g, " ").trim();
        case "prefix":
          return String(argument) + value;
        case "suffix":
          return value + String(argument);
        case "sequence":
          if (!Number.isSafeInteger(sequence))
            throw new Error("순번이 올바르지 않습니다.");
          return String(sequence++);
        case "koreanAmount":
          return value.trim() ? formatAccountingAmount(value) : value;
        case "dateOfficial":
          return value.trim() ? formatOfficeDate(value) : value;
        case "dateIso":
          return value.trim() ? formatOfficeDate(value, "iso") : value;
        case "commas":
        case "multiply":
        case "divide": {
          if (!value.trim()) return value;
          const text = value.replaceAll(",", "").trim();
          if (!/^-?\d+(?:\.\d+)?$/.test(text))
            throw new Error(`숫자가 아닌 셀이 있습니다: ${value.slice(0, 40)}`);
          if (operation === "commas") {
            const [integer, fraction] = text.split(".");
            return (
              integer!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
              (fraction === undefined ? "" : `.${fraction}`)
            );
          }
          const factor = Number(argument);
          if (
            !Number.isFinite(factor) ||
            (operation === "divide" && factor === 0)
          )
            throw new Error("계산 인수가 올바르지 않습니다.");
          return String(
            safeCalculate(
              `${text}${operation === "multiply" ? "*" : "/"}${factor}`,
            ),
          );
        }
      }
    }),
  );
}
/** Bounded rational arithmetic parser; input can never access globals or execute JavaScript. */
export function safeCalculate(expression: string): number {
  if (expression.length > 2048) throw new Error("계산식이 너무 깁니다.");
  const source = expression
    .replaceAll(",", "")
    .replace(/[×xX]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/(\d+(?:\.\d+)?)\s*만원/g, "($1*10000)")
    .replace(/(?:개월|원|명|개|일|회|인|건)/g, "")
    .replace(/\s+/g, "");
  if (!source || /[^\d.+\-*/()%]/.test(source))
    throw new Error("숫자와 사칙연산만 사용할 수 있습니다.");
  let index = 0,
    operations = 0;
  type Fraction = { n: bigint; d: bigint };
  const gcd = (a: bigint, b: bigint): bigint => (b ? gcd(b, a % b) : a);
  const normalize = (n: bigint, d: bigint): Fraction => {
    if (!d) throw new Error("0으로 나눌 수 없습니다.");
    const divisor = gcd(n < 0n ? -n : n, d < 0n ? -d : d) || 1n;
    return { n: n / divisor, d: d / divisor };
  };
  const primary = (): Fraction => {
    if (++operations > 256) throw new Error("계산식이 너무 복잡합니다.");
    if (source[index] === "+") {
      index++;
      return primary();
    }
    if (source[index] === "-") {
      index++;
      const v = primary();
      return { n: -v.n, d: v.d };
    }
    let value: Fraction;
    if (source[index] === "(") {
      index++;
      value = sum();
      if (source[index++] !== ")") throw new Error("괄호가 올바르지 않습니다.");
    } else {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(index));
      if (!match || match[0].length > 32)
        throw new Error("계산식이 올바르지 않습니다.");
      index += match[0].length;
      const [whole, decimal = ""] = match[0].split(".");
      value = {
        n: BigInt((whole || "0") + decimal),
        d: 10n ** BigInt(decimal.length),
      };
    }
    if (source[index] === "%") {
      index++;
      value = normalize(value.n, value.d * 100n);
    }
    return value;
  };
  const product = (): Fraction => {
    let value = primary();
    while (source[index] === "*" || source[index] === "/") {
      const op = source[index++],
        right = primary();
      value =
        op === "*"
          ? normalize(value.n * right.n, value.d * right.d)
          : normalize(value.n * right.d, value.d * right.n);
    }
    return value;
  };
  const sum = (): Fraction => {
    let value = product();
    while (source[index] === "+" || source[index] === "-") {
      const op = source[index++],
        right = product();
      value = normalize(
        value.n * right.d + (op === "+" ? 1n : -1n) * right.n * value.d,
        value.d * right.d,
      );
    }
    return value;
  };
  const value = sum();
  if (index !== source.length) throw new Error("계산식이 올바르지 않습니다.");
  const result = Number(value.n) / Number(value.d);
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER)
    throw new Error("계산 결과가 정확한 숫자 범위를 넘었습니다.");
  return result;
}
export function percentageAnalysis(
  values: readonly number[],
  digits = 1,
): { value: number; percentage: number }[] {
  if (
    !values.length ||
    values.length > 10000 ||
    !Number.isInteger(digits) ||
    digits < 0 ||
    digits > 6 ||
    values.some((v) => !Number.isFinite(v) || v < 0)
  )
    throw new Error("비율 분석 입력이 올바르지 않습니다.");
  const total = values.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total === 0)
    throw new Error("비율의 합계는 0보다 커야 합니다.");
  return values.map((value) => ({
    value,
    percentage: Number(((value / total) * 100).toFixed(digits)),
  }));
}
export function reverseTotals(values: readonly number[]): number[] {
  let total = 0;
  return [...values]
    .reverse()
    .map((value) => {
      if (!Number.isFinite(value))
        throw new Error("숫자 합계가 올바르지 않습니다.");
      total += value;
      if (!Number.isFinite(total))
        throw new Error("합계가 숫자 범위를 넘었습니다.");
      return total;
    })
    .reverse();
}
export function consolidateRows(
  sources: readonly (readonly (readonly string[])[])[],
  options: { startRow?: number; removeEmptyColumn?: number } = {},
): string[][] {
  const start = options.startRow ?? 1;
  if (!Number.isInteger(start) || start < 1 || start > 10000)
    throw new Error("시작 행이 올바르지 않습니다.");
  const rows = sources.flatMap((source) =>
    source.slice(start - 1).map((row) => [...row]),
  );
  if (rows.length > 100000)
    throw new Error("취합할 행 수가 제한을 넘었습니다.");
  return options.removeEmptyColumn === undefined
    ? rows
    : rows.filter((row) => Boolean(row[options.removeEmptyColumn!]?.trim()));
}
export function sortByOrganization(
  rows: readonly (readonly string[])[],
  column: number,
  order: readonly string[],
): string[][] {
  if (
    !Number.isInteger(column) ||
    column < 0 ||
    new Set(order).size !== order.length
  )
    throw new Error("정렬 기준이 올바르지 않습니다.");
  const rank = new Map(order.map((name, index) => [name, index]));
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        (rank.get(a.row[column] ?? "") ?? Infinity) -
          (rank.get(b.row[column] ?? "") ?? Infinity) || a.index - b.index,
    )
    .map(({ row }) => [...row]);
}
export interface Participant {
  name: string;
  organization?: string;
  role?: string;
}
export function participantTable(
  people: readonly Participant[],
  kind: "nameCards" | "nameTags" | "attendance" = "attendance",
): string[][] {
  if (
    people.length > 2000 ||
    people.some(
      (p) =>
        !p.name.trim() ||
        p.name.length > 200 ||
        (p.organization?.length ?? 0) > 300,
    )
  )
    throw new Error("참석자 목록이 올바르지 않습니다.");
  return kind === "attendance"
    ? [
        ["번호", "소속", "직위", "성명"],
        ...people.map((p, index) => [
          String(index + 1),
          p.organization ?? "",
          p.role ?? "",
          p.name,
        ]),
      ]
    : people.map((p) =>
        kind === "nameCards"
          ? [p.organization ?? "", p.role ?? "", p.name]
          : [p.name, [p.organization, p.role].filter(Boolean).join(" · ")],
      );
}
export interface OrganizationNode {
  id: string;
  parentId?: string;
  label: string;
}
export function organizationRows(
  nodes: readonly OrganizationNode[],
): string[][] {
  if (
    nodes.length > 2000 ||
    new Set(nodes.map((n) => n.id)).size !== nodes.length
  )
    throw new Error("조직도 항목이 올바르지 않습니다.");
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((node) => {
    const path: string[] = [];
    const visited = new Set<string>();
    let current: OrganizationNode | undefined = node;
    while (current) {
      if (visited.has(current.id))
        throw new Error("조직도에 순환 관계가 있습니다.");
      visited.add(current.id);
      path.unshift(current.label);
      if (current.parentId && !byId.has(current.parentId))
        throw new Error("상위 조직이 없습니다.");
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return path;
  });
}
export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph" | "bullet" | "numbered" | "code"; text: string }
  | { kind: "table"; rows: string[][] };
export function parseReportMarkdown(markdown: string): MarkdownBlock[] {
  if (markdown.length > 1_000_000)
    throw new Error("마크다운 입력이 너무 큽니다.");
  const lines = markdown.replaceAll("\r\n", "\n").split("\n"),
    blocks: MarkdownBlock[] = [];
  let code = false;
  const plain = (text: string) =>
    text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => a ?? b)
      .replace(/`([^`]+)`/g, "$1");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^\s*```/.test(line)) {
      code = !code;
      continue;
    }
    if (code) {
      blocks.push({ kind: "code", text: line });
      continue;
    }
    if (!line.trim()) continue;
    if (
      line.includes("|") &&
      /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? "")
    ) {
      const rows: string[][] = [];
      const cells = (value: string) =>
        value
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => plain(cell.trim()));
      rows.push(cells(line));
      index++;
      while (
        index + 1 < lines.length &&
        lines[index + 1]!.includes("|") &&
        lines[index + 1]!.trim()
      ) {
        rows.push(cells(lines[++index]!));
      }
      if (rows.length > 100 || rows.some((row) => row.length > 50))
        throw new Error("마크다운 표가 너무 큽니다.");
      const width = Math.max(...rows.map((row) => row.length));
      blocks.push({
        kind: "table",
        rows: rows.map((row) => [
          ...row,
          ...Array(width - row.length).fill(""),
        ]),
      });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading)
      blocks.push({
        kind: "heading",
        level: heading[1]!.length,
        text: plain(heading[2]!),
      });
    else if (/^\s*[-*+]\s+/.test(line))
      blocks.push({
        kind: "bullet",
        text: plain(line.replace(/^\s*[-*+]\s+/, "")),
      });
    else if (/^\s*\d+[.)]\s+/.test(line))
      blocks.push({
        kind: "numbered",
        text: plain(line.replace(/^\s*\d+[.)]\s+/, "")),
      });
    else blocks.push({ kind: "paragraph", text: plain(line) });
  }
  if (code) throw new Error("코드 블록이 닫히지 않았습니다.");
  if (blocks.length > 10000) throw new Error("마크다운 문단이 너무 많습니다.");
  return blocks;
}
