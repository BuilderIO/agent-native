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

function stripBasePath(pathname: string, basePath: string): string {
  const normalizedBasePath = `/${basePath.replace(/^\/+|\/+$/g, "")}`;
  if (!basePath || normalizedBasePath === "/") return pathname;
  if (pathname === normalizedBasePath) return "/";
  if (pathname.startsWith(`${normalizedBasePath}/`)) {
    return pathname.slice(normalizedBasePath.length);
  }
  return pathname;
}

export function getDesignGenerationPageviewProvenance(
  pathname: string,
  search: string,
  basePath = "",
): DesignGenerationPageviewProvenance {
  const routerPathname = stripBasePath(pathname, basePath);
  const designPath = /^\/design\/([^/]+)\/?$/.exec(routerPathname);
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

export function getDesignGenerationPageviewProvenanceFromProperties(
  properties: Record<string, unknown>,
  basePath = "",
): DesignGenerationPageviewProvenance {
  return getDesignGenerationPageviewProvenance(
    typeof properties.path === "string" ? properties.path : "",
    typeof properties.search === "string" ? properties.search : "",
    basePath,
  );
}
