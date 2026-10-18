/** Follow a foreground action to its result without taking focus back from the user. */
export function prepareCompletionFocus(trigger: HTMLElement) {
  const document = trigger.ownerDocument;
  const view = document.defaultView;
  let moved = document.activeElement !== trigger;
  let disposed = false;
  let frame: number | undefined;
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
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    document.removeEventListener("focusin", onFocus, true);
    document.removeEventListener("pointerdown", abandon, true);
    document.removeEventListener("keydown", abandon, true);
    view?.removeEventListener("blur", abandon);
  };
  return {
    dispose,
    complete(target: () => HTMLElement | null | undefined) {
      if (disposed || !view) {
        dispose();
        return;
      }
      frame = view.requestAnimationFrame(() => {
        const active = document.activeElement;
        const result = target();
        const shouldFocus =
          !moved &&
          document.hasFocus() &&
          (active === trigger || active === document.body) &&
          result?.isConnected;
        dispose();
        if (shouldFocus) {
          result.focus({ preventScroll: true });
          result.scrollIntoView({ block: "nearest" });
        }
      });
    },
  };
}
