import { validateDocumentArchive } from "./archive";
self.onmessage = ({ data }) => {
  try {
    validateDocumentArchive(data.bytes, data.format);
    self.postMessage({ ok: true });
  } catch (cause) {
    self.postMessage({
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
};
