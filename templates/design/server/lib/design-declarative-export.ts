import { randomBytes } from "node:crypto";

import { parse } from "parse5";

import {
  NATIVE_EMBEDDED_ASSETS_ATTR,
  NATIVE_EMBEDDED_ASSETS_SCRIPT_TYPE,
  NativeEmbeddedAssetRegistryError,
  parseNativeEmbeddedAssetRegistryText,
} from "../../shared/native-embedded-assets.js";
import {
  NATIVE_SHADER_RUNTIME_SOURCE,
  parseShaderBlockBody,
  SHADER_EFFECT_ATTR,
  SHADER_FILL_ATTR,
  SHADER_RUNTIME_ATTR,
  SHADER_RUNTIME_SOURCE,
  SHADER_SCRIPT_TYPE,
  serializeShaderScriptBlock,
  type GlslShaderDef,
  validateShaderDef,
} from "../../shared/shader-fills.js";
import {
  buildStandaloneHtml,
  type DesignExportFile,
  type ExportFontLicense,
} from "./design-export.js";
import {
  compileStaticTailwind,
  StaticTailwindExportError,
} from "./design-tailwind-export.js";

type HtmlNode = {
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
  content?: HtmlNode;
  value?: string;
  sourceCodeLocation?: {
    startOffset: number;
    endOffset: number;
    startTag?: { endOffset: number };
  };
};

export type AuthoredScene = {
  content: string;
  tailwindClasses: string[];
  tailwindCss: string;
  hasTailwind: boolean;
};

export class DeclarativeExportError extends Error {
  constructor(
    readonly code:
      | "source-unsupported"
      | "script-unsupported"
      | "resource-unsupported"
      | "package-too-large",
    message: string,
  ) {
    super(message);
    this.name = "DeclarativeExportError";
  }
}

function walk(node: HtmlNode, visit: (node: HtmlNode) => void): void {
  visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
  if (node.content) walk(node.content, visit);
}

function attr(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((entry) => entry.name === name)?.value;
}

function validateBundledNativeAssets(node: HtmlNode): void {
  const names = (node.attrs ?? []).map((entry) => entry.name).sort();
  if (
    names.join(",") !== `${NATIVE_EMBEDDED_ASSETS_ATTR},type` ||
    attr(node, "type") !== NATIVE_EMBEDDED_ASSETS_SCRIPT_TYPE ||
    attr(node, NATIVE_EMBEDDED_ASSETS_ATTR) === undefined
  )
    throw new DeclarativeExportError(
      "resource-unsupported",
      "Native input asset registry has unexpected attributes.",
    );
  const body = (node.childNodes ?? [])
    .map((child) => child.value ?? "")
    .join("");
  try {
    parseNativeEmbeddedAssetRegistryText(body);
  } catch (error) {
    if (error instanceof NativeEmbeddedAssetRegistryError)
      throw new DeclarativeExportError("resource-unsupported", error.message);
    throw error;
  }
}

export function prepareDeclarativeNativeSource(source: string): AuthoredScene {
  const document = parse(source, { sourceCodeLocationInfo: true }) as HtmlNode;
  let fullHtml = false;
  let explicitHead = false;
  let runtimeScripts = 0;
  let legacyRuntimeScripts = 0;
  let legacyMounts = 0;
  let tailwindScripts = 0;
  let tailwindStyles = 0;
  let nativeAssetRegistries = 0;
  const tailwindClasses: string[] = [];
  const tailwindCss: string[] = [];
  const removals: Array<{ start: number; end: number }> = [];
  walk(document, (node) => {
    if (node.tagName === "html") fullHtml = !!node.sourceCodeLocation;
    if (node.tagName === "head")
      explicitHead = !!node.sourceCodeLocation?.startTag;
    if (!node.tagName) return;
    if (
      attr(node, SHADER_FILL_ATTR) !== undefined ||
      attr(node, SHADER_EFFECT_ATTR) !== undefined
    )
      legacyMounts++;
    for (const attribute of node.attrs ?? []) {
      if (/^(?:x-|:|@)/i.test(attribute.name))
        throw new DeclarativeExportError(
          "script-unsupported",
          "Dynamic authored attributes cannot be synchronized for native export.",
        );
      if (attribute.name === "class")
        tailwindClasses.push(
          ...attribute.value.trim().split(/\s+/).filter(Boolean),
        );
    }
    if (node.attrs?.some((entry) => /^on/i.test(entry.name)))
      throw new DeclarativeExportError(
        "script-unsupported",
        "Authored event handlers cannot be synchronized for native export.",
      );
    if (
      [
        "canvas",
        "iframe",
        "object",
        "embed",
        "audio",
        "video",
        "base",
        "link",
      ].includes(node.tagName)
    )
      throw new DeclarativeExportError(
        "resource-unsupported",
        `Authored ${node.tagName} is unsupported in deterministic native export.`,
      );
    if (node.tagName === "meta" && attr(node, "http-equiv"))
      throw new DeclarativeExportError(
        "source-unsupported",
        "Authored HTTP-equivalent metadata is unsupported in native export.",
      );
    if (node.tagName === "script") {
      const src = attr(node, "src");
      if (
        attr(node, "type") === NATIVE_EMBEDDED_ASSETS_SCRIPT_TYPE ||
        attr(node, NATIVE_EMBEDDED_ASSETS_ATTR) !== undefined
      ) {
        validateBundledNativeAssets(node);
        nativeAssetRegistries += 1;
        if (nativeAssetRegistries > 1)
          throw new DeclarativeExportError(
            "resource-unsupported",
            "Native input asset registry is duplicated.",
          );
        return;
      }
      if (attr(node, "type") === SHADER_SCRIPT_TYPE) {
        const names = (node.attrs ?? []).map((entry) => entry.name).sort();
        const id = attr(node, "data-shader-id");
        const name = attr(node, "data-shader-name");
        const mode = attr(node, "data-shader-mode");
        const canonicalMode =
          mode === "fill" || mode === "effect" ? mode : null;
        const body = (node.childNodes ?? [])
          .map((child) => child.value ?? "")
          .join("");
        const parsed = parseShaderBlockBody(body);
        const span = node.sourceCodeLocation;
        if (
          names.join(",") !==
            "data-shader-id,data-shader-mode,data-shader-name,type" ||
          !id ||
          !name ||
          !canonicalMode ||
          !span
        )
          throw new DeclarativeExportError(
            "script-unsupported",
            "Legacy GLSL shader definition is not a valid inert Design script.",
          );
        const definition: GlslShaderDef = {
          id,
          name,
          mode: canonicalMode,
          ...parsed,
        };
        if (
          !validateShaderDef(definition).valid ||
          source.slice(span.startOffset, span.endOffset) !==
            serializeShaderScriptBlock(definition)
        )
          throw new DeclarativeExportError(
            "script-unsupported",
            "Legacy GLSL shader definition is not canonical inert Design metadata.",
          );
        removals.push({
          start: span.startOffset,
          end: span.endOffset,
        });
        return;
      }
      if (attr(node, SHADER_RUNTIME_ATTR) !== undefined) {
        const names = (node.attrs ?? []).map((entry) => entry.name).sort();
        const body = (node.childNodes ?? [])
          .map((child) => child.value ?? "")
          .join("");
        if (
          names.join(",") !==
            "data-agent-native-shader-runtime,data-runtime-version" ||
          attr(node, "data-runtime-version") !== "1" ||
          body.trim() !== SHADER_RUNTIME_SOURCE.trim() ||
          !node.sourceCodeLocation
        )
          throw new DeclarativeExportError(
            "script-unsupported",
            "Legacy GLSL runtime does not match the bundled Design runtime.",
          );
        legacyRuntimeScripts++;
        removals.push({
          start: node.sourceCodeLocation.startOffset,
          end: node.sourceCodeLocation.endOffset,
        });
        return;
      }
      if (
        src &&
        /^https:\/\/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@4(?:\.\d+\.\d+)?$/i.test(
          src,
        )
      ) {
        if (
          (node.attrs ?? []).some(
            (entry) => entry.name !== "src" && entry.name !== "defer",
          ) ||
          !node.sourceCodeLocation ||
          (node.childNodes ?? []).some((child) => child.value?.trim())
        )
          throw new DeclarativeExportError(
            "script-unsupported",
            "Authored Tailwind runtime tag has unsupported attributes or content.",
          );
        tailwindScripts++;
        removals.push({
          start: node.sourceCodeLocation.startOffset,
          end: node.sourceCodeLocation.endOffset,
        });
        return;
      }
      if (attr(node, "type") === "application/x-agent-native-effects") {
        if ((node.attrs ?? []).some((entry) => entry.name !== "type"))
          throw new DeclarativeExportError(
            "script-unsupported",
            "Authored native manifest has unexpected attributes.",
          );
        return;
      }
      if (attr(node, "data-agent-native-native-shader-runtime") !== undefined) {
        const names = (node.attrs ?? []).map((entry) => entry.name).sort();
        if (
          names.join(",") !==
            "data-agent-native-native-shader-runtime,data-runtime-version" ||
          attr(node, "data-runtime-version") !== "2"
        )
          throw new DeclarativeExportError(
            "script-unsupported",
            "Authored native runtime tag has unexpected executable attributes.",
          );
        runtimeScripts++;
        return;
      }
      throw new DeclarativeExportError(
        "script-unsupported",
        "Authored scripts cannot be synchronized for native export.",
      );
    }
    if (node.tagName === "style") {
      const styleText = (node.childNodes ?? [])
        .map((child) => child.value ?? "")
        .join("");
      if (attr(node, "type") === "text/tailwindcss") {
        if (
          (node.attrs ?? []).some((entry) => entry.name !== "type") ||
          !node.sourceCodeLocation
        )
          throw new DeclarativeExportError(
            "source-unsupported",
            "Authored Tailwind style tag has unsupported attributes.",
          );
        tailwindStyles++;
        tailwindCss.push(styleText);
        removals.push({
          start: node.sourceCodeLocation.startOffset,
          end: node.sourceCodeLocation.endOffset,
        });
        return;
      }
      if (/@import\b/i.test(styleText))
        throw new DeclarativeExportError(
          "resource-unsupported",
          "CSS imports are unsupported in deterministic native export.",
        );
    }
  });
  if (!fullHtml || !explicitHead)
    throw new DeclarativeExportError(
      "source-unsupported",
      "Native export requires an authored full HTML document with a head.",
    );
  if (runtimeScripts > 1)
    throw new DeclarativeExportError(
      "script-unsupported",
      "Native export found multiple authored runtime scripts.",
    );
  if (legacyRuntimeScripts > 1)
    throw new DeclarativeExportError(
      "script-unsupported",
      "Native export found multiple legacy GLSL runtimes.",
    );
  if (legacyMounts > 0)
    throw new DeclarativeExportError(
      "script-unsupported",
      "Active legacy GLSL fills or effects cannot be synchronized for native export.",
    );
  if (tailwindScripts > 1)
    throw new DeclarativeExportError(
      "script-unsupported",
      "Native export found multiple authored Tailwind browser runtimes.",
    );
  if (source.includes("data-agent-native-measured-flow-group"))
    throw new DeclarativeExportError(
      "script-unsupported",
      "Measured flow groups require an independent runtime script.",
    );
  let content = source;
  for (const removal of removals.sort((a, b) => b.start - a.start))
    content = content.slice(0, removal.start) + content.slice(removal.end);
  return {
    content,
    tailwindClasses,
    tailwindCss: tailwindCss.join("\n"),
    hasTailwind: tailwindScripts > 0 || tailwindStyles > 0,
  };
}

function findTrustedScriptAndHead(html: string): {
  headEnd: number;
  runtimeStartTagEnd: number;
} {
  const document = parse(html, { sourceCodeLocationInfo: true }) as HtmlNode;
  let headEnd: number | undefined;
  let runtimeStartTagEnd: number | undefined;
  let runtimeCount = 0;
  let approvalsCount = 0;
  let assetRegistries = 0;
  walk(document, (node) => {
    if (node.tagName === "head")
      headEnd = node.sourceCodeLocation?.startTag?.endOffset;
    if (node.tagName !== "script") return;
    if (
      attr(node, "type") === NATIVE_EMBEDDED_ASSETS_SCRIPT_TYPE ||
      attr(node, NATIVE_EMBEDDED_ASSETS_ATTR) !== undefined
    ) {
      validateBundledNativeAssets(node);
      assetRegistries += 1;
      return;
    }
    if (attr(node, "type") === "application/x-agent-native-effects") {
      if ((node.attrs ?? []).some((entry) => entry.name !== "type"))
        throw new DeclarativeExportError(
          "script-unsupported",
          "Native export manifest has unexpected attributes.",
        );
      return;
    }
    if (
      attr(node, "type") === "application/x-agent-native-effect-approvals" &&
      attr(node, "data-agent-native-export-approvals") !== undefined
    ) {
      approvalsCount++;
      return;
    }
    if (
      attr(node, "type") === "text/plain" &&
      attr(node, "data-agent-native-export-font-licenses") !== undefined
    )
      return;
    if (attr(node, "data-agent-native-native-shader-runtime") !== undefined) {
      runtimeCount++;
      const names = (node.attrs ?? []).map((entry) => entry.name).sort();
      if (
        names.join(",") !==
          "data-agent-native-native-shader-runtime,data-runtime-version" ||
        attr(node, "data-runtime-version") !== "2"
      )
        throw new DeclarativeExportError(
          "script-unsupported",
          "Native export runtime tag has unexpected executable attributes.",
        );
      const body = (node.childNodes ?? [])
        .map((child) => child.value ?? "")
        .join("");
      if (body.trim() !== NATIVE_SHADER_RUNTIME_SOURCE.trim())
        throw new DeclarativeExportError(
          "script-unsupported",
          "Native export runtime source did not match the bundled runtime.",
        );
      runtimeStartTagEnd = node.sourceCodeLocation?.startTag?.endOffset;
      return;
    }
    throw new DeclarativeExportError(
      "script-unsupported",
      "Native export package contains an independent script.",
    );
  });
  if (
    !headEnd ||
    !runtimeStartTagEnd ||
    runtimeCount !== 1 ||
    approvalsCount !== 1 ||
    assetRegistries > 1
  )
    throw new DeclarativeExportError(
      "source-unsupported",
      "Native export package is missing its trusted runtime or approval metadata.",
    );
  return { headEnd, runtimeStartTagEnd };
}

export async function buildDeclarativeNativeExport(args: {
  title: string;
  files: DesignExportFile[];
  approvedDefinitionHashes: readonly string[];
  fontLicenses: readonly ExportFontLicense[];
  tailwindSource?: AuthoredScene;
  pixelRatio: number;
}): Promise<string> {
  if (
    !Number.isFinite(args.pixelRatio) ||
    args.pixelRatio <= 0 ||
    args.pixelRatio > 4
  )
    throw new DeclarativeExportError(
      "source-unsupported",
      "source-unsupported",
    );
  const screens = args.files.filter((file) => file.fileType === "html");
  if (screens.length !== 1)
    throw new DeclarativeExportError(
      "source-unsupported",
      "Native export requires exactly one selected HTML scene.",
    );
  const screen = screens[0];
  if (!screen?.content)
    throw new DeclarativeExportError(
      "source-unsupported",
      "Native export requires one HTML scene.",
    );
  const authored = prepareDeclarativeNativeSource(screen.content);
  for (const file of args.files)
    if (file.fileType === "css" && /@import\b/i.test(file.content ?? ""))
      throw new DeclarativeExportError(
        "resource-unsupported",
        "CSS imports are unsupported in deterministic native export.",
      );

  let staticTailwindCss = "";
  const tailwindSource = args.tailwindSource ?? authored;
  if (tailwindSource.hasTailwind) {
    try {
      staticTailwindCss = await compileStaticTailwind({
        classes: tailwindSource.tailwindClasses,
        authoredCss: tailwindSource.tailwindCss,
      });
    } catch (error) {
      if (error instanceof StaticTailwindExportError)
        throw new DeclarativeExportError(error.code, error.message);
      throw error;
    }
  }

  let html = buildStandaloneHtml({
    title: args.title,
    files: args.files.map((file) =>
      file === screen ? { ...file, content: authored.content } : file,
    ),
    screenLayout: "merged",
    approvedDefinitionHashes: args.approvedDefinitionHashes,
    fontLicenses: args.fontLicenses,
  });
  const { headEnd, runtimeStartTagEnd } = findTrustedScriptAndHead(html);
  const nonce = randomBytes(18).toString("base64");
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const insertions = [
    {
      at: headEnd,
      text: `<meta http-equiv="Content-Security-Policy" content="${policy}">${staticTailwindCss ? `<style data-agent-native-export-tailwind-static>${staticTailwindCss}</style>` : ""}`,
    },
    {
      at: runtimeStartTagEnd - 1,
      text: ` nonce="${nonce}" data-agent-native-export-initial-pixel-ratio="${args.pixelRatio}"`,
    },
  ].sort((left, right) => right.at - left.at);
  for (const insertion of insertions)
    html =
      html.slice(0, insertion.at) + insertion.text + html.slice(insertion.at);
  if (new TextEncoder().encode(html).byteLength > 5_000_000)
    throw new DeclarativeExportError(
      "package-too-large",
      "Native export scene exceeds the 5 MB package limit.",
    );
  return html;
}
