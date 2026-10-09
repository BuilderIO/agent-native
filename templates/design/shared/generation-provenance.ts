export const DESIGN_GENERATION_ATTEMPT_QUERY_PARAM = "generation_attempt_id";

const GENERATION_ATTEMPT_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isDesignGenerationAttemptId(
  value: string | null | undefined,
): value is string {
  return Boolean(value && GENERATION_ATTEMPT_ID_PATTERN.test(value));
}

export type DesignGenerationPageviewProvenance =
  | { kind: "other-route" }
  | { kind: "invalid-route" }
  | { kind: "design-output"; properties: Record<string, string> };

export function getDesignGenerationPageviewProvenance(
  pathname: string,
  search: string,
): DesignGenerationPageviewProvenance {
  const designPath = /^\/design\/([^/]+)\/?$/.exec(pathname);
  if (!designPath) return { kind: "other-route" };

  let outputId: string;
  try {
    outputId = decodeURIComponent(designPath[1] ?? "");
  } catch {
    return { kind: "invalid-route" };
  }
  if (!outputId) return { kind: "invalid-route" };

  const properties: Record<string, string> = { output_id: outputId };
  const params = new URLSearchParams(search);
  const generationAttemptIds = params.getAll(
    DESIGN_GENERATION_ATTEMPT_QUERY_PARAM,
  );
  if (
    generationAttemptIds.length === 1 &&
    isDesignGenerationAttemptId(generationAttemptIds[0])
  ) {
    properties.generation_attempt_id = generationAttemptIds[0];
  }
  return { kind: "design-output", properties };
}
