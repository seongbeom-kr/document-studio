import {
  OFFICE_AUTOMATION_FORMS,
  automationDefault,
  type CellTransform,
  type AutomationDraftStatus,
  MAIL_MERGE_DRAFT_NAME,
  QUICK_ACTION_DRAFT_NAME,
} from "@document-studio/core";
import type {
  AutomationDraftState,
  AutomationDraftStore,
} from "./automation-drafts";
import {
  validateAutomationDraftState,
  validateAutomationDraftForRepair,
} from "./automation-validation";

export interface AutomationDraft {
  input: string;
  argument: string;
  transform: CellTransform;
  delimiter: string;
}
export type { AutomationDraftStatus } from "@document-studio/core";
/** Fields stay in memory unless the host explicitly supplies an isolated draft store. */
export class AutomationSession {
  utility = "금액 한글화";
  private drafts = new Map<string, AutomationDraft>();
  revision = 0;
  private storedRevision = 0;
  private active = false;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private loadPromise: Promise<void> = Promise.resolve();
  private write: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private status: AutomationDraftStatus;
  private recoveryOriginal: unknown;
  private repairable?: AutomationDraftState;
  private validationError() {
    try {
      validateAutomationDraftState({
        version: 1,
        utility: this.utility,
        drafts: Object.fromEntries(this.drafts),
      });
      return "";
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  }
  recoveryData() {
    return structuredClone(this.recoveryOriginal);
  }
  hasRecovery() {
    return this.recoveryOriginal !== undefined;
  }
  canRepair() {
    return Boolean(this.repairable);
  }
  repairStoredDraft() {
    if (!this.active || !this.repairable)
      throw new Error("편집해 복구할 자동화 초안이 없습니다.");
    this.utility = this.repairable.utility;
    this.drafts = new Map(
      Object.entries(structuredClone(this.repairable.drafts)),
    );
    this.revision++;
    this.loadPromise = Promise.resolve();
    this.update({ ready: true, pending: true, error: this.validationError() });
  }
  constructor(
    private persistence?: { store: AutomationDraftStore; key: string },
  ) {
    this.status = {
      ready: !persistence,
      pending: false,
      storage: persistence ? "local" : "memory",
      error: "",
    };
  }
  getSnapshot = () => this.status;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<AutomationDraftStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  snapshot(): AutomationDraftState {
    return {
      version: 1,
      utility: this.utility,
      drafts: structuredClone(Object.fromEntries(this.drafts)),
    };
  }
  async start() {
    this.active = true;
    const generation = ++this.generation;
    if (!this.persistence) return;
    this.update({ ready: false, error: "" });
    this.recoveryOriginal = undefined;
    this.repairable = undefined;
    this.loadPromise = (async () => {
      try {
        const saved = await this.persistence!.store.get(this.persistence!.key);
        if (!this.active || generation !== this.generation) return;
        if (saved !== undefined) {
          const copy: unknown = structuredClone(saved);
          try {
            validateAutomationDraftState(copy);
          } catch (cause) {
            this.recoveryOriginal = copy;
            try {
              validateAutomationDraftForRepair(copy);
              this.repairable = copy;
            } catch {
              /* Keep malformed originals downloadable without treating them as editable values. */
            }
            throw cause;
          }
          this.utility = copy.utility;
          this.drafts = new Map(Object.entries(copy.drafts));
        }
        this.storedRevision = this.revision;
        this.update({ ready: true, pending: false, error: "" });
      } catch (cause) {
        if (this.active && generation === this.generation)
          this.update({
            ready: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        throw cause;
      }
    })();
    await this.loadPromise;
  }
  dispose() {
    this.active = false;
    this.generation++;
    clearTimeout(this.timer);
  }
  async flush() {
    if (!this.persistence) return;
    await this.loadPromise;
    if (!this.status.ready)
      throw new Error("자동화 초안 복구를 먼저 완료해 주세요.");
    clearTimeout(this.timer);
    for (
      let attempt = 0;
      attempt < 3 && this.storedRevision !== this.revision;
      attempt++
    ) {
      const task = this.write
        .catch(() => undefined)
        .then(async () => {
          if (!this.active) throw new Error("자동화 입력 대상이 변경됐습니다.");
          if (this.storedRevision === this.revision) return;
          const revision = this.revision,
            state = this.snapshot(),
            generation = this.generation;
          validateAutomationDraftState(state);
          await this.persistence!.store.put(this.persistence!.key, state);
          if (!this.active || generation !== this.generation)
            throw new Error("자동화 입력 대상이 변경됐습니다.");
          this.storedRevision = revision;
          this.update({
            pending: this.revision !== revision,
            error: this.validationError(),
          });
        });
      this.write = task;
      try {
        await task;
      } catch (cause) {
        if (this.active)
          this.update({
            pending: true,
            error: `자동화 입력을 보관하지 못했습니다: ${cause instanceof Error ? cause.message : String(cause)}`,
          });
        throw cause;
      }
    }
    if (this.storedRevision !== this.revision)
      throw new Error(
        "자동화 입력이 변경 중입니다. 입력을 마친 뒤 다시 저장해 주세요.",
      );
  }
  async discardStoredDraft() {
    if (!this.persistence) return;
    this.dispose();
    await this.write.catch(() => undefined);
    await this.persistence.store.delete(this.persistence.key);
    this.drafts.clear();
    this.utility = "금액 한글화";
    this.revision = 0;
    this.storedRevision = 0;
    await this.start();
  }
  defaults(utility: string): AutomationDraft {
    if (
      utility === MAIL_MERGE_DRAFT_NAME ||
      utility === QUICK_ACTION_DRAFT_NAME
    )
      return { input: "", argument: "", transform: "trim", delimiter: "auto" };
    const form = OFFICE_AUTOMATION_FORMS.find((item) => item.name === utility)!;
    return {
      input: form.example,
      argument: automationDefault(form.argument?.defaultValue ?? ""),
      transform: "trim",
      delimiter: "auto",
    };
  }
  get(utility: string): AutomationDraft {
    return { ...(this.drafts.get(utility) ?? this.defaults(utility)) };
  }
  put(
    utility: string,
    draft: AutomationDraft,
    options: { activate?: boolean } = {},
  ): void {
    if (
      (options.activate === false || this.utility === utility) &&
      JSON.stringify(this.get(utility)) === JSON.stringify(draft)
    )
      return;
    if (options.activate !== false) this.utility = utility;
    this.drafts.set(utility, { ...draft });
    this.revision++;
    const error = this.validationError();
    this.update({ pending: true, error });
    clearTimeout(this.timer);
    if (!error && this.persistence && this.active && this.status.ready) {
      this.timer = setTimeout(() => {
        void this.flush().catch(() => undefined);
      }, 250);
    }
  }
}
