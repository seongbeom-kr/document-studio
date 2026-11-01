/** Orders asynchronous native selection reads and paints without treating paints as user input. */
export function createTemplateAuthoringSession<T>(port: {
  capture(): Promise<T>;
  highlight(value: T | null): Promise<void>;
  onSelection(value: T): void;
  onError(cause: unknown): void;
}) {
  let active = true,
    sequence = 0,
    last = "",
    painting = Promise.resolve();
  return {
    async capture() {
      const token = ++sequence;
      try {
        const value = await port.capture();
        if (!active || token !== sequence) return;
        const signature = JSON.stringify(value);
        if (signature === last) return;
        last = signature;
        port.onSelection(value);
      } catch (cause) {
        if (active && token === sequence) port.onError(cause);
      }
    },
    highlight(value: T | null) {
      const signature = value === null ? "" : JSON.stringify(value);
      // A controlled echo is not a newer user action; do not discard a later capture.
      if (signature !== last) sequence++;
      last = signature;
      painting = painting
        .catch(() => {})
        .then(async () => {
          if (active) await port.highlight(value);
        })
        .catch((cause) => {
          if (active) port.onError(cause);
        });
      return painting;
    },
    dispose() {
      active = false;
      sequence++;
    },
  };
}
