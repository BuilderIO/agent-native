export interface MotionSourceReadCapability {
  status: "unsupported";
  sourceRef: string;
  errorCode: string;
  reason: string;
}

const PASSIVE_UNSUPPORTED_MOTION_READ_CODES = new Set([
  "motion_css_source_unreadable",
  "motion_html_source_unsupported_authored_motion",
  "motion_local_source_ambiguous_source_file",
  "motion_react_source_unsupported_authored_motion",
]);

export function passiveMotionSourceReadCapability(
  error: unknown,
  sourceRef: string,
): MotionSourceReadCapability | null {
  if (!error || typeof error !== "object") return null;

  const candidate = error as {
    errorCode?: unknown;
    message?: unknown;
    statusCode?: unknown;
  };
  if (
    candidate.statusCode !== 422 ||
    typeof candidate.errorCode !== "string" ||
    !PASSIVE_UNSUPPORTED_MOTION_READ_CODES.has(candidate.errorCode) ||
    typeof candidate.message !== "string" ||
    candidate.message.length === 0
  ) {
    return null;
  }

  return {
    status: "unsupported",
    sourceRef,
    errorCode: candidate.errorCode,
    reason: candidate.message,
  };
}

export function motionSourceReadAllowsWrites(
  capability: MotionSourceReadCapability | null | undefined,
): boolean {
  return capability?.status !== "unsupported";
}

export function motionSourceReadCapabilityForSource(
  capabilities: readonly (MotionSourceReadCapability | null | undefined)[],
  sourceRef: string | null | undefined,
): MotionSourceReadCapability | null {
  if (!sourceRef) return null;
  return (
    capabilities.find(
      (capability) =>
        capability?.sourceRef === sourceRef &&
        capability?.status === "unsupported",
    ) ?? null
  );
}
