import type { TrackingSource } from "@agent-native/core/tracking";

import {
  isHumanCaller,
  trackDesign,
  type DesignCreationMethod,
} from "../server/lib/design-tracking.js";

export const DESIGN_CREATION_METHODS = [
  "blank",
  "prompt",
  "template",
  "duplicate",
  "import_figma",
  "import_url",
  "import_document",
  "import_code",
  "import_project",
  "import_analytics",
  "agent",
] as const satisfies readonly DesignCreationMethod[];

// Fails to compile when DesignCreationMethod gains a value this list misses,
// which would otherwise make create-design reject a valid method.
const _everyCreationMethodListed: Record<
  Exclude<DesignCreationMethod, (typeof DESIGN_CREATION_METHODS)[number]>,
  never
> = {};
void _everyCreationMethodListed;

/**
 * An unlabelled create from the Design UI is the blank-canvas path; any other
 * caller (agent tool call, MCP, A2A, automation) counts as the agent.
 */
export function defaultCreationMethod(
  source: TrackingSource | undefined,
): DesignCreationMethod {
  return isHumanCaller(source) ? "blank" : "agent";
}

/**
 * `design_created` fires once per new `designs` row, right after the insert
 * that created it commits. Callers that reuse create-design must not emit it
 * themselves, or the row is counted twice.
 */
export function trackDesignCreated(
  designId: string,
  properties: {
    creationMethod: DesignCreationMethod;
    projectType: string | null | undefined;
    designSystemId?: string | null;
    sourceDesignId?: string;
    templateId?: string;
    variantCount?: number;
  },
  source?: TrackingSource,
): void {
  try {
    trackDesign(
      "design_created",
      {
        output_id: designId,
        output_type: "design",
        creation_method: properties.creationMethod,
        project_type: properties.projectType ?? "prototype",
        ...(properties.variantCount !== undefined
          ? { variant_count: properties.variantCount }
          : {}),
        ...(properties.designSystemId
          ? { design_system_id: properties.designSystemId }
          : {}),
        ...(properties.sourceDesignId
          ? { source_design_id: properties.sourceDesignId }
          : {}),
        ...(properties.templateId
          ? { template_id: properties.templateId }
          : {}),
      },
      source,
    );
  } catch {
    // coercion-ok: analytics is best-effort; dropping one event beats failing a committed insert.
  }
}
