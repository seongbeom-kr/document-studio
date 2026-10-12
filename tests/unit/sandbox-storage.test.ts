import { describe, it, expect, vi } from "vitest";
import {
  createSandboxStorage,
  type SandboxHost,
} from "../../examples/sandbox-agent/storage";
import {
  SaveConflictError,
  type EditorDocument,
} from "../../packages/core/src/index";
const digest = `sha256:${"a".repeat(64)}`;
const document: EditorDocument = {
  id: "doc",
  fileName: "report.docx",
  format: "docx",
  bytes: new Uint8Array([1, 2]),
};
function setup(overrides: Partial<SandboxHost> = {}) {
  const upload = vi.fn().mockResolvedValue({ sha256: "b".repeat(64) });
  const host: SandboxHost = {
    sessionId: "session",
    path: "reports/report.docx",
    getEditToken: () => "lease",
    isBlocked: () => false,
    refresh: vi.fn().mockResolvedValue({ file: { digest } }),
    uploadWorkspaceFile: upload,
    ...overrides,
  };
  return { host, upload, storage: createSandboxStorage(host) };
}
describe("sandbox consumer boundary", () => {
  it("rejects a previous document through a storage bound to a different file", async () => {
    const { storage, upload } = setup({ documentId: "second-file" });
    await expect(
      storage.save({
        document,
        bytes: document.bytes,
        expectedVersion: digest,
      }),
    ).rejects.toBeInstanceOf(SaveConflictError);
    expect(upload).not.toHaveBeenCalled();
  });
  it.each(["blocked", "token"])(
    "rechecks %s after refreshing the source before upload",
    async (kind) => {
      let blocked = false,
        token = "lease";
      const { storage, upload } = setup({
        isBlocked: () => blocked,
        getEditToken: () => token,
        refresh: async () => {
          if (kind === "blocked") blocked = true;
          else token = "replacement";
          return { file: { digest } };
        },
      });
      await expect(
        storage.save({
          document,
          bytes: document.bytes,
          expectedVersion: digest,
        }),
      ).rejects.toThrow("편집권");
      expect(upload).not.toHaveBeenCalled();
    },
  );
  it("preserves a lease error independently of a content conflict", async () => {
    const { storage, upload } = setup(),
      error = { status: 409, code: "EDIT_SESSION_EXPIRED" };
    upload.mockRejectedValue(error);
    await expect(
      storage.save({
        document,
        bytes: document.bytes,
        expectedVersion: digest,
      }),
    ).rejects.toBe(error);
  });
  it("passes the opened digest and lease through the existing upload contract", async () => {
    const { storage, upload } = setup();
    expect(
      await storage.save({
        document,
        bytes: document.bytes,
        expectedVersion: digest,
      }),
    ).toEqual({ version: `sha256:${"b".repeat(64)}` });
    expect(upload).toHaveBeenCalledOnce();
    const args = upload.mock.calls[0]!;
    expect(args[0]).toBe("session");
    expect(args[4]).toEqual({
      path: "reports/report.docx",
      expectedDigest: digest,
      editToken: "lease",
    });
    expect(new Uint8Array(await (args[1] as File).arrayBuffer())).toEqual(
      document.bytes,
    );
  });
  it.each([{ isBlocked: () => true }, { getEditToken: () => undefined }])(
    "rejects unavailable ownership before upload",
    async (overrides) => {
      const { storage, upload } = setup(overrides);
      await expect(
        storage.save({
          document,
          bytes: document.bytes,
          expectedVersion: digest,
        }),
      ).rejects.toThrow();
      expect(upload).not.toHaveBeenCalled();
    },
  );
  it("rejects a missing base version", async () => {
    const { storage, upload } = setup();
    await expect(
      storage.save({ document, bytes: document.bytes }),
    ).rejects.toThrow("digest");
    expect(upload).not.toHaveBeenCalled();
  });
  it("rejects a changed source before transmitting bytes", async () => {
    const { storage, upload } = setup({
      refresh: async () => ({ file: { digest: "changed" } }),
    });
    await expect(
      storage.save({
        document,
        bytes: document.bytes,
        expectedVersion: digest,
      }),
    ).rejects.toBeInstanceOf(SaveConflictError);
    expect(upload).not.toHaveBeenCalled();
  });
  it("maps an atomic complete-edit conflict to SDK conflict", async () => {
    const { storage, upload } = setup();
    upload.mockRejectedValue({ code: "UPLOAD_FILE_CHANGED", status: 409 });
    await expect(
      storage.save({
        document,
        bytes: document.bytes,
        expectedVersion: digest,
      }),
    ).rejects.toBeInstanceOf(SaveConflictError);
  });
  it("acknowledges the committed digest separately from a sandbox synchronization warning", async () => {
    const { storage, upload } = setup();
    upload.mockResolvedValue({
      sha256: "b".repeat(64),
      sandboxSyncWarning: "guest timeout",
    });
    expect(
      await storage.save({
        document,
        bytes: document.bytes,
        expectedVersion: digest,
      }),
    ).toEqual({
      version: `sha256:${"b".repeat(64)}`,
      warnings: [
        {
          code: "sandbox-sync-pending",
          message:
            "파일은 저장됐지만 샌드박스 반영을 확인하지 못했습니다: guest timeout",
        },
      ],
    });
    expect(upload).toHaveBeenCalledOnce();
  });
  it.each(["docx", "hwpx"] as const)(
    "uses the committed %s version for the next edit after a sync warning",
    async (format) => {
      let serverDigest = digest;
      const upload = vi.fn(
        async (_session, _file, _progress, _signal, options) => {
          if (options.expectedDigest !== serverDigest)
            throw { code: "UPLOAD_FILE_CHANGED" };
          serverDigest = `sha256:${upload.mock.calls.length === 1 ? "b".repeat(64) : "c".repeat(64)}`;
          return {
            sha256: serverDigest.slice(7),
            file: { digest: serverDigest },
            sandboxSyncWarning:
              upload.mock.calls.length === 1 ? "guest timeout" : null,
          };
        },
      );
      const { storage } = setup({
        refresh: async () => ({ file: { digest: serverDigest } }),
        uploadWorkspaceFile: upload,
      });
      const doc = { ...document, format, fileName: `report.${format}` };
      const first = await storage.save({
        document: doc,
        bytes: doc.bytes,
        expectedVersion: digest,
      });
      expect(first.warnings?.[0]?.code).toBe("sandbox-sync-pending");
      expect(first.version).toBe(serverDigest);
      const next = await storage.save({
        document: doc,
        bytes: new Uint8Array([3, 4]),
        expectedVersion: first.version,
      });
      expect(next.version).toBe(`sha256:${"c".repeat(64)}`);
      expect(next.warnings).toBeUndefined();
      expect(upload).toHaveBeenCalledTimes(2);
      expect(upload.mock.calls[1]![4].expectedDigest).toBe(first.version);
    },
  );
  it("rejects an unverified completion digest", async () => {
    const { storage, upload } = setup();
    upload.mockResolvedValue({ sha256: "" });
    await expect(
      storage.save({
        document,
        bytes: document.bytes,
        expectedVersion: digest,
      }),
    ).rejects.toThrow("digest");
  });
});
