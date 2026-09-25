import {
  nativeCreativeArtifactFromMetadata,
  type NativeCreativeArtifact,
} from "./native-artifact.js";
import type { ContextDetail } from "./types.js";

const MAX_REASSEMBLY_DEPTH = 16;
const MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;
const SAFE_MEDIA_ROUTE = "/_agent-native/creative-context/media?";
const ALLOWED_TAGS = new Set([
  "html",
  "head",
  "meta",
  "style",
  "body",
  "div",
  "p",
  "span",
  "img",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "br",
]);

export interface NativeArtifactEvidence {
  itemId: string;
  itemVersionId: string;
}

export interface ReassembledNativeArtifact {
  html: string;
  artifact: NativeCreativeArtifact;
  evidence: NativeArtifactEvidence[];
}

export async function reassembleNativeCreativeArtifact(input: {
  root: ContextDetail;
  app: NativeCreativeArtifact["app"];
  format: NativeCreativeArtifact["format"];
  resolveChild: (input: {
    sourceId: string;
    externalId: string;
    itemId?: string;
    itemVersionId?: string;
    sourceVersion?: string;
  }) => Promise<ContextDetail | null>;
}): Promise<ReassembledNativeArtifact> {
  const evidence = new Map<string, NativeArtifactEvidence>();
  const active = new Set<string>();
  const headResources = new Set<string>();

  const visit = async (
    detail: ContextDetail,
    depth: number,
  ): Promise<{ html: string; artifact: NativeCreativeArtifact }> => {
    if (depth > MAX_REASSEMBLY_DEPTH) {
      throw new Error("Native creative artifact hierarchy is too deep.");
    }
    const artifact = nativeCreativeArtifactFromMetadata(
      detail.version.metadata,
    );
    if (
      !artifact ||
      artifact.app !== input.app ||
      artifact.format !== input.format
    ) {
      throw new Error(
        `Creative context item ${detail.item.id} is not a ${input.format} native artifact.`,
      );
    }
    if (
      detail.item.mimeType !== "text/html" ||
      !isTrustedCompilerItem(detail)
    ) {
      throw new Error(
        `Creative context item ${detail.item.id} was not produced by a trusted native artifact compiler.`,
      );
    }
    validateCompiledNativeHtml(detail.version.content, artifact);
    const evidenceKey = `${detail.item.id}:${detail.version.id}`;
    evidence.set(evidenceKey, {
      itemId: detail.item.id,
      itemVersionId: detail.version.id,
    });
    if (active.has(evidenceKey)) {
      throw new Error("Native creative artifact hierarchy contains a cycle.");
    }
    if (!artifact.manifest) {
      collectHeadResources(detail.version.content, headResources);
      return { html: detail.version.content, artifact };
    }

    active.add(evidenceKey);
    let html = detail.version.content;
    for (const child of [...artifact.manifest.children].sort(
      (left, right) => left.zOrder - right.zOrder,
    )) {
      const pinnedEdge = detail.edges.find(
        (edge) =>
          edge.relation === "contains-native-child" &&
          edge.toExternalId === child.externalId,
      );
      if (
        (pinnedEdge?.toItemId && !pinnedEdge.toItemVersionId) ||
        (!pinnedEdge?.toItemId && pinnedEdge?.toItemVersionId)
      ) {
        throw new Error(
          `Native creative artifact child ${child.externalId} has an incomplete pinned version reference.`,
        );
      }
      if (
        !pinnedEdge?.toItemId &&
        !pinnedEdge?.toItemVersionId &&
        !detail.version.sourceVersion
      ) {
        throw new Error(
          `Native creative artifact child ${child.externalId} has no immutable version reference.`,
        );
      }
      const childDetail = await input.resolveChild({
        sourceId: detail.item.sourceId,
        externalId: child.externalId,
        ...(pinnedEdge?.toItemId && pinnedEdge.toItemVersionId
          ? {
              itemId: pinnedEdge.toItemId,
              itemVersionId: pinnedEdge.toItemVersionId,
            }
          : { sourceVersion: detail.version.sourceVersion! }),
      });
      if (!childDetail) {
        throw new Error(
          `Native creative artifact child ${child.externalId} is unavailable at the pinned source version.`,
        );
      }
      const compiledChild = await visit(childDetail, depth + 1);
      collectHeadResources(compiledChild.html, headResources);
      html = fillGeneratedChildPlaceholder(
        html,
        child,
        extractBody(compiledChild.html, compiledChild.artifact.format),
        compiledChild.artifact.format,
      );
      assertReassembledSize(html);
    }
    active.delete(evidenceKey);
    return { html, artifact };
  };

  const result = await visit(input.root, 0);
  collectHeadResources(result.html, headResources);
  const html = insertHeadResources(result.html, headResources);
  assertReassembledSize(html);
  validateCompiledNativeHtml(html, {
    ...result.artifact,
    childExternalIds: undefined,
    manifest: undefined,
    assetRefs: collectNativeAssetUrls(html),
  });
  return { html, artifact: result.artifact, evidence: [...evidence.values()] };
}

export function validateCompiledNativeHtml(
  html: string,
  artifact: NativeCreativeArtifact,
): void {
  if (
    artifact.format === "design-html" &&
    (!/^\s*<!doctype html>/i.test(html) || !/<html(?:\s|>)/i.test(html))
  ) {
    throw new Error(
      "Native creative artifact must be a complete HTML document.",
    );
  }
  if (
    /<\s*(?:script|iframe|object|embed|base|form|input|button|textarea|select|video|audio|source)\b/i.test(
      html,
    ) ||
    /\s(?:on[a-z]+|srcdoc|http-equiv)\s*=/i.test(html) ||
    /(?:expression\s*\(|-moz-binding\s*:|behavior\s*:|@import\b)/i.test(html)
  ) {
    throw new Error("Native creative artifact contains executable HTML/CSS.");
  }
  if (
    /\s(?:x-|hx-|ng-|v-)[a-z0-9_:.@-]*\s*=/i.test(html) ||
    /\s[@:][^\s=/>]+\s*=/.test(html)
  ) {
    throw new Error(
      "Native creative artifact contains executable framework attributes.",
    );
  }
  if (
    /\s(?:srcset|lowsrc|background|poster|cite|ping|longdesc|usemap|formaction|action|manifest|xlink:href)\s*=/i.test(
      html,
    ) ||
    /(?:-webkit-)?image-set\s*\(/i.test(html)
  ) {
    throw new Error(
      "Native creative artifact contains an unsupported URL-bearing construct.",
    );
  }
  for (const match of html.matchAll(/<\/?\s*([a-z][a-z0-9-]*)\b/gi)) {
    const tag = match[1]?.toLowerCase();
    if (tag && !ALLOWED_TAGS.has(tag)) {
      throw new Error(
        `Native creative artifact contains unsupported <${tag}> markup.`,
      );
    }
  }
  const urlAttributes = [
    ...html.matchAll(/\s(?:src|href)\s*=\s*(["'])(.*?)\1/gi),
  ];
  const attributeCount = (html.match(/\s(?:src|href)\s*=/gi) ?? []).length;
  if (urlAttributes.length !== attributeCount) {
    throw new Error(
      "Native creative artifact contains an invalid URL attribute.",
    );
  }
  for (const match of urlAttributes) assertSafeMediaUrl(match[2] ?? "");
  for (const match of html.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    assertSafeMediaUrl(match[2] ?? "");
  }
  for (const match of html.matchAll(
    /<style(?:\s[^>]*)?>([\s\S]*?)<\/style>|\sstyle\s*=\s*(["'])(.*?)\2/gi,
  )) {
    const css = match[1] ?? match[3] ?? "";
    if (/(?:https?:|data:|javascript:|(?:^|[\s("'])\/\/)/i.test(css)) {
      throw new Error(
        "Native creative artifact CSS contains an external or executable URL.",
      );
    }
  }

  const usedAssetRefs = collectNativeAssetUrls(html);
  const declaredAssetRefs = [...new Set(artifact.assetRefs ?? [])].map(
    canonicalMediaUrl,
  );
  for (const assetRef of declaredAssetRefs) assertSafeMediaUrl(assetRef);
  if (
    usedAssetRefs.length !== declaredAssetRefs.length ||
    usedAssetRefs.some((value) => !declaredAssetRefs.includes(value))
  ) {
    throw new Error(
      "Native creative artifact code does not match its declared asset references.",
    );
  }

  const placeholders = [
    ...html.matchAll(/data-creative-context-child\s*=\s*"([^"]+)"/g),
  ].map((match) => match[1]!);
  const expected = (artifact.manifest?.children ?? []).map((child) =>
    escapeAttribute(child.externalId),
  );
  const declaredChildren = artifact.childExternalIds ?? [];
  const manifestChildren = (artifact.manifest?.children ?? []).map(
    (child) => child.externalId,
  );
  if (
    placeholders.length !== expected.length ||
    placeholders.some((value, index) => value !== expected[index]) ||
    new Set(placeholders).size !== placeholders.length
  ) {
    throw new Error(
      "Native creative artifact code does not match its child manifest.",
    );
  }
  if (
    declaredChildren.length !== manifestChildren.length ||
    declaredChildren.some((value, index) => value !== manifestChildren[index])
  ) {
    throw new Error(
      "Native creative artifact child ids do not match its child manifest.",
    );
  }
}

function assertSafeMediaUrl(value: string): void {
  const canonical = canonicalMediaUrl(value);
  if (!canonical.startsWith(SAFE_MEDIA_ROUTE)) {
    throw new Error(
      "Native creative artifact assets must use the private relative media route.",
    );
  }
  const url = new URL(canonical, "https://creative-context.invalid");
  if (
    url.origin !== "https://creative-context.invalid" ||
    url.pathname !== "/_agent-native/creative-context/media" ||
    [...url.searchParams.keys()].length !== 1 ||
    !/^ccm_[a-f0-9]{28}$/.test(url.searchParams.get("mediaId") ?? "")
  ) {
    throw new Error("Native creative artifact contains an invalid media URL.");
  }
}

function isTrustedCompilerItem(detail: ContextDetail): boolean {
  const compiler = detail.item.provenance.compiler;
  return (
    typeof compiler === "string" &&
    (compiler === "@agent-native/core/ingestion:figma-node-to-html" ||
      compiler === "@agent-native/creative-context:google-slides-native")
  );
}

function fillGeneratedChildPlaceholder(
  html: string,
  child: NonNullable<NativeCreativeArtifact["manifest"]>["children"][number],
  childBody: string,
  format: NativeCreativeArtifact["format"],
): string {
  const externalId = child.externalId;
  const marker = `data-creative-context-child="${escapeAttribute(externalId)}"`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(
      `Native creative artifact is missing child placeholder ${externalId}.`,
    );
  }
  const openStart = html.lastIndexOf("<div", markerIndex);
  const openEnd = html.indexOf(">", markerIndex);
  const closeStart = html.indexOf("</div>", openEnd + 1);
  if (
    openStart < 0 ||
    openEnd < 0 ||
    closeStart < 0 ||
    html.slice(openEnd + 1, closeStart).trim()
  ) {
    throw new Error(
      `Native creative artifact child placeholder ${externalId} is malformed.`,
    );
  }
  const opening =
    format === "slides-html"
      ? "<div>"
      : `<div style="position:absolute;left:${child.bounds.x}px;top:${child.bounds.y}px;width:${child.bounds.width}px;height:${child.bounds.height}px;z-index:${child.zOrder}">`;
  return `${html.slice(0, openStart)}${opening}\n${childBody}\n${html.slice(closeStart)}`;
}

function collectNativeAssetUrls(html: string): string[] {
  const values = [
    ...[...html.matchAll(/\s(?:src|href)\s*=\s*(["'])(.*?)\1/gi)].map(
      (match) => match[2] ?? "",
    ),
    ...[...html.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)].map(
      (match) => match[2] ?? "",
    ),
  ]
    .filter(Boolean)
    .map(canonicalMediaUrl);
  return [...new Set(values)].sort();
}

function canonicalMediaUrl(value: string): string {
  return value.replace(/&amp;/g, "&");
}

function extractBody(
  html: string,
  format: NativeCreativeArtifact["format"],
): string {
  const match = html.match(/<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/i);
  if (!match) {
    if (format === "slides-html") return html;
    throw new Error("Native creative artifact has no HTML body.");
  }
  return match[1] ?? "";
}

function collectHeadResources(html: string, resources: Set<string>): void {
  const match = html.match(/<head(?:\s[^>]*)?>([\s\S]*?)<\/head>/i);
  if (!match?.[1]) return;
  for (const entry of match[1].matchAll(
    /<style(?:\s[^>]*)?>[\s\S]*?<\/style>|<link\s[^>]*rel=["']stylesheet["'][^>]*\/?>/gi,
  )) {
    if (entry[0]) resources.add(entry[0]);
  }
}

function insertHeadResources(html: string, resources: Set<string>): string {
  const closingHead = html.search(/<\/head>/i);
  if (closingHead < 0) {
    if (!resources.size) return html;
    throw new Error("Native creative artifact has no HTML head.");
  }
  const missing = [...resources].filter((resource) => !html.includes(resource));
  return missing.length
    ? `${html.slice(0, closingHead)}${missing.join("\n")}\n${html.slice(closingHead)}`
    : html;
}

function assertReassembledSize(html: string): void {
  if (Buffer.byteLength(html, "utf8") > MAX_REASSEMBLED_BYTES) {
    throw new Error("Reassembled native creative artifact exceeds 64 MiB.");
  }
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
