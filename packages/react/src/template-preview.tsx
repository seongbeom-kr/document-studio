import type { DocumentTemplate } from "@document-studio/core";

const BLOCK_LIMIT = 80,
  ROW_LIMIT = 20,
  COLUMN_LIMIT = 12,
  TEXT_LIMIT = 2000;
const excerpt = (text: string) =>
  text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text;

/** Structural preview only: it never parses HTML or pretends to paginate an engine document. */
export function TemplatePreview({
  template,
  utility,
}: {
  template: DocumentTemplate;
  utility: string;
}) {
  const blocks = template.blocks.slice(0, BLOCK_LIMIT);
  const cards = utility === "명찰" || utility === "회의명패";
  const limited =
    template.blocks.length > BLOCK_LIMIT ||
    blocks.some((block) =>
      block.kind === "table"
        ? block.rows.length > ROW_LIMIT ||
          block.rows.some(
            (row) =>
              row.length > COLUMN_LIMIT ||
              row.some((cell) => cell.length > TEXT_LIMIT),
          )
        : block.text.length > TEXT_LIMIT,
    );
  return (
    <section
      className="ds-template-preview"
      aria-label={`${utility} 구조 미리보기`}
    >
      <h4>문서 구조 미리보기</h4>
      <p className="ds-automation-help">
        원본 입력으로 생성할 내용을 표시합니다. 실제 크기·서식·쪽 나눔은 생성한
        문서에서 확인하세요.
        {cards &&
          " 카드 모양은 내용 확인용입니다. 생성 파일은 일반 문단이며 인쇄용 카드 배치를 제공하지 않습니다."}
      </p>
      <div className={cards ? "ds-preview-cards" : "ds-preview-blocks"}>
        {cards
          ? blocks.flatMap((block, index) => {
              const detail = blocks[index + 1];
              return block.kind === "heading"
                ? [
                    <article
                      className="ds-preview-card"
                      aria-label={`${utility} ${index / 2 + 1}`}
                      key={index}
                    >
                      <strong>{excerpt(block.text)}</strong>
                      {detail?.kind === "paragraph" && (
                        <p>{excerpt(detail.text)}</p>
                      )}
                    </article>,
                  ]
                : [];
            })
          : blocks.map((block, index) => {
              if (block.kind === "table") {
                const ordinal = blocks
                  .slice(0, index + 1)
                  .filter((item) => item.kind === "table").length;
                return (
                  <div
                    className="ds-preview-table-scroll"
                    key={index}
                    tabIndex={0}
                    role="region"
                    aria-label={`표 ${ordinal}`}
                  >
                    <table>
                      <caption>
                        {utility} · 표 {ordinal}
                      </caption>
                      <thead>
                        <tr>
                          {block.rows[0]
                            ?.slice(0, COLUMN_LIMIT)
                            .map((cell, column) => (
                              <th scope="col" key={column}>
                                {excerpt(cell)}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows.slice(1, ROW_LIMIT).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.slice(0, COLUMN_LIMIT).map((cell, column) => (
                              <td key={column}>{excerpt(cell)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }
              if (block.kind === "heading")
                return (
                  <p
                    className={`ds-preview-heading ds-preview-heading-${block.level}`}
                    key={index}
                  >
                    {excerpt(block.text)}
                  </p>
                );
              if (block.kind === "code")
                return <pre key={index}>{excerpt(block.text)}</pre>;
              return (
                <p key={index}>
                  {block.kind === "bullet"
                    ? "• "
                    : block.kind === "numbered"
                      ? "1. "
                      : ""}
                  {excerpt(block.text)}
                </p>
              );
            })}
      </div>
      {limited && (
        <p role="status" className="ds-automation-help">
          큰 결과는 미리보기 일부만 표시합니다. 원본 입력과 생성할 문서의 전체
          내용은 유지됩니다.
        </p>
      )}
    </section>
  );
}
