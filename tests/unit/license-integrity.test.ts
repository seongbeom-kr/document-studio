import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { lockfileSha256 } from "../../scripts/lockfile-hash.mjs";

const lock = [
  "version = 4",
  "",
  "[[package]]",
  'name = "example"',
  'version = "1.2.3"',
  'source = "registry+https://github.com/rust-lang/crates.io-index"',
  'checksum = "0123456789abcdef"',
  "",
].join("\n");

describe("license inventory lockfile integrity", () => {
  it("uses the original LF bytes as the canonical digest", () => {
    expect(lockfileSha256(lock)).toBe(
      createHash("sha256").update(lock, "utf8").digest("hex"),
    );
  });

  it("accepts Git's Windows CRLF checkout of the same lockfile", () => {
    expect(lockfileSha256(lock.replace(/\n/g, "\r\n"))).toBe(
      lockfileSha256(lock),
    );
  });

  it.each([
    ['version = "1.2.3"', 'version = "1.2.4"'],
    ['checksum = "0123456789abcdef"', 'checksum = "fedcba9876543210"'],
    ['name = "example"', 'name = "different"'],
    ["\n\n", "\n \n"],
  ])("still detects changes to %s", (before, after) => {
    const changed = lock.replace(before, after).replace(/\n/g, "\r\n");
    expect(lockfileSha256(changed)).not.toBe(lockfileSha256(lock));
  });
});
