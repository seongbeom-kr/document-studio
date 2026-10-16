import { createHash } from "node:crypto";

/** Git may check out Cargo.lock with CRLF. Only normalize line endings. */
export function lockfileSha256(text) {
  return createHash("sha256")
    .update(text.replace(/\r\n/g, "\n"), "utf8")
    .digest("hex");
}
