export function builderExecutionHasResponseEvidence(payloadJson: string) {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return Boolean(payload.response && typeof payload.response === "object");
  } catch {
    return false;
  }
}

export function shouldPreserveBuilderExecution(args: {
  state: string;
  payloadJson: string;
}) {
  return (
    args.state === "running" ||
    args.state === "response_received" ||
    args.state === "reconciliation_required" ||
    args.state === "succeeded" ||
    builderExecutionHasResponseEvidence(args.payloadJson)
  );
}
