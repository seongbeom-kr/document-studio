/** Follow a foreground action to its result without taking focus back from the user. */
export function prepareCompletionFocus(trigger: HTMLElement) {
  const document = trigger.ownerDocument;
  const view = document.defaultView;
  let moved = document.activeElement !== trigger;
  let disposed = false;
  const abandon = () => {
    moved = true;
  };
  const onFocus = (event: FocusEvent) => {
    if (event.target !== trigger) abandon();
  };
  document.addEventListener("focusin", onFocus, true);
  document.addEventListener("pointerdown", abandon, true);
  document.addEventListener("keydown", abandon, true);
  view?.addEventListener("blur", abandon);
  const dispose = () => {
    disposed = true;
    document.removeEventListener("focusin", onFocus, true);
    document.removeEventListener("pointerdown", abandon, true);
    document.removeEventListener("keydown", abandon, true);
    view?.removeEventListener("blur", abandon);
  };
  return {
    dispose,
    /** Called after the result DOM commits. False keeps the intent pending while disabled/missing. */
    complete(result: HTMLElement | null | undefined): boolean {
      if (disposed) return true;
      const active = document.activeElement;
      if (
        moved ||
        !document.hasFocus() ||
        (active !== trigger && active !== document.body)
      ) {
        dispose();
        return true;
      }
      if (
        !result?.isConnected ||
        result.matches(":disabled") ||
        result.closest("[inert], [hidden]") ||
        !result.getClientRects().length
      )
        return false;
      dispose();
      result.focus({ preventScroll: true });
      if (document.activeElement === result)
        result.scrollIntoView({ block: "nearest" });
      return true;
    },
  };
}
