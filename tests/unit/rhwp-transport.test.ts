import { expect, it, vi } from "vitest";
import { receiveResponse } from "../../packages/engine-rhwp/src/transport";

it("observes a teardown rejection while command delivery is still pending", async () => {
  let reject!: (error: Error) => void;
  const response = new Promise<string>((_resolve, fail) => {
    reject = fail;
  });
  const cancel = vi.fn();
  const delivery = new Promise<void>(() => {});
  const task = receiveResponse(response, () => delivery, cancel);
  const result = expect(task).rejects.toThrow("closed");
  reject(new Error("closed"));
  await result;
  expect(cancel).toHaveBeenCalledOnce();
});
it("rejects a response whose delivery failed, without leaking an unobserved response rejection", async () => {
  let reject!: (error: Error) => void;
  const response = new Promise<string>((_resolve, fail) => {
    reject = fail;
  });
  await expect(
    receiveResponse(
      response,
      async () => {
        throw new Error("refused");
      },
      reject,
    ),
  ).rejects.toThrow("refused");
});
it("waits for accepted delivery as well as a successful response", async () => {
  let deliver!: () => void;
  const delivery = new Promise<void>((resolve) => {
    deliver = resolve;
  });
  const done = vi.fn(),
    cancel = vi.fn();
  const task = receiveResponse(
    Promise.resolve("state"),
    () => delivery,
    cancel,
  ).then(done);
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  deliver();
  await task;
  expect(done).toHaveBeenCalledWith("state");
  expect(cancel).not.toHaveBeenCalled();
});
