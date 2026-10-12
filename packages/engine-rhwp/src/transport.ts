/** Observe delivery and response together: teardown may reject the response before delivery settles. */
export async function receiveResponse<T>(
  response: Promise<T>,
  send: () => Promise<void>,
  cancel: (error: Error) => void,
): Promise<T> {
  try {
    const [value] = await Promise.all([response, Promise.resolve().then(send)]);
    return value;
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    cancel(error);
    throw error;
  }
}
