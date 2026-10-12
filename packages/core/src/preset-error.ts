/** Counts acknowledged steps. Atomic adapters either commit the whole preset or keep the original model. */
export class PresetApplicationError extends Error {
  constructor(
    public readonly completedCommands: number,
    public readonly totalCommands: number,
    cause: Error,
  ) {
    super(
      `서식 적용을 중단했습니다 (${completedCommands}/${totalCommands}단계 확인). ${completedCommands ? "일부 서식이 남았습니다. 되돌리기로 복구하거나 현재 상태를 확인한 뒤 다시 적용하세요." : "쓰기 완료가 확인되지 않았습니다. 문서 상태와 권한을 확인한 뒤 다시 적용하세요."} ${cause.message}`,
      { cause },
    );
    this.name = "PresetApplicationError";
  }
}
