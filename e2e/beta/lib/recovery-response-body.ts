export async function discardRecoveryResponseBody(
  body: { cancel(): Promise<unknown> } | null,
): Promise<{ kind: "discarded" | "unreadable" }> {
  try {
    await body?.cancel();
    return { kind: "discarded" };
  } catch {
    return { kind: "unreadable" };
  }
}
