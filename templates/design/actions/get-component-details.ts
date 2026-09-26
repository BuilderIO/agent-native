
import { defineAction } from "@agent-native/core/action";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";
import {
  fetchLocalhostSnapshot,
  resolveLocalhostBridgeConnection,
  resolveLocalhostConnectionScope,
} from "../server/lib/localhost-connection.js";
import { resolveSourceCapabilities } from "../shared/capability-resolver.js";
import { sanitizeMarkup } from "../shared/capture-sanitize.js";
import { buildCodeLayerProjection } from "../shared/code-layer.js";
import type { CodeLayerNode, CodeLayerSource } from "../shared/code-layer.js";
import {
  COMPONENT_ARCHIVE_ATTR,
  readComponentArchivePointer,
} from "../shared/component-archive.js";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_REF_ATTR,
  componentNameFor,
  componentNodeIdMatches,
  extractProps,
  type ComponentInstance,
  instanceFromNode,
} from "../shared/component-model.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import { isStandaloneHttpUrl } from "../shared/html-content.js";
import {
  designConnectionIdFromData,
  designSourceTypeFromData,
} from "../shared/source-mode.js";

export function canRestoreComponentMain(
  node: Pick<CodeLayerNode, "dataAttributes">,
): boolean {
  const componentRef = node.dataAttributes[COMPONENT_REF_ATTR]?.trim();
  if (!componentRef) return false;
  const archive = readComponentArchivePointer(
    node.dataAttributes[COMPONENT_ARCHIVE_ATTR],
  );
  return (
    archive.status === "valid" && archive.pointer.componentId === componentRef
  );
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function metadataForFile(
  data: Record<string, unknown>,
  fileId: string,
): Record<string, unknown> {
  for (const key of ["screenMetadata", "localhostScreens"]) {
    const metadata = data[key];
    const entry = isRecord(metadata) ? metadata[fileId] : undefined;
    if (isRecord(entry)) return entry;
  }
  return {};
}

function stringValue(
  attributes: Record<string, string>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = attributes[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function positiveIntegerValue(
  attributes: Record<string, string>,
  names: readonly string[],
): number | undefined {
  const raw = stringValue(attributes, names);
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function liveComponentNameFor(
  node: CodeLayerNode,
  sourceType: ReturnType<typeof designSourceTypeFromData>,
): string | null {
  return (
    componentNameFor(node) ??
    (sourceType !== "inline"
      ? (stringValue(node.dataAttributes, ["data-component-name"]) ?? null)
      : null)
  );
}

function liveInstanceForNode(
  node: CodeLayerNode,
  name: string,
): NonNullable<ReturnType<typeof instanceFromNode>> {
  const existing = instanceFromNode(node);
  if (existing) return existing;
  const stableNodeId =
    stringValue(node.dataAttributes, ["data-agent-native-node-id"]) ?? node.id;
  const alpineDataRaw = node.attributes["x-data"];
  return {
    instanceId: stableNodeId,
    name,
    props: extractProps(node),
    alpineData: typeof alpineDataRaw === "string" ? alpineDataRaw : undefined,
    selector: node.selector,
    nodeId: stableNodeId,
    componentId:
      stringValue(node.dataAttributes, [COMPONENT_ID_ATTR]) ?? undefined,
    componentRef:
      stringValue(node.dataAttributes, [COMPONENT_REF_ATTR]) ?? undefined,
  };
}

function sourceLocationForNode(
  node: CodeLayerNode,
  indexRow:
    | {
        filePath?: string | null;
        exportName?: string | null;
      }
    | undefined,
  canResolveToFile: boolean,
  componentName: string,
) {
  if (!canResolveToFile) return undefined;
  const filePath =
    stringValue(node.dataAttributes, [
      "data-source-file",
      "data-agent-native-source-file",
      "data-agent-native-source-path",
    ]) ?? indexRow?.filePath;
  if (!filePath) return undefined;
  const line = positiveIntegerValue(node.dataAttributes, [
    "data-source-line",
    "data-agent-native-source-line",
  ]);
  const column = positiveIntegerValue(node.dataAttributes, [
    "data-source-column",
    "data-agent-native-source-column",
  ]);
  return {
    filePath,
    exportName: indexRow?.exportName ?? undefined,
    ...(line ? { line } : {}),
    ...(column ? { column } : {}),
    componentName:
      stringValue(node.dataAttributes, ["data-component-name"]) ??
      componentName,
  };
}

export class ComponentDetailsLiveProjectionError extends Error {
  readonly statusCode = 424;
  readonly code = "LIVE_PROJECTION_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "ComponentDetailsLiveProjectionError";
  }
}


export default defineAction({
  description:
    "Return details for a selected component instance: component name, " +
    "source file (when resolveNodeToFile capability is available), props, " +
    "variants, and the persisted component_index row. " +
    "Provide the design id and node id (data-agent-native-node-id) of the " +
    "selected component root. For Alpine designs the response includes " +
    "lightweight attribute-based props and a CTA flag for full prop controls.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    nodeId: z
      .string()
      .describe(
        "The data-agent-native-node-id of the selected component instance root element.",
      ),
    fileId: z
      .string()
      .optional()
      .describe("Design file id. Defaults to index.html."),
    runtime: z
      .object({
        name: z.string().min(1),
        nodeId: z.string().min(1),
        selector: z.string().min(1),
        props: z.array(
          z.object({ name: z.string().min(1), value: z.string() }),
        ),
        literalProps: z
          .array(z.object({ name: z.string().min(1), value: z.string() }))
          .optional(),
        alpineData: z.string().nullable().optional(),
        componentId: z.string().optional(),
        componentRef: z.string().optional(),
        isMain: z.boolean().optional(),
        sourceLocation: z
          .object({
            filePath: z.string().min(1),
            exportName: z.string().optional(),
          })
          .optional(),
      })
      .optional()
      .describe(
        "Runtime component metadata from a URL-backed preview. This keeps the inspector on the live DOM projection when the SQL file stores only a route URL.",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, nodeId, fileId, runtime }) => {
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);
    if (sourceType !== "inline") {
      await assertAccess("design", designId, "editor");
    }

    const db = getDb();
    const caps = resolveSourceCapabilities(sourceType);
    const canResolveToFile = hasCapability(caps, "resolveNodeToFile");
    const hasFullIndex = hasCapability(caps, "indexComponents");
    const canEditProps =
      sourceType === "inline" || hasCapability(caps, "applyEdit");
    const ctaRequired = !hasFullIndex || !canEditProps;
    const ctaMessage = !hasFullIndex
      ? "Full prop controls (TypeScript prop types, cva variants, Storybook stories) require a connected Builder app. Connect Builder (free tier available) to unlock."
      : !canEditProps
        ? "Prop write-back requires the bridge applyEdit capability. Preview controls remain available until source write hardening is enabled."
        : undefined;

    if (runtime) {
      const [indexRow] = await db
        .select()
        .from(schema.componentIndex)
        .where(
          and(
            eq(schema.componentIndex.designId, designId),
            eq(schema.componentIndex.name, runtime.name),
          ),
        )
        .limit(1);
      const persistedProps = parseJson<unknown[]>(indexRow?.props, []);
      const persistedVariants = parseJson<Record<string, string[]>>(
        indexRow?.variants,
        {},
      );
      const persistedStories = parseJson<unknown[]>(indexRow?.stories, []);
      const instance: ComponentInstance = {
        instanceId: runtime.nodeId,
        name: runtime.name,
        props: runtime.props,
        alpineData: runtime.alpineData ?? undefined,
        selector: runtime.selector,
        nodeId: runtime.nodeId,
        componentId: runtime.componentId,
        componentRef: runtime.componentRef,
      };
      return {
        designId,
        nodeId,
        sourceType,
        instance,
        name: runtime.name,
        isMain:
          runtime.isMain ??
          Boolean(runtime.componentId && !runtime.componentRef),
        canRestore: false,
        observedProps: runtime.props,
        literalProps: runtime.literalProps,
        persistedProps,
        persistedVariants,
        persistedStories,
        sourceLocation: runtime.sourceLocation,
        capabilities: {
          canResolveToFile,
          hasFullIndex,
          canEditProps,
          ctaRequired,
          ctaMessage,
        },
      };
    }

    const conditions = [
      accessFilter(schema.designs, schema.designShares, undefined, "viewer", {
        includePublic: true,
      }),
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
        data: schema.designs.data,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(and(...conditions))
      .limit(1);

    if (!file) throw new Error("Design HTML file not found.");

    let html = file.content ?? "";
    if (isStandaloneHttpUrl(html)) {
      if (sourceType !== "localhost") {
        throw new ComponentDetailsLiveProjectionError(
          `Component details for URL-backed screen "${file.filename}" require a localhost bridge snapshot; source type "${sourceType}" has no live component mapping.`,
        );
      }
      const designData = parseJson<Record<string, unknown>>(file.data, {});
      const metadata = metadataForFile(designData, file.id);
      const connectionId =
        (typeof metadata.connectionId === "string" &&
          metadata.connectionId.trim()) ||
        designConnectionIdFromData(designData);
      if (!connectionId) {
        throw new ComponentDetailsLiveProjectionError(
          `URL-backed screen "${file.filename}" has no localhost connection metadata. Reopen visual edit or reconnect the localhost app before requesting component details.`,
        );
      }
      const { ownerEmail, orgId } = await resolveLocalhostConnectionScope({
        designId,
      });
      const connection = await resolveLocalhostBridgeConnection({
        connectionId,
        ownerEmail,
        orgId,
      });
      const previewToken =
        typeof metadata.previewToken === "string"
          ? metadata.previewToken
          : null;
      html = sanitizeMarkup(
        await fetchLocalhostSnapshot({
          bridgeUrl: connection.bridgeUrl,
          previewToken,
          url: html,
        }),
      ).trim();
      if (!html) {
        throw new ComponentDetailsLiveProjectionError(
          `The localhost bridge returned an empty snapshot for "${file.filename}". Reload the live frame and retry.`,
        );
      }
    }

    const codeLayerSource: CodeLayerSource = {
      kind: "design-file",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
    };

    const projection = buildCodeLayerProjection(html, {
      source: codeLayerSource,
    });

    const node = projection.nodes.find((n) =>
      componentNodeIdMatches(n, nodeId),
    );
    if (!node) {
      throw new Error(
        `Node "${nodeId}" not found in projection. Run get-code-layer-projection to list current node ids.`,
      );
    }

    const name = liveComponentNameFor(node, sourceType);
    if (!name) {
      throw new Error(
        `Node "${nodeId}" does not carry component provenance and is not a component root.`,
      );
    }

    const observedProps = extractProps(node);
    const instance = liveInstanceForNode(node, name);

    const [indexRow] = await db
      .select()
      .from(schema.componentIndex)
      .where(
        and(
          eq(schema.componentIndex.designId, designId),
          eq(schema.componentIndex.name, name),
        ),
      )
      .limit(1);

    const persistedProps = parseJson<unknown[]>(indexRow?.props, []);
    const persistedVariants = parseJson<Record<string, string[]>>(
      indexRow?.variants,
      {},
    );
    const persistedStories = parseJson<unknown[]>(indexRow?.stories, []);

    const sourceLocation = sourceLocationForNode(
      node,
      indexRow,
      canResolveToFile,
      name,
    );

    return {
      designId,
      nodeId,
      sourceType,
      instance,
      name,
      isMain: Boolean(
        node.dataAttributes[COMPONENT_ID_ATTR] &&
        !node.dataAttributes[COMPONENT_REF_ATTR],
      ),
      canRestore: canRestoreComponentMain(node),
      observedProps,
      persistedProps,
      persistedVariants,
      persistedStories,
      sourceLocation,
      capabilities: {
        canResolveToFile,
        hasFullIndex,
        canEditProps,
        ctaRequired,
        ctaMessage,
      },
    };
  },
});
