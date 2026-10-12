import { validateDocumentArchive } from "@document-studio/core";
import { createServerAutomationHost } from "@docx-editor.dev/core/automation";

self.onmessage = ({ data }) => {
  try {
    validateDocumentArchive(data.bytes, "docx");
    const result = createServerAutomationHost(data.bytes);
    if (!result.ok)
      throw new Error(`DOCX 문서를 해석하지 못했습니다: ${result.reason}`);
    result.host.dispose();
    self.postMessage({ ok: true });
  } catch (cause) {
    self.postMessage({
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
};
