// The label must be a static method and endpoint, without query values or secrets.
export async function safeRequest<T>(
  label: string,
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const kind =
      error instanceof Error && error.name === "TimeoutError"
        ? "timeout"
        : "request failed";
    throw new Error(`${label}: ${kind}`);
  }
}
