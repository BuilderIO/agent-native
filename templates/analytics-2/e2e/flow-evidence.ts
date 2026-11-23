export type FlowEvidence = { screenshot: Buffer };
export type FlowStatus = "PASS" | "FAIL" | "COULD-NOT-RUN";

export async function recordFlowEvidence<T extends { status: FlowStatus }>(
  record: (input: T & { capture?: () => Promise<Buffer> }) => Promise<unknown>,
  input: T,
  evidence?: FlowEvidence,
) {
  const result = await record({
    ...input,
    ...(input.status === "PASS" && evidence
      ? { capture: async () => Buffer.from(evidence.screenshot) }
      : {}),
  });
  if (
    input.status === "PASS" &&
    evidence &&
    (!result ||
      typeof result !== "object" ||
      !("kind" in result) ||
      result.kind !== "saved")
  )
    throw new Error("Flow evidence capture could not be saved");
  return result;
}
