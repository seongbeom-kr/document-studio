import { organizationRows, type OrganizationNode } from "./office-automation";
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );
const colors = [
  "#245f56",
  "#416e9f",
  "#ad6539",
  "#7860a4",
  "#b75060",
  "#577a3c",
];
function svg(width: number, height: number, title: string, content: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escape(title)}</title><rect width="100%" height="100%" fill="white"/><g font-family="Arial,sans-serif" font-size="14" fill="#17212b">${content}</g></svg>`;
}
export interface ChartDatum {
  label: string;
  value: number;
}
export function buildChartSvg(
  data: readonly ChartDatum[],
  kind: "bar" | "line" | "pie" = "bar",
  title = "업무 통계",
): string {
  if (
    !Array.isArray(data) ||
    !data.length ||
    data.length > 50 ||
    title.length > 200 ||
    data.some(
      (item) =>
        !item ||
        typeof item.label !== "string" ||
        item.label.length > 100 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(item.label) ||
        !Number.isFinite(item.value) ||
        Math.abs(item.value) > 1e12,
    )
  )
    throw new Error(
      "차트는 이름과 유한한 숫자가 있는 1~50개 항목을 사용합니다.",
    );
  if (!["bar", "line", "pie"].includes(kind))
    throw new Error("차트 종류가 올바르지 않습니다.");
  const maximum = Math.max(1, ...data.map((item) => Math.abs(item.value)));
  let content = `<text x="24" y="30" font-size="20" font-weight="bold">${escape(title)}</text>`;
  if (kind === "bar") {
    const height = 80 + data.length * 32;
    data.forEach((item, i) => {
      const width = (Math.abs(item.value) / maximum) * 245,
        x = item.value < 0 ? 415 - width : 415,
        y = 58 + i * 32;
      content += `<text x="16" y="${y + 17}">${escape(item.label.slice(0, 18))}</text><rect x="${x}" y="${y}" width="${width}" height="22" fill="${colors[i % colors.length]}"/><text x="${item.value < 0 ? x - 8 : x + width + 8}" y="${y + 17}" text-anchor="${item.value < 0 ? "end" : "start"}">${item.value}</text>`;
    });
    return svg(850, height, title, content);
  }
  if (kind === "line") {
    const points = data.map((item, i) => ({
      x: 80 + (data.length === 1 ? 0 : i / (data.length - 1)) * 640,
      y: 230 - (item.value / maximum) * 140,
      item,
    }));
    content += `<path d="M80 230H740" fill="none" stroke="#bac4cd"/><polyline points="${points.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="#245f56" stroke-width="3"/>`;
    for (const p of points)
      content += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#245f56"/><text x="${p.x}" y="${p.y - 12}" text-anchor="middle">${p.item.value}</text><text x="${p.x}" y="415" text-anchor="middle">${escape(p.item.label.slice(0, 8))}</text>`;
    return svg(850, 450, title, content);
  }
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (data.some((item) => item.value < 0) || total <= 0)
    throw new Error("원형 차트에는 양수 합계와 음수가 아닌 값이 필요합니다.");
  let angle = -Math.PI / 2;
  for (const [i, item] of data.entries()) {
    const next = angle + (item.value / total) * 2 * Math.PI,
      color = colors[i % colors.length];
    if (item.value === total)
      content += `<circle cx="220" cy="225" r="140" fill="${color}"/>`;
    else if (item.value > 0)
      content += `<path d="M220 225 L${220 + 140 * Math.cos(angle)} ${225 + 140 * Math.sin(angle)} A140 140 0 ${next - angle > Math.PI ? 1 : 0} 1 ${220 + 140 * Math.cos(next)} ${225 + 140 * Math.sin(next)} Z" fill="${color}"/>`;
    content += `<rect x="410" y="${65 + i * 24}" width="14" height="14" fill="${color}"/><text x="436" y="${77 + i * 24}">${escape(item.label)}: ${item.value} (${((item.value / total) * 100).toFixed(1)}%)</text>`;
    angle = next;
  }
  return svg(850, Math.max(430, 110 + data.length * 24), title, content);
}
export function buildOrganizationSvg(
  nodes: readonly OrganizationNode[],
  title = "조직도",
): string {
  const paths = organizationRows(nodes);
  if (
    !nodes.length ||
    nodes.length > 60 ||
    title.length > 200 ||
    paths.some((path) => path.length > 8)
  )
    throw new Error("조직도 그림은 1~60개 조직·8단계 이하입니다.");
  const levels: OrganizationNode[][] = [];
  nodes.forEach((node, i) => {
    if (
      !node.id ||
      !node.label ||
      node.label.length > 100 ||
      /[\x00-\x1f]/.test(node.label)
    )
      throw new Error("조직도 이름이 올바르지 않습니다.");
    (levels[paths[i]!.length - 1] ??= []).push(node);
  });
  const rows = Math.max(...levels.map((level) => level.length));
  if (rows > 28)
    throw new Error("같은 단계의 조직은 28개 이하로 나누어 주세요.");
  const height = Math.max(240, rows * 64 + 70),
    width = levels.length * 240 + 40;
  const positions = new Map<string, { x: number; y: number }>();
  levels.forEach((level, d) =>
    level.forEach((node, i) =>
      positions.set(node.id, {
        x: 20 + d * 240,
        y: 65 + ((i + 0.5) * (height - 80)) / level.length - 20,
      }),
    ),
  );
  let content = `<text x="20" y="30" font-size="20" font-weight="bold">${escape(title)}</text>`;
  for (const node of nodes) {
    const p = positions.get(node.id)!;
    if (node.parentId) {
      const parent = positions.get(node.parentId)!;
      content += `<path d="M${parent.x + 190} ${parent.y + 20} H${parent.x + 210} V${p.y + 20} H${p.x}" fill="none" stroke="#8da4b3" stroke-width="2"/>`;
    }
  }
  for (const node of nodes) {
    const p = positions.get(node.id)!;
    content += `<rect x="${p.x}" y="${p.y}" width="190" height="40" rx="4" fill="#eef4f7" stroke="#245f56"/><text x="${p.x + 95}" y="${p.y + 25}" text-anchor="middle">${escape(node.label.length > 16 ? node.label.slice(0, 15) + "…" : node.label)}</text>`;
  }
  return svg(width, height, title, content);
}
/** CSPRNG by default. An explicit random source supports reproducible host simulations/tests. */
export function drawNames(
  names: readonly string[],
  count: number,
  random: () => number = () =>
    crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32,
): string[] {
  if (
    !Array.isArray(names) ||
    names.length > 10000 ||
    names.some(
      (name) => typeof name !== "string" || !name.trim() || name.length > 200,
    ) ||
    new Set(names).size !== names.length ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > names.length
  )
    throw new Error(
      "추첨은 중복 없는 이름과 목록 이하의 양수 인원이 필요합니다.",
    );
  const pool = [...names];
  for (let i = pool.length - 1; i > 0; i--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("난수 값이 올바르지 않습니다.");
    const j = Math.floor(value * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}
export function assignTeams(
  names: readonly string[],
  count: number,
  random?: () => number,
): string[][] {
  if (!Number.isInteger(count) || count < 1 || count > names.length)
    throw new Error("조 수가 올바르지 않습니다.");
  const shuffled = drawNames(names, names.length, random),
    groups: string[][] = Array.from({ length: count }, () => []);
  shuffled.forEach((name, i) => groups[i % count]!.push(name));
  return groups;
}
