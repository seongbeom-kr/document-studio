import { describe, expect, it } from "vitest";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import {
  inspectTemplate,
  renderTemplate,
  verifyTemplateOutput,
  validateTemplateDefinition,
  type TemplateDefinition,
} from "../../packages/template/src/index";

const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const hp = "http://www.hancom.co.kr/hwpml/2011/paragraph";
function fixture(format: "docx" | "hwpx", content: string) {
  return zipSync(
    format === "docx"
      ? {
          "[Content_Types].xml": strToU8(
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
          ),
          "word/document.xml": strToU8(
            `<w:document xmlns:w="${word}"><w:body>${content}</w:body></w:document>`,
          ),
          "word/media/logo.png": new Uint8Array([1, 2, 3]),
        }
      : {
          mimetype: strToU8("application/hwp+zip"),
          "Contents/header.xml": strToU8(
            '<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"/>',
          ),
          "Contents/section0.xml": strToU8(
            `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="${hp}">${content}</hs:sec>`,
          ),
          "BinData/logo.png": new Uint8Array([1, 2, 3]),
        },
  );
}
function definition(
  sourceHash: string,
  format: "docx" | "hwpx",
  targetId: string,
): TemplateDefinition {
  return {
    schemaVersion: 2,
    sourceHash,
    format,
    fields: [
      { id: "f_text", label: "작성 내용", type: "string", required: true },
    ],
    bindings: [{ id: "b_text", fieldId: "f_text", targetId }],
    repeatGroups: [],
    rules: [],
    output: { titleFieldId: "f_text" },
  };
}
const extract = (bytes: Uint8Array, part: string) =>
  strFromU8(unzipSync(bytes)[part]!);
describe("generic template runtime", () => {
  it("does not use a nested table's grid span to label an outer cell",async()=>{
    const bytes=fixture("docx",'<w:tbl><w:tr><w:tc><w:p/><w:tbl><w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>중첩</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc><w:tc><w:p><w:r><w:t>바깥 둘째</w:t></w:r></w:p></w:tc></w:tr></w:tbl>');
    const s=await inspectTemplate({bytes,format:"docx"});
    expect(s.targets.find(t=>t.text==="바깥 둘째")!.column).toBe(2);
  });
  it("preserves ordinary fixed hyperlinks without fetching or blocking other targets", async () => {
    const parts = unzipSync(
      fixture(
        "docx",
        '<w:p><w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rLink"><w:r><w:t>참고</w:t></w:r></w:hyperlink></w:p><w:p><w:r><w:t>작성</w:t></w:r></w:p>',
      ),
    );
    parts["word/_rels/document.xml.rels"] = strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/reference" TargetMode="External"/></Relationships>',
    );
    const source = zipSync(parts),
      s = await inspectTemplate({ bytes: source, format: "docx" });
    expect(s.targets[0]!.editable).toBe(false);
    expect(s.targets[1]!.editable).toBe(true);
    const d = definition(s.sourceHash, "docx", s.targets[1]!.id),
      out = await renderTemplate({
        bytes: source,
        format: "docx",
        definition: d,
        input: { f_text: "완료" },
      });
    expect(unzipSync(out.bytes)["word/_rels/document.xml.rels"]).toEqual(
      parts["word/_rels/document.xml.rels"],
    );
  });
  it("blocks a row crossed by an earlier HWPX vertical merge and reports its real column", async () => {
    const cell = (r: number, c: number, span: number, text: string) =>
      `<hp:tc><hp:cellAddr rowAddr="${r}" colAddr="${c}"/><hp:cellSpan rowSpan="${span}" colSpan="1"/><hp:subList><hp:p><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList></hp:tc>`;
    const bytes = fixture(
      "hwpx",
      `<hp:p><hp:run><hp:tbl id="1" rowCnt="2" colCnt="2"><hp:tr>${cell(0, 0, 2, "병합")}${cell(0, 1, 1, "위")}</hp:tr><hp:tr>${cell(1, 1, 1, "작성")}</hp:tr></hp:tbl></hp:run></hp:p>`,
    );
    const s = await inspectTemplate({ bytes, format: "hwpx" });
    expect(s.rows[1]!.repeatable).toBe(false);
    expect(s.targets.find((t) => t.text === "작성")!.column).toBe(2);
  });
  it.each(["docx", "hwpx"] as const)(
    "inspects unknown %s without placeholders or a registry",
    async (format) => {
      const xml =
        format === "docx"
          ? "<w:p><w:r><w:t>새 양식</w:t></w:r></w:p><w:p><w:r><w:t>새 양식</w:t></w:r></w:p>"
          : '<hp:p id="0"><hp:run charPrIDRef="1"><hp:t>새 양식</hp:t></hp:run></hp:p><hp:p id="1"><hp:run charPrIDRef="1"><hp:t>새 양식</hp:t></hp:run></hp:p>';
      const snapshot = await inspectTemplate({
        bytes: fixture(format, xml),
        format,
      });
      expect(snapshot.targets).toHaveLength(2);
      expect(snapshot.targets[0]!.id).not.toBe(snapshot.targets[1]!.id);
      expect(snapshot.targets.map((t) => t.text)).toEqual([
        "새 양식",
        "새 양식",
      ]);
      expect(snapshot.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    },
  );
  it("changes only a selected split-run range and preserves other parts and original bytes", async () => {
    const source = fixture(
      "docx",
      "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>라벨: 원</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>본 끝</w:t></w:r></w:p><w:p><w:r><w:t>원본</w:t></w:r></w:p>",
    );
    const before = source.slice();
    const snapshot = await inspectTemplate({ bytes: source, format: "docx" });
    const def = definition(
      snapshot.sourceHash,
      "docx",
      snapshot.targets[0]!.id,
    );
    def.bindings[0] = { ...def.bindings[0]!, start: 4, end: 6 };
    const result = await renderTemplate({
      bytes: source,
      format: "docx",
      definition: def,
      input: { f_text: "변경" },
    });
    const after = await inspectTemplate({
      bytes: result.bytes,
      format: "docx",
    });
    expect(after.targets.map((t) => t.text)).toEqual(["라벨: 변경 끝", "원본"]);
    expect(extract(result.bytes, "word/document.xml")).toContain("<w:b/>");
    expect(extract(result.bytes, "word/document.xml")).toContain("<w:i/>");
    expect(unzipSync(result.bytes)["word/media/logo.png"]).toEqual(
      unzipSync(source)["word/media/logo.png"],
    );
    expect(source).toEqual(before);
    expect(result.outputHash).not.toBe(result.sourceHash);
  });
  it("inserts into an empty cell and refuses stale or overlapping locations", async () => {
    const bytes = fixture(
      "docx",
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t/></w:r></w:p></w:tc></w:tr></w:tbl>",
    );
    const snapshot = await inspectTemplate({ bytes, format: "docx" });
    const def = definition(
      snapshot.sourceHash,
      "docx",
      snapshot.targets[0]!.id,
    );
    const output = await renderTemplate({
      bytes,
      format: "docx",
      definition: def,
      input: { f_text: "셀 내용" },
    });
    expect(
      (await inspectTemplate({ bytes: output.bytes, format: "docx" }))
        .targets[0]!.text,
    ).toBe("셀 내용");
    expect(() =>
      validateTemplateDefinition(
        { ...def, sourceHash: "sha256:" + "0".repeat(64) },
        snapshot,
      ),
    ).toThrow(/SOURCE/);
    expect(() =>
      validateTemplateDefinition(
        {
          ...def,
          bindings: [def.bindings[0]!, { ...def.bindings[0]!, id: "b_other" }],
        },
        snapshot,
      ),
    ).toThrow(/OVERLAP/);
  });
  it("does not expose shape text or tracked changes as editable body targets", async () => {
    const bytes = fixture(
      "docx",
      "<w:p><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>도형</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p><w:ins><w:p><w:r><w:t>변경 추적</w:t></w:r></w:p></w:ins>",
    );
    const snapshot = await inspectTemplate({ bytes, format: "docx" });
    expect(snapshot.targets.every((t) => !t.editable)).toBe(true);
  });
  it("rejects XML entities and stale bytes before producing output", async () => {
    const bad = zipSync({
      "word/document.xml": strToU8(
        '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><x/>',
      ),
    });
    await expect(
      inspectTemplate({ bytes: bad, format: "docx" }),
    ).rejects.toThrow();
    const source = fixture(
      "hwpx",
      '<hp:p id="0"><hp:run charPrIDRef="1"><hp:t>내용</hp:t></hp:run></hp:p>',
    );
    const snapshot = await inspectTemplate({ bytes: source, format: "hwpx" });
    const def = definition(
      snapshot.sourceHash,
      "hwpx",
      snapshot.targets[0]!.id,
    );
    await expect(
      renderTemplate({
        bytes: fixture(
          "hwpx",
          "<hp:p><hp:run><hp:t>다른 파일</hp:t></hp:run></hp:p>",
        ),
        format: "hwpx",
        definition: def,
        input: { f_text: "값" },
      }),
    ).rejects.toThrow(/SOURCE/);
  });
  it.each(["docx", "hwpx"] as const)(
    "writes multiline %s values as real line breaks",
    async (format) => {
      const bytes = fixture(
        format,
        format === "docx"
          ? "<w:p><w:r><w:t>내용</w:t></w:r></w:p>"
          : '<hp:p id="0"><hp:run charPrIDRef="0"><hp:t>내용</hp:t></hp:run></hp:p>',
      );
      const s = await inspectTemplate({ bytes, format }),
        d = definition(s.sourceHash, format, s.targets[0]!.id);
      d.fields[0]!.type = "multilineText";
      const out = await renderTemplate({
        bytes,
        format,
        definition: d,
        input: { f_text: "첫 줄\r\n다음 줄" },
      });
      expect(
        (await inspectTemplate({ bytes: out.bytes, format })).targets[0]!.text,
      ).toBe("첫 줄\n다음 줄");
    },
  );
  it("repeats arbitrary table rows without fixed business columns and preserves surrounding text", async () => {
    const bytes = fixture(
      "docx",
      "<w:p><w:r><w:t>고정 제목</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>항목</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>수량</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>예시</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
    );
    const s = await inspectTemplate({ bytes, format: "docx" }),
      row = s.rows[1]!;
    const d: TemplateDefinition = {
      schemaVersion: 2,
      sourceHash: s.sourceHash,
      format: "docx",
      fields: [
        {
          id: "f_rows",
          label: "내역",
          type: "array",
          required: true,
          itemFields: [
            { id: "f_name", label: "항목", type: "string", required: true },
            { id: "f_count", label: "수량", type: "integer", required: true },
          ],
        },
      ],
      bindings: [],
      repeatGroups: [
        {
          id: "g_rows",
          rowId: row.id,
          fieldId: "f_rows",
          maxRows: 10,
          empty: "remove",
          bindings: [
            { id: "b_name", targetId: row.targetIds[0]!, fieldId: "f_name" },
            { id: "b_count", targetId: row.targetIds[1]!, fieldId: "f_count" },
          ],
        },
      ],
      rules: [],
      output: {},
    };
    const out = await renderTemplate({
      bytes,
      format: "docx",
      definition: d,
      input: {
        f_rows: [
          { f_name: "새 항목", f_count: 2 },
          { f_name: "둘째", f_count: 3 },
        ],
      },
    });
    expect(
      (await inspectTemplate({ bytes: out.bytes, format: "docx" })).targets.map(
        (t) => t.text,
      ),
    ).toEqual(["고정 제목", "항목", "수량", "새 항목", "2", "둘째", "3"]);
    const empty = await renderTemplate({
      bytes,
      format: "docx",
      definition: d,
      input: { f_rows: [] },
    });
    expect(
      (await inspectTemplate({ bytes: empty.bytes, format: "docx" })).rows,
    ).toHaveLength(1);
  });
  it("rejects broken Unicode ranges, unknown fields and impossible dates", async () => {
    const bytes = fixture("docx", "<w:p><w:r><w:t>A😀한글</w:t></w:r></w:p>"),
      s = await inspectTemplate({ bytes, format: "docx" });
    const d = definition(s.sourceHash, "docx", s.targets[0]!.id);
    expect(() =>
      validateTemplateDefinition(
        { ...d, bindings: [{ ...d.bindings[0]!, start: 2, end: 3 }] },
        s,
      ),
    ).toThrow(/RANGE/);
    await expect(
      renderTemplate({
        bytes,
        format: "docx",
        definition: d,
        input: { f_text: "값", hidden: "secret" },
      }),
    ).rejects.toThrow(/UNKNOWN/);
    d.fields[0]!.type = "date";
    await expect(
      renderTemplate({
        bytes,
        format: "docx",
        definition: d,
        input: { f_text: "2026-02-30" },
      }),
    ).rejects.toThrow(/INVALID/);
  });
  it("independently rejects a changed logo, fixed text and target font even if the filled value is right", async () => {
    const source = fixture(
      "docx",
      "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>값</w:t></w:r></w:p><w:p><w:r><w:t>고정</w:t></w:r></w:p>",
    );
    const s = await inspectTemplate({ bytes: source, format: "docx" }),
      d = definition(s.sourceHash, "docx", s.targets[0]!.id),
      data = { f_text: "작성됨" };
    const output = await renderTemplate({
      bytes: source,
      format: "docx",
      definition: d,
      input: data,
    });
    await expect(
      verifyTemplateOutput({
        source,
        output: output.bytes,
        format: "docx",
        definition: d,
        input: data,
      }),
    ).resolves.toEqual({ structurePreserved: true });
    for (const mutation of ["logo", "text", "font"]) {
      const parts = unzipSync(output.bytes);
      if (mutation === "logo")
        parts["word/media/logo.png"] = new Uint8Array([4]);
      else
        parts["word/document.xml"] = strToU8(
          strFromU8(parts["word/document.xml"]!).replace(
            mutation === "text" ? "고정" : "<w:b/>",
            mutation === "text" ? "훼손" : "<w:i/>",
          ),
        );
      await expect(
        verifyTemplateOutput({
          source,
          output: zipSync(parts),
          format: "docx",
          definition: d,
          input: data,
        }),
      ).rejects.toThrow(/PRESERVATION/);
    }
  });
  it.each(["docx", "hwpx"] as const)(
    "maps a source %s paragraph with an existing soft line break",
    async (format) => {
      const source = fixture(
        format,
        format === "docx"
          ? "<w:p><w:r><w:t>고정</w:t><w:br/><w:t>예시</w:t></w:r></w:p>"
          : '<hp:p id="0"><hp:run charPrIDRef="0"><hp:t>고정<hp:lineBreak/>예시</hp:t></hp:run></hp:p>',
      );
      const s = await inspectTemplate({ bytes: source, format }),
        d = definition(s.sourceHash, format, s.targets[0]!.id);
      expect(s.targets[0]!.editable).toBe(true);
      expect(s.targets[0]!.text).toBe("고정\n예시");
      d.bindings[0] = { ...d.bindings[0]!, start: 3, end: 5 };
      const out = await renderTemplate({
        bytes: source,
        format,
        definition: d,
        input: { f_text: "변경" },
      });
      expect(
        (await inspectTemplate({ bytes: out.bytes, format })).targets[0]!.text,
      ).toBe("고정\n변경");
      await expect(
        verifyTemplateOutput({
          source,
          output: out.bytes,
          format,
          definition: d,
          input: { f_text: "변경" },
        }),
      ).resolves.toEqual({ structurePreserved: true });
    },
  );
  it("verifies text in real HWPX cells nested inside an outer paragraph", async () => {
    const source = fixture(
      "hwpx",
      '<hp:p id="0"><hp:run charPrIDRef="0"><hp:tbl id="7" rowCnt="1" colCnt="2"><hp:tr><hp:tc><hp:subList><hp:p id="1"><hp:run charPrIDRef="0"><hp:t>채울 곳</hp:t></hp:run></hp:p></hp:subList></hp:tc><hp:tc><hp:subList><hp:p id="2"><hp:run charPrIDRef="0"><hp:t>고정 셀</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>',
    );
    const s = await inspectTemplate({ bytes: source, format: "hwpx" }),
      d = definition(
        s.sourceHash,
        "hwpx",
        s.targets.find((t) => t.text === "채울 곳")!.id,
      ),
      data = { f_text: "완료" };
    const out = await renderTemplate({
        bytes: source,
        format: "hwpx",
        definition: d,
        input: data,
      }),
      parts = unzipSync(out.bytes);
    parts["Contents/section0.xml"] = strToU8(
      strFromU8(parts["Contents/section0.xml"]!).replace("고정 셀", "훼손 셀"),
    );
    await expect(
      verifyTemplateOutput({
        source,
        output: zipSync(parts),
        format: "hwpx",
        definition: d,
        input: data,
      }),
    ).rejects.toThrow(/PRESERVATION/);
  });
  it("rejects moving replacement text from its bold run into an italic run", async () => {
    const source = fixture(
      "docx",
      "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>원문</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>고정</w:t></w:r></w:p>",
    );
    const s = await inspectTemplate({ bytes: source, format: "docx" }),
      d = definition(s.sourceHash, "docx", s.targets[0]!.id),
      data = { f_text: "변경" };
    d.bindings[0]!.end = 2;
    const out = await renderTemplate({
        bytes: source,
        format: "docx",
        definition: d,
        input: data,
      }),
      parts = unzipSync(out.bytes);
    parts["word/document.xml"] = strToU8(
      strFromU8(parts["word/document.xml"]!)
        .replace("변경</w:t>", "</w:t>")
        .replace(">고정</w:t>", ">변경고정</w:t>"),
    );
    await expect(
      verifyTemplateOutput({
        source,
        output: zipSync(parts),
        format: "docx",
        definition: d,
        input: data,
      }),
    ).rejects.toThrow(/PRESERVATION/);
  });
  it("rejects empty typed dates and reference-bearing repeat rows", async () => {
    const bytes = fixture(
      "docx",
      '<w:tbl><w:tr><w:tc><w:p><w:bookmarkStart w:id="7" w:name="ref"/><w:r><w:t>예시</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p></w:tc></w:tr></w:tbl>',
    );
    const s = await inspectTemplate({ bytes, format: "docx" });
    expect(s.rows[0]!.repeatable).toBe(false);
    const d = definition(s.sourceHash, "docx", s.targets[0]!.id);
    d.fields[0] = {
      id: "f_text",
      label: "선택 날짜",
      type: "date",
      required: false,
    };
    d.bindings[0]!.format = { kind: "date", pattern: "YYYY. M. D." };
    await expect(
      renderTemplate({
        bytes,
        format: "docx",
        definition: d,
        input: { f_text: "" },
      }),
    ).rejects.toThrow(/INVALID/);
  });
  it("appends at the end of a paragraph containing only a soft break", async () => {
    const bytes = fixture("docx", "<w:p><w:r><w:br/></w:r></w:p>"),
      s = await inspectTemplate({ bytes, format: "docx" }),
      d = definition(s.sourceHash, "docx", s.targets[0]!.id);
    d.bindings[0] = { ...d.bindings[0]!, start: 1, end: 1 };
    const out = await renderTemplate({
      bytes,
      format: "docx",
      definition: d,
      input: { f_text: "추가" },
    });
    expect(
      (await inspectTemplate({ bytes: out.bytes, format: "docx" })).targets[0]!
        .text,
    ).toBe("\n추가");
  });
  it("clears stale embedded preview images without changing document images", async () => {
    const parts = unzipSync(
      fixture("docx", "<w:p><w:r><w:t>내용</w:t></w:r></w:p>"),
    );
    parts["docProps/thumbnail.jpeg"] = strToU8(
      "old template preview with private example",
    );
    const source = zipSync(parts),
      s = await inspectTemplate({ bytes: source, format: "docx" }),
      d = definition(s.sourceHash, "docx", s.targets[0]!.id),
      data = { f_text: "새 내용" };
    const out = await renderTemplate({
        bytes: source,
        format: "docx",
        definition: d,
        input: data,
      }),
      result = unzipSync(out.bytes);
    expect([...result["docProps/thumbnail.jpeg"]!.slice(0, 3)]).toEqual([
      255, 216, 255,
    ]);
    expect(result["word/media/logo.png"]).toEqual(parts["word/media/logo.png"]);
    expect(
      await verifyTemplateOutput({
        source,
        output: out.bytes,
        format: "docx",
        definition: d,
        input: data,
      }),
    ).toEqual({ structurePreserved: true });
  });
  it("allocates repeated paragraph identifiers outside all existing Word IDs", async () => {
    const ns =
      'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
    const source = fixture(
        "docx",
        `<w:p ${ns} w14:paraId="00000001"><w:r><w:t>고정</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p ${ns} w14:paraId="0000000A"><w:r><w:t>행</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      ),
      s = await inspectTemplate({ bytes: source, format: "docx" }),
      row = s.rows[0]!;
    const d: TemplateDefinition = {
      schemaVersion: 2,
      sourceHash: s.sourceHash,
      format: "docx",
      fields: [
        {
          id: "rows",
          label: "행",
          type: "array",
          required: true,
          itemFields: [
            { id: "name", label: "이름", type: "string", required: true },
          ],
        },
      ],
      bindings: [],
      repeatGroups: [
        {
          id: "repeat",
          rowId: row.id,
          fieldId: "rows",
          maxRows: 5,
          empty: "remove",
          bindings: [
            { id: "slot", targetId: row.targetIds[0]!, fieldId: "name" },
          ],
        },
      ],
      rules: [],
      output: {},
    };
    const data = { rows: [{ name: "첫째" }, { name: "둘째" }] },
      out = await renderTemplate({
        bytes: source,
        format: "docx",
        definition: d,
        input: data,
      });
    const ids = [
      ...extract(out.bytes, "word/document.xml").matchAll(
        /w14:paraId="([^"]+)"/g,
      ),
    ].map((m) => m[1]!.toLowerCase());
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(
      await verifyTemplateOutput({
        source,
        output: out.bytes,
        format: "docx",
        definition: d,
        input: data,
      }),
    ).toEqual({ structurePreserved: true });
  });
});
