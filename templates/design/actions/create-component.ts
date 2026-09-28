import { randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import { agentUpdateSelection } from "@agent-native/core/collab";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import { resolveSourceCapabilities } from "../shared/capability-resolver.js";
import {
  buildCodeLayerProjection,
  ensureCodeLayerNodeIdsInHtml,
  mapCodeLayerSourceOffsetThroughEdits,
  resolveCodeLayerTarget,
} from "../shared/code-layer.js";
import type {
  CodeLayerNode,
  CodeLayerProjection,
  CodeLayerSource,
} from "../shared/code-layer.js";
import { agentSelectionDescriptor } from "../shared/collab-selection.js";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_NAME_ATTR,
  COMPONENT_PROP_PREFIX,
  COMPONENT_REF_ATTR,
  linkedComponentRootForNode,
} from "../shared/component-model.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import {
  planLocalJsxVisualEdit,
  type LocalJsxSourceAnchor,
} from "../shared/local-jsx-visual-edit.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";
import readLocalFileAction from "./read-local-file.js";
import writeLocalFileAction from "./write-local-file.js";

export interface ComponentAttributeStamp {
  name: string;
  value: string;
}

export interface CreateComponentSourceExpectation {
  currentContent?: string;
  expectedVersionHash?: string;
}

export interface CreateComponentLocalSourceReceipt {
  kind: "local-file";
  connectionId: string;
  path: string;
  versionHash: string;
}

interface LocalComponentSource extends LocalJsxSourceAnchor {
  connectionId: string;
  path: string;
  expectedVersionHash?: string;
  propStamps?: ComponentAttributeStamp[];
}

export function isLinkedComponentDescendant(
  node: CodeLayerNode,
  projection: CodeLayerProjection,
): boolean {
  const root = linkedComponentRootForNode(node, projection);
  return Boolean(root && root.id !== node.id);
}

export function createComponentSourceMatches(
  live: { content: string; versionHash: string },
  expected?: CreateComponentSourceExpectation,
): boolean {
  return (
    expected === undefined ||
    (expected.currentContent === live.content &&
      expected.expectedVersionHash === live.versionHash)
  );
}

const VARIANT_LIKE_DATA_ATTRS = [
  "data-variant",
  "data-size",
  "data-state",
  "data-color",
  "data-tone",
  "data-intent",
] as const;

const VARIANT_LIKE_ARIA_ATTRS = [
  "aria-pressed",
  "aria-selected",
  "aria-checked",
  "aria-disabled",
] as const;

export function normalizeComponentName(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  return cleaned || "Component";
}

function attrSuffixToPropName(suffix: string): string {
  return suffix.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function deriveComponentPropStamps(
  node: Pick<CodeLayerNode, "dataAttributes" | "attributes">,
): ComponentAttributeStamp[] {
  const stamps: ComponentAttributeStamp[] = [];
  const seen = new Set<string>();

  const push = (propName: string, value: string) => {
    const key = propName.toLowerCase();
    if (!propName || seen.has(key)) return;
    seen.add(key);
    stamps.push({
      name: `${COMPONENT_PROP_PREFIX}${propName}`,
      value,
    });
  };

  for (const attr of VARIANT_LIKE_DATA_ATTRS) {
    const value = node.dataAttributes[attr];
    if (typeof value === "string" && value.trim()) {
      push(attrSuffixToPropName(attr.slice("data-".length)), value.trim());
    }
  }

  for (const attr of VARIANT_LIKE_ARIA_ATTRS) {
    const raw = node.attributes[attr];
    const value = raw === true ? "true" : raw;
    if (typeof value === "string" && value.trim()) {
      push(attrSuffixToPropName(attr.slice("aria-".length)), value.trim());
    }
  }

  return stamps;
}

function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function setAttributeOnOpenTag(
  openTag: string,
  name: string,
  value: string,
): string {
  const attrRe = new RegExp(
    `(\\s${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>"']+)`,
    "i",
  );
  const escaped = escapeAttrValue(value);
  if (attrRe.test(openTag)) {
    return openTag.replace(attrRe, `$1"${escaped}"`);
  }
  const insertOffset = openTag.endsWith("/>")
    ? openTag.length - 2
    : openTag.length - 1;
  return `${openTag.slice(0, insertOffset)} ${name}="${escaped}"${openTag.slice(insertOffset)}`;
}

export function applyComponentAnnotations(
  html: string,
  node: Pick<CodeLayerNode, "source">,
  componentName: string,
  propStamps: ComponentAttributeStamp[],
  componentId?: string,
): { content: string; changed: boolean } {
  const src = node.source;
  if (!src) return { content: html, changed: false };

  let openTag = html.slice(src.openStart, src.openEnd);
  const before = openTag;

  openTag = setAttributeOnOpenTag(openTag, COMPONENT_NAME_ATTR, componentName);
  if (componentId) {
    openTag = setAttributeOnOpenTag(openTag, COMPONENT_ID_ATTR, componentId);
  }
  for (const stamp of propStamps) {
    openTag = setAttributeOnOpenTag(openTag, stamp.name, stamp.value);
  }

  if (openTag === before) return { content: html, changed: false };
  return {
    content: html.slice(0, src.openStart) + openTag + html.slice(src.openEnd),
    changed: true,
  };
}

export default defineAction({
  description:
    "Promote a selected element into a reusable component by stamping the " +
    "deterministic component-instance annotations on its root node: " +
    'data-agent-native-component="<Name>" plus data-agent-native-prop-* for ' +
    "obvious variant-like attributes (data-variant/size/state, aria-pressed, " +
    "etc.). For inline/Alpine designs this writes the HTML directly via the " +
    "deterministic patch path. For localhost React, a single authored JSX " +
    "anchor uses the consented local-file CAS path; transformed, repeated, " +
    "shared, or fusion sources return ctaRequired=true. After it runs the node is a recognised component instance, so " +
    "component-model detection, the canvas outline, and the Component section " +
    "all pick it up.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    nodeId: z
      .string()
      .optional()
      .describe(
        "data-agent-native-node-id (code-layer node id) of the element to promote. Provide nodeId or selector.",
      ),
    selector: z
      .string()
      .optional()
      .describe(
        "CSS selector for the element to promote. Used when nodeId is not available.",
      ),
    name: z
      .string()
      .min(1)
      .describe(
        'Component name, e.g. "PrimaryButton". Normalized to PascalCase.',
      ),
    fileId: z
      .string()
      .optional()
      .describe("Design file id; defaults to index.html"),
    source: z
      .object({
        currentContent: z
          .string()
          .optional()
          .describe("Exact source preimage the editor planned against."),
        expectedVersionHash: z
          .string()
          .optional()
          .describe("Hash of the live source preimage."),
        local: z
          .object({
            connectionId: z.string().min(1),
            path: z.string().min(1),
            line: z.number().int().positive(),
            column: z.number().int().positive(),
            positionPrecision: z
              .enum(["authored", "transformed", "unknown"])
              .optional(),
            runtimeMultiplicity: z.number().int().positive().optional(),
            scope: z
              .enum([
                "single-instance",
                "repeated-render",
                "shared-component-definition",
                "unknown",
              ])
              .optional(),
            expectedVersionHash: z.string().optional(),
            propStamps: z
              .array(
                z.object({
                  name: z.string().min(1),
                  value: z.string(),
                }),
              )
              .optional(),
          })
          .optional(),
      })
      .optional()
      .describe(
        "Optional editor preimage used to reject a stale component promotion.",
      ),
  }),
  run: async (
    { designId, nodeId, selector, name, fileId, source },
    context,
  ) => {
    if (!nodeId && !selector) {
      throw new Error(
        "Provide either nodeId or selector for the element to promote.",
      );
    }

    const db = getDb();

    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);
    const caps = resolveSourceCapabilities(sourceType);
    const localSource = source?.local as LocalComponentSource | undefined;

    if (
      sourceType !== "inline" &&
      !(sourceType === "localhost" && localSource) &&
      !hasCapability(caps, "applyEdit")
    ) {
      return {
        designId,
        sourceType,
        persisted: false,
        ctaRequired: true,
        ctaMessage:
          "Creating a component from a real-app source requires the bridge " +
          "applyEdit capability, which lands with bridge write hardening.",
      };
    }

    await assertAccess("design", designId, "editor");

    if (sourceType !== "inline") {
      if (sourceType !== "localhost" || !localSource) {
        return {
          designId,
          sourceType,
          persisted: false,
          ctaRequired: true,
          ctaMessage:
            "Creating a component from this source requires an authored localhost JSX anchor.",
        };
      }

      if (!localSource.expectedVersionHash) {
        return {
          designId,
          sourceType,
          persisted: false,
          conflict: true,
          error:
            "Create Component requires the source version captured with the live selection. Refresh the selection and retry.",
        };
      }

      const live = await readLocalFileAction.run({
        designId,
        connectionId: localSource.connectionId,
        path: localSource.path,
      });
      if (
        localSource.expectedVersionHash &&
        live.versionHash !== localSource.expectedVersionHash
      ) {
        return {
          designId,
          sourceType,
          persisted: false,
          conflict: true,
          error:
            "The local component source changed while Create Component was being prepared. Refresh and retry.",
          source: {
            kind: "local-file" as const,
            connectionId: localSource.connectionId,
            path: localSource.path,
            versionHash: live.versionHash,
          },
        };
      }

      const componentName = normalizeComponentName(name);
      const values = Object.fromEntries([
        [COMPONENT_NAME_ATTR, componentName],
        ...(localSource.propStamps ?? []).map((stamp) => [
          stamp.name,
          stamp.value,
        ]),
      ]);
      const planned = planLocalJsxVisualEdit({
        content: live.content,
        anchor: localSource,
        intent: { kind: "attributes", values },
      });
      if (planned.result.status !== "applied") {
        return {
          designId,
          sourceType,
          persisted: false,
          ctaRequired: planned.result.status === "needsAgent",
          error: planned.result.message,
          result: planned.result,
        };
      }

      let write: Awaited<ReturnType<typeof writeLocalFileAction.run>> | null =
        null;
      if (planned.result.changed) {
        await snapshotDesignBeforeAgentEdit(designId, context);
        write = await writeLocalFileAction.run({
          designId,
          connectionId: localSource.connectionId,
          relPath: localSource.path,
          content: planned.content,
          expectedVersionHash: live.versionHash,
          requireExpectedVersionHash: true,
        });
      }
      return {
        designId,
        nodeId,
        componentName,
        sourceType,
        persisted: write ? write.written : !planned.result.changed,
        ctaRequired: false,
        source: {
          kind: "local-file" as const,
          connectionId: localSource.connectionId,
          path: localSource.path,
          versionHash: write?.versionHash ?? live.versionHash,
        },
        content: planned.content,
        result: planned.result,
      };
    }

    const conditions = [
      accessFilter(schema.designs, schema.designShares),
      eq(schema.designFiles.designId, designId),
      fileId
        ? eq(schema.designFiles.id, fileId)
        : eq(schema.designFiles.filename, "index.html"),
    ];

    const [file] = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        filename: schema.designFiles.filename,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(and(...conditions))
      .limit(1);

    if (!file) throw new Error("Design HTML file not found.");

    const workspaceFile: SourceWorkspaceFile = {
      id: file.id,
      designId: file.designId,
      filename: file.filename ?? "",
      fileType: "html",
      content: file.content,
      createdAt: null,
      updatedAt: null,
    };
    const live = await readLiveSourceFile(workspaceFile);
    const originalHtml = live.content;
    if (!createComponentSourceMatches(live, source)) {
      return {
        designId,
        sourceType,
        persisted: false,
        conflict: true,
        error:
          "The design source changed while Create Component was being prepared. Refresh and retry.",
        fileId: file.id,
        filename: file.filename,
      };
    }

    const codeLayerSource: CodeLayerSource = {
      kind: "design-file",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
    };

    const { projection, resolution } = resolveCodeLayerTarget(
      originalHtml,
      { nodeId, selector },
      { source: codeLayerSource },
    );

    if (resolution.status !== "resolved" || !resolution.node) {
      throw new Error(
        `${resolution.message ?? "Target did not resolve to a single code layer node."} ` +
          `Searched ${projection.nodes.length} projection nodes for ` +
          `${nodeId ? `nodeId "${nodeId}"` : `selector "${selector ?? ""}"`}. ` +
          `Run get-code-layer-projection to list current node ids and selectors.`,
      );
    }
    if (isLinkedComponentDescendant(resolution.node, projection)) {
      throw new Error(
        "Detach this linked component before promoting one of its descendants as a component main.",
      );
    }
    if (resolution.node.dataAttributes[COMPONENT_REF_ATTR] !== undefined) {
      throw new Error(
        "Detach this linked instance before promoting it as a component main.",
      );
    }

    const identityEdits: Array<{
      start: number;
      end: number;
      insertedLength: number;
    }> = [];
    const ensured = ensureCodeLayerNodeIdsInHtml(originalHtml, {
      source: codeLayerSource,
      onSourceEdit: (edit) => identityEdits.push(edit),
    });
    const originalOpenStart = resolution.node.source?.openStart;
    const mappedOpenStart =
      originalOpenStart === undefined
        ? null
        : mapCodeLayerSourceOffsetThroughEdits(
            originalOpenStart,
            identityEdits,
          );
    const preparedProjection = buildCodeLayerProjection(ensured.content, {
      source: codeLayerSource,
    });
    const targetMatches = preparedProjection.nodes.filter(
      (candidate) => candidate.source?.openStart === mappedOpenStart,
    );
    const node = targetMatches.length === 1 ? targetMatches[0] : undefined;
    if (!node) {
      throw new Error(
        "Target identity changed while preparing component source IDs. Refresh the selection and try again.",
      );
    }

    const componentName = normalizeComponentName(name);
    const propStamps = deriveComponentPropStamps(node);
    const componentId =
      node.dataAttributes[COMPONENT_ID_ATTR]?.trim() || `cmp-${randomUUID()}`;
    const { content: patchedContent, changed } = applyComponentAnnotations(
      ensured.content,
      node,
      componentName,
      propStamps,
      componentId,
    );
    const contentChanged = changed || ensured.changed;

    let persistedReceipt: {
      versionHash: string;
      changed: boolean;
      updatedAt: string;
    } | null = null;
    if (contentChanged) {
      await snapshotDesignBeforeAgentEdit(designId, context);
      persistedReceipt = await writeInlineSourceFile({
        designId: file.designId,
        file: workspaceFile,
        content: patchedContent,
        expectedVersionHash: live.versionHash,
      });

      if (!persistedReceipt.changed) {
        throw new Error(
          "Create Component did not receive a changed source from the persistence boundary.",
        );
      }

      agentUpdateSelection(file.id, {
        selection: agentSelectionDescriptor(
          { nodeId: node.id, selector: node.selector },
          "Creating component",
        ),
        nodeId: node.id,
        editingFile: file.filename,
        designId: file.designId,
      });
    }

    return {
      designId,
      nodeId: node.id,
      selector: node.selector,
      componentName,
      sourceType,
      props: propStamps.map((stamp) => ({
        name: stamp.name.slice(COMPONENT_PROP_PREFIX.length),
        value: stamp.value,
      })),
      persisted: contentChanged,
      ctaRequired: false,
      fileId: file.id,
      filename: file.filename,
      bytesBefore: originalHtml.length,
      bytesAfter: patchedContent.length,
      updatedAt: persistedReceipt?.updatedAt,
      changes:
        contentChanged && persistedReceipt
          ? [
              {
                fileId: file.id,
                before: originalHtml,
                after: patchedContent,
                beforeVersionHash: live.versionHash,
                afterVersionHash: persistedReceipt.versionHash,
                updatedAt: persistedReceipt.updatedAt,
              },
            ]
          : [],
      sourceBases:
        contentChanged && persistedReceipt
          ? [
              {
                fileId: file.id,
                versionHash: persistedReceipt.versionHash,
                updatedAt: persistedReceipt.updatedAt,
              },
            ]
          : undefined,
      note: contentChanged
        ? "Element promoted to a component instance and persisted via the deterministic HTML-patch path."
        : "No change applied — the element could not be annotated (missing source span).",
    };
  },
});
