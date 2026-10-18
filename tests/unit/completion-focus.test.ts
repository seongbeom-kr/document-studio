import { expect, it, vi } from "vitest";
import { prepareCompletionFocus } from "../../packages/react/src/completion-focus";

function fixture() {
  const view = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    defaultView: view,
    body: {},
    activeElement: null as unknown,
    hasFocus: (): boolean => true,
  });
  const trigger = { ownerDocument: document } as unknown as HTMLElement;
  document.activeElement = trigger;
  const result = {
    isConnected: true,
    disabled: false,
    hidden: false,
    matches: () => result.disabled,
    closest: () => (result.hidden ? {} : null),
    getClientRects: () => [1],
    focus: vi.fn(() => {
      document.activeElement = result;
    }),
    scrollIntoView: vi.fn(),
  };
  const focus = prepareCompletionFocus(trigger);
  const complete = () => focus.complete(result as unknown as HTMLElement);
  const outsideFocus = () => {
    const event = new Event("focusin");
    Object.defineProperty(event, "target", { value: {} });
    document.dispatchEvent(event);
  };
  return { document, view, trigger, result, focus, complete, outsideFocus };
}

it("retains foreground intent until the committed retry control is attached and enabled", () => {
  const f = fixture();
  f.document.activeElement = f.document.body; // native disable/removal can drop focus without user input
  expect(f.focus.complete(null)).toBe(false);
  f.result.isConnected = false;
  expect(f.complete()).toBe(false);
  f.result.isConnected = true;
  f.result.disabled = true;
  expect(f.complete()).toBe(false);
  f.result.disabled = false;
  f.result.hidden = true;
  expect(f.complete()).toBe(false);
  expect(f.result.focus).not.toHaveBeenCalled();
  f.result.hidden = false;
  expect(f.complete()).toBe(true);
  expect(f.document.activeElement).toBe(f.result);
  expect(f.result.scrollIntoView).toHaveBeenCalledOnce();
  // A later rerender cannot take focus back a second time.
  f.document.activeElement = f.document.body;
  expect(f.complete()).toBe(true);
  expect(f.result.focus).toHaveBeenCalledOnce();
});

it.each(["focus", "pointer", "keyboard", "window-blur"])(
  "abandons the delayed intent after a %s move even if focus returns",
  (move) => {
    const f = fixture();
    f.result.disabled = true;
    expect(f.complete()).toBe(false);
    if (move === "focus") f.outsideFocus();
    if (move === "pointer") f.document.dispatchEvent(new Event("pointerdown"));
    if (move === "keyboard") f.document.dispatchEvent(new Event("keydown"));
    if (move === "window-blur") f.view.dispatchEvent(new Event("blur"));
    f.result.disabled = false;
    f.document.activeElement = f.trigger;
    expect(f.complete()).toBe(true);
    expect(f.result.focus).not.toHaveBeenCalled();
  },
);

it("cancels the pending target when its panel is disposed", () => {
  const f = fixture();
  expect(f.focus.complete(null)).toBe(false);
  f.focus.dispose();
  expect(f.complete()).toBe(true);
  expect(f.result.focus).not.toHaveBeenCalled();
});

it("does not focus a result while the document is unfocused", () => {
  const f = fixture();
  f.document.hasFocus = () => false;
  expect(f.complete()).toBe(true);
  expect(f.result.focus).not.toHaveBeenCalled();
});

it("does not start a foreground intent for a trigger that did not own focus", () => {
  const f = fixture();
  f.focus.dispose();
  f.document.activeElement = {};
  const background = prepareCompletionFocus(f.trigger);
  f.document.activeElement = f.document.body;
  background.complete(f.result as unknown as HTMLElement);
  expect(f.result.focus).not.toHaveBeenCalled();
});
