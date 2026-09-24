import { randomUUID } from "node:crypto";

import { ActionContractError, fail } from "../action.js";
import {
  summarizeFigmaNode,
  type FigmaContextNode,
} from "../ingestion/figma.js";
import type { ProviderApiRequestArgs } from "../provider-api/index.js";
import type { DesignSystemSource } from "../shared/design-system-authoring.js";
import type { createDesignSystemAuthoringService } from "./design-system-authoring.js";
import { readDesignSystemSourceFile } from "./design-system-source-files.js";

type Authoring = ReturnType<typeof createDesignSystemAuthoringService>;
type Evidence = {
  evidence: string;
  warnings: string[];
  _agentImages?: Array<{ data: string; mediaType: string }>;
};

export async function readFigmaDesignSystemEvidence(
  urlString: string,
  execute: (args: ProviderApiRequestArgs) => Promise<unknown>,
): Promise<Evidence> {
  const url = new URL(urlString);
  const key = url.pathname.split("/")[2];
  const nodeId = url.searchParams.get("node-id")?.replace(/-/g, ":");
  const envelope = await execute({
    provider: "figma",
    method: "GET",
    path: nodeId ? `/files/${key}/nodes` : `/files/${key}`,
    query: nodeId ? { ids: nodeId, depth: "6" } : { depth: "6" },
    maxBytes: 2000000,
  });
  const response = (
    envelope as {
      response?: {
        ok?: boolean;
        status?: number;
        truncated?: boolean;
        json?: unknown;
      };
    }
  ).response;
  if (!response || response.ok !== true)
    return fail(
      `Figma could not read this file${response?.status ? ` (HTTP ${response.status})` : ""}. Check the connected account's file access.`,
      {
        errorCode: "design_system_figma_access",
        statusCode: response?.status === 429 ? 429 : 422,
      },
    );
  if (response.truncated)
    return fail(
      "Figma evidence exceeded the read limit. Use a specific frame URL.",
      { errorCode: "design_system_figma_too_large", statusCode: 413 },
    );
  const json = response.json as
    | {
        document?: FigmaContextNode;
        nodes?: Record<string, { document?: FigmaContextNode }>;
      }
    | undefined;
  const node = nodeId ? json?.nodes?.[nodeId]?.document : json?.document;
  if (!node || typeof node !== "object")
    return fail("Figma returned no readable node tree.", {
      errorCode: "design_system_source_empty",
      statusCode: 422,
    });
  const summary = summarizeFigmaNode(node, { maxDepth: 6, maxNodes: 300 });
  const evidence = JSON.stringify(summary);
  if (
    !/"(?:fills|style|cornerRadius|fontFamily|fontSize|backgroundColor)"\s*:/.test(
      evidence,
    )
  )
    return fail(
      "This Figma selection contains no usable visual evidence. Choose a frame with styled content.",
      { errorCode: "design_system_source_empty", statusCode: 422 },
    );
  return {
    evidence: `${evidence.slice(0, 22000)}\nFigma node paints, typography and geometry are bounded evidence. This does not enumerate Variables or guarantee complete file fidelity.`,
    warnings: [
      "Figma read bounded to depth 6 and 300 summarized nodes; Variables and off-tree components are not extracted.",
      ...(evidence.length > 22000
        ? ["Serialized Figma evidence truncated to 22,000 characters."]
        : []),
    ],
  };
}

export async function readDesignSystemSource(
  input: { id: string; sourceId: string },
  authoring: Authoring,
  readers: {
    website: (url: string) => Promise<Evidence>;
    figma: (url: string) => Promise<Evidence>;
  },
) {
  const current = await authoring.get(input.id);
  if (!current.canEdit)
    return fail(
      "Editor access is required to read and record source extraction.",
      { errorCode: "forbidden", statusCode: 403 },
    );
  const source = current.workspace?.sources.find(
    (item) => item.id === input.sourceId,
  );
  if (!source)
    return fail("Source not found in this system.", {
      errorCode: "not_found",
      statusCode: 404,
    });
  if (source.excluded)
    return fail("Restore this excluded source before reading it.", {
      errorCode: "design_system_source_excluded",
      statusCode: 409,
    });
  const record = async (
    patch: Pick<
      DesignSystemSource,
      "status" | "evidence" | "provenance" | "error"
    >,
  ) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await authoring.get(input.id);
      if (!latest.workspace)
        return fail("The authoring workspace is missing.", {
          errorCode: "not_found",
          statusCode: 404,
        });
      try {
        return await authoring.update({
          id: input.id,
          expectedRevision: latest.workspace.revision,
          operationId: randomUUID(),
          sourceUpdates: [{ id: input.sourceId, ...patch }],
        });
      } catch (error) {
        if (
          !(error instanceof ActionContractError) ||
          error.errorCode !== "design_system_revision_conflict" ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new Error("Source result could not be persisted.");
  };
  await record({
    status: "reading",
    evidence: source.evidence,
    provenance: source.provenance,
    error: null,
  });
  try {
    const result =
      source.kind === "file"
        ? await readDesignSystemSourceFile(source)
        : source.kind === "website"
          ? await readers.website(source.url)
          : await readers.figma(source.url);
    if (!result.evidence.trim())
      return fail("No useful source evidence was found.", {
        errorCode: "design_system_source_empty",
        statusCode: 422,
      });
    const evidence =
      result.evidence.length > 11000
        ? `${result.evidence.slice(0, 11000)}\n[Stored evidence excerpt; source read returns fuller context.]`
        : result.evidence;
    const saved = await record({
      status: "ready",
      evidence,
      provenance: "extracted",
      error: null,
    });
    return {
      id: input.id,
      sourceId: input.sourceId,
      workspaceRevision: saved.workspace!.revision,
      ...result,
    };
  } catch (error) {
    const code =
      error instanceof ActionContractError
        ? error.errorCode
        : "design_system_source_read_failed";
    const message =
      error instanceof ActionContractError
        ? error.message
        : "The source could not be read. Check access and file validity, then retry.";
    await record({
      status: "needs-attention",
      evidence: source.evidence,
      provenance: source.provenance,
      error: { code, message, retryable: true },
    });
    return fail(message, {
      errorCode: code,
      statusCode: error instanceof ActionContractError ? error.statusCode : 422,
    });
  }
}
