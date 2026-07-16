import { readAppState } from "@agent-native/core/application-state";

import {
  getGenerationCreativeContext as getGenerationCreativeContextLocal,
  recordGenerationCreativeContext as recordGenerationCreativeContextLocal,
  type GenerationContextReadScope,
} from "../store/generation.js";
import {
  getContextPack,
  getCreativeContextItem,
  listAccessibleSearchDocuments,
} from "../store/index.js";
import type {
  CreativeContextElementProvenance,
  CreativeContextReuseLabel,
} from "../types.js";
import {
  callIsolatedCreativeContextA2A,
  hasIsolatedCreativeContextA2A,
  isolatedResolvePayload,
  type IsolatedRecordPayload,
} from "./isolated-a2a.js";
import { performCreativeContextSearch } from "./retrieval.js";
import {
  sanitizeUntrustedReference,
  UNTRUSTED_REFERENCE_ROLE,
} from "./untrusted-reference.js";

export type CreativeGenerationRole = "slides" | "design" | "assets" | "content";
export type CreativeContextModeOverride = "off";

export function mergeCreativeContextReuseLabels(
  previous: readonly CreativeContextReuseLabel[],
  next: readonly CreativeContextReuseLabel[],
): CreativeContextReuseLabel[] {
  return Array.from(
    new Map(
      [...previous, ...next].map((label) => [
        [
          label.itemId ?? "",
          label.itemVersionId ?? "",
          label.elementId ?? "",
          label.influence ?? "reference-conditioned",
          label.kind,
          label.label,
        ].join("\u0000"),
        label,
      ]),
    ).values(),
  );
}

export function replaceCreativeContextElementProvenance(
  previous: readonly CreativeContextElementProvenance[],
  next: readonly CreativeContextElementProvenance[],
): CreativeContextElementProvenance[] {
  const replacedElementIds = new Set(next.map((entry) => entry.elementId));
  const merged = [
    ...previous.filter((entry) => !replacedElementIds.has(entry.elementId)),
    ...next,
  ];
  return Array.from(
    new Map(
      merged.map((entry) => [
        [
          entry.elementId,
          entry.influence,
          entry.itemId ?? "",
          entry.itemVersionId ?? "",
          entry.label ?? "",
        ].join("\u0000"),
        entry,
      ]),
    ).values(),
  );
}

export interface ResolveGenerationCreativeContextInput {
  query?: string;
  role: CreativeGenerationRole;
  limit?: number;
  contextPackId?: string;
  contextPackSource?: "explicit" | "inherited";
  contextModeOverride?: CreativeContextModeOverride;
}

export function validateCreativeContextReuseLabels(
  labels: CreativeContextReuseLabel[],
  options: {
    allowedEvidence?: ReadonlySet<string>;
    generatedOnly?: boolean;
  } = {},
): CreativeContextReuseLabel[] {
  return labels.map((label) => {
    const influence = label.influence ?? "reference-conditioned";
    const hasItemId = Boolean(label.itemId);
    const hasItemVersionId = Boolean(label.itemVersionId);
    if (hasItemId !== hasItemVersionId) {
      throw new Error(
        "Generation reuse labels must provide both itemId and itemVersionId",
      );
    }
    if (influence !== "generated" && !hasItemId) {
      throw new Error(
        "Only generated element labels may omit itemId and itemVersionId",
      );
    }
    if (options.generatedOnly && influence !== "generated") {
      throw new Error(
        "Creative context is off; only generated element labels may be recorded",
      );
    }
    if (
      hasItemId &&
      options.allowedEvidence &&
      !options.allowedEvidence.has(`${label.itemId}:${label.itemVersionId}`)
    ) {
      throw new Error("Generation reuse labels must belong to contextPackId");
    }
    return { ...label, influence };
  });
}

async function exactPackContext(packId: string) {
  const pack = await getContextPack(packId);
  if (!pack) throw new Error("Context pack not found or not accessible");
  const details = await Promise.all(
    pack.members.map((member) =>
      getCreativeContextItem(member.itemId, member.itemVersionId),
    ),
  );
  const results = details.flatMap((detail) =>
    detail
      ? [
          {
            itemId: detail.item.id,
            itemVersionId: detail.version.id,
            kind: detail.item.kind,
            title: sanitizeUntrustedReference(detail.item.title),
            excerpt: sanitizeUntrustedReference(
              detail.version.summary ?? detail.version.content.slice(0, 600),
            ),
            dataRole: UNTRUSTED_REFERENCE_ROLE,
          },
        ]
      : [],
  );
  const reuseLabels: CreativeContextReuseLabel[] = results.map((result) => ({
    itemId: result.itemId,
    itemVersionId: result.itemVersionId,
    kind: result.kind,
    label: result.title,
    dataRole: UNTRUSTED_REFERENCE_ROLE,
  }));
  return {
    contextMode: "pinned" as const,
    contextPackId: pack.id,
    reuseLabels,
    results,
  };
}

export async function resolveGenerationCreativeContext(
  input: ResolveGenerationCreativeContextInput,
) {
  if (input.contextModeOverride === "off") {
    return resolveGenerationCreativeContextLocal(input);
  }
  if (hasIsolatedCreativeContextA2A()) {
    const state = (await readAppState("creative-context").catch(
      () => null,
    )) as {
      contextMode?: "auto" | "off";
      pinnedPackId?: string | null;
    } | null;
    if (state?.contextMode === "off") {
      return resolveGenerationCreativeContextLocal(input);
    }
    return callIsolatedCreativeContextA2A("resolve", {
      ...isolatedResolvePayload(input),
      ...(input.contextPackId || !state?.pinnedPackId
        ? {}
        : {
            contextPackId: state.pinnedPackId,
            contextPackSource: "inherited" as const,
          }),
    });
  }
  return resolveGenerationCreativeContextLocal(input);
}

export async function resolveGenerationCreativeContextLocal(
  input: ResolveGenerationCreativeContextInput,
) {
  if (input.contextModeOverride === "off") {
    if (
      input.contextPackId &&
      (input.contextPackSource ?? "explicit") === "explicit"
    ) {
      throw new Error(
        "Creative context is off for this generation; contextPackId cannot be applied",
      );
    }
    return {
      contextMode: "off" as const,
      contextPackId: null,
      reuseLabels: [],
      results: [],
    };
  }
  const state = (await readAppState("creative-context").catch(() => null)) as {
    contextMode?: "auto" | "off";
    pinnedPackId?: string | null;
  } | null;
  if (state?.contextMode === "off") {
    if (
      input.contextPackId &&
      (input.contextPackSource ?? "explicit") === "explicit"
    ) {
      throw new Error(
        "Creative context is off; an explicit contextPackId cannot be applied",
      );
    }
    return {
      contextMode: "off" as const,
      contextPackId: null,
      reuseLabels: [],
      results: [],
    };
  }
  if (input.contextPackId) return exactPackContext(input.contextPackId);
  const exactPackId = state?.pinnedPackId ?? undefined;
  if (exactPackId) return exactPackContext(exactPackId);
  if (!input.query?.trim()) {
    throw new Error(
      "query is required when no exact contextPackId is supplied",
    );
  }
  const search = await performCreativeContextSearch({
    query: input.query,
    limit: Math.max(1, Math.min(20, input.limit ?? 8)),
    maxPerSource: 3,
    snapshot: true,
    contextPackName: `${input.role}: ${input.query.slice(0, 100)}`,
  });
  return {
    contextMode: "auto" as const,
    contextPackId: search.contextPackId,
    reuseLabels: search.results.map((result) => ({
      itemId: result.itemId,
      itemVersionId: result.itemVersionId,
      kind: result.kind,
      label: sanitizeUntrustedReference(result.title)
        .replaceAll("<<<UNTRUSTED_REFERENCE>>>", "")
        .replaceAll("<<<END_UNTRUSTED_REFERENCE>>>", "")
        .trim(),
      dataRole: UNTRUSTED_REFERENCE_ROLE,
    })),
    results: search.results,
  };
}

export interface ValidateGenerationCreativeContextInput {
  contextPackId?: string | null;
  contextPackSource?: "explicit" | "inherited";
  reuseLabels?: CreativeContextReuseLabel[];
  reuseLabelsSource?: "explicit" | "inherited";
  contextModeOverride?: CreativeContextModeOverride;
}

export async function validateGenerationCreativeContext(
  input: ValidateGenerationCreativeContextInput,
) {
  if (input.contextModeOverride === "off") {
    return validateGenerationCreativeContextLocal(input);
  }
  if (hasIsolatedCreativeContextA2A()) {
    const state = (await readAppState("creative-context").catch(
      () => null,
    )) as {
      contextMode?: "auto" | "off";
    } | null;
    if (state?.contextMode === "off") {
      return validateGenerationCreativeContextLocal(input);
    }
    return callIsolatedCreativeContextA2A("validate", {
      contextPackId: input.contextPackId,
      contextPackSource: input.contextPackSource,
      reuseLabels: input.reuseLabels,
      reuseLabelsSource: input.reuseLabelsSource,
    });
  }
  return validateGenerationCreativeContextLocal(input);
}

export async function validateGenerationCreativeContextLocal(
  input: ValidateGenerationCreativeContextInput,
) {
  const offReuseLabels = () => {
    const labels = input.reuseLabels ?? [];
    return input.reuseLabelsSource === "inherited"
      ? labels.filter(
          (label) =>
            (label.influence ?? "reference-conditioned") === "generated" &&
            !label.itemId &&
            !label.itemVersionId,
        )
      : labels;
  };
  if (input.contextModeOverride === "off") {
    if (
      input.contextPackId &&
      (input.contextPackSource ?? "explicit") === "explicit"
    ) {
      throw new Error(
        "Creative context is off for this generation; contextPackId cannot be applied",
      );
    }
    return {
      contextMode: "off" as const,
      contextPackId: null,
      reuseLabels: validateCreativeContextReuseLabels(offReuseLabels(), {
        generatedOnly: true,
      }),
      results: [],
    };
  }
  const state = (await readAppState("creative-context").catch(() => null)) as {
    contextMode?: "auto" | "off";
  } | null;
  if (state?.contextMode === "off") {
    if (
      input.contextPackId &&
      (input.contextPackSource ?? "explicit") === "explicit"
    ) {
      throw new Error(
        "Creative context is off; an explicit contextPackId cannot be applied",
      );
    }
    return {
      contextMode: "off" as const,
      contextPackId: null,
      reuseLabels: validateCreativeContextReuseLabels(offReuseLabels(), {
        generatedOnly: true,
      }),
      results: [],
    };
  }
  if (input.contextPackId) {
    const exact = await exactPackContext(input.contextPackId);
    const allowed = new Set(
      exact.reuseLabels.map(
        (label) => `${label.itemId}:${label.itemVersionId}`,
      ),
    );
    return {
      ...exact,
      reuseLabels: input.reuseLabels
        ? validateCreativeContextReuseLabels(input.reuseLabels, {
            allowedEvidence: allowed,
          })
        : exact.reuseLabels,
    };
  }
  const anyContext = await listAccessibleSearchDocuments({ limit: 1 });
  if (anyContext.length === 0) {
    return {
      contextMode: "auto" as const,
      contextPackId: null,
      reuseLabels: validateCreativeContextReuseLabels(input.reuseLabels ?? [], {
        generatedOnly: true,
      }),
      results: [],
    };
  }
  throw new Error(
    "Creative context is enabled and available. Resolve context before the final write and pass its exact contextPackId and reuseLabels.",
  );
}

export async function recordGenerationCreativeContext(
  input: IsolatedRecordPayload,
  options: { db?: any } = {},
) {
  if (
    input.contextMode !== "off" &&
    !options.db &&
    hasIsolatedCreativeContextA2A()
  ) {
    return callIsolatedCreativeContextA2A("record", input);
  }
  return recordGenerationCreativeContextLocal(input, options);
}

export async function getGenerationCreativeContext(
  input: {
    appId: string;
    artifactType: string;
    artifactId: string;
  },
  options: {
    accessScope?: GenerationContextReadScope;
    db?: any;
  } = {},
) {
  if (!options.db && hasIsolatedCreativeContextA2A()) {
    const state = (await readAppState("creative-context").catch(
      () => null,
    )) as {
      contextMode?: "auto" | "off";
    } | null;
    if (state?.contextMode !== "off") {
      return callIsolatedCreativeContextA2A("read", {
        identity: input,
        accessScope: options.accessScope ?? "owner",
      });
    }
  }
  return getGenerationCreativeContextLocal(input, {
    accessScope: options.accessScope,
  });
}
