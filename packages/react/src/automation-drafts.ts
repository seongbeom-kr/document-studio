import type { AutomationDraft } from "./automation-session";
import { validateAutomationDraftState } from "./automation-validation";
export interface AutomationDraftState {
  version: 1;
  utility: string;
  drafts: Record<string, AutomationDraft>;
}
export interface AutomationDraftStore {
  get(key: string): Promise<AutomationDraftState | undefined>;
  put(key: string, state: AutomationDraftState): Promise<void>;
  delete(key: string): Promise<void>;
}
/** Separate from document bytes. Hosts must supply an owner/workspace-scoped namespace. */
export function browserAutomationDraftStore(): AutomationDraftStore {
  const run = <T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ) =>
    new Promise<T>((resolve, reject) => {
      const open = indexedDB.open("document-studio-automation", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("drafts");
      open.onerror = () =>
        reject(
          open.error ?? new Error("자동화 초안 저장소를 열지 못했습니다."),
        );
      let blocked = false;
      open.onblocked = () => {
        blocked = true;
        reject(
          new Error(
            "다른 화면의 자동화 초안 저장소 작업을 먼저 완료해 주세요.",
          ),
        );
      };
      open.onsuccess = () => {
        const db = open.result;
        if (blocked) {
          db.close();
          return;
        }
        let transaction: IDBTransaction;
        let request: IDBRequest<T>;
        try {
          transaction = db.transaction("drafts", mode);
          request = operation(transaction.objectStore("drafts"));
        } catch (error) {
          db.close();
          reject(error);
          return;
        }
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        transaction.onabort = transaction.onerror = () => {
          db.close();
          reject(
            transaction.error ??
              request.error ??
              new Error("자동화 초안을 보관하지 못했습니다."),
          );
        };
      };
    });
  return {
    get: (key) => run("readonly", (store) => store.get(key)),
    put: async (key, state) => {
      const captured = structuredClone(state);
      validateAutomationDraftState(captured);
      await run("readwrite", (store) => store.put(captured, key));
    },
    delete: async (key) => {
      await run("readwrite", (store) => store.delete(key));
    },
  };
}

export function downloadAutomationDraft(value: unknown) {
  const json = JSON.stringify(value, null, 2);
  if (json === undefined) throw new Error("내려받을 자동화 입력이 없습니다.");
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "자동화-입력.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
