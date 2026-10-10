import { NATIVE_EFFECT_DEFINITION_CATALOG } from "@shared/native-effect-presets";
import {
  hashEffectDefinition,
  parseNativeEffectApprovalState,
} from "@shared/native-effect-trust";
import {
  parseEffectsFromHtml,
  writeEffectsToHtml,
  type EffectDocument,
} from "@shared/native-effects";
import { parseNativeEmbeddedAssetRegistryText } from "@shared/native-embedded-assets";
import {
  nativeLocalExportCropSchema,
  type NativeLocalExportCrop,
} from "@shared/native-local-export";

export class NativeSelectedSourceError extends Error {
  constructor(
    readonly code:
      | "source-unreadable"
      | "selection-unavailable"
      | "dependency-outside-selection",
    message: string,
  ) {
    super(message);
    this.name = "NativeSelectedSourceError";
  }
}

function requiredScriptKind(script: HTMLScriptElement): string {
  const type = script.type;
  if (type === "application/x-agent-native-effects") return "manifest";
  if (
    type === "application/x-agent-native-effect-approvals" &&
    script.hasAttribute("data-agent-native-export-approvals")
  )
    return "approvals";
  if (
    type === "application/x-agent-native-effect-assets" &&
    script.hasAttribute("data-agent-native-export-assets")
  )
    return "assets";
  if (
    type === "text/plain" &&
    script.hasAttribute("data-agent-native-export-font-licenses")
  )
    return "font-licenses";
  if (script.hasAttribute("data-agent-native-native-shader-runtime"))
    return "runtime";
  throw new NativeSelectedSourceError(
    "source-unreadable",
    "Selected native source contains an unsupported script.",
  );
}

export async function extractNativeSelectedSource(args: {
  html: string;
  crop: NativeLocalExportCrop;
}): Promise<string> {
  const crop = nativeLocalExportCropSchema.safeParse(args.crop);
  if (!crop.success)
    throw new NativeSelectedSourceError(
      "selection-unavailable",
      "The selected node crop is invalid.",
    );
  const parsed = parseEffectsFromHtml(args.html);
  if (parsed.errors.length || !parsed.document)
    throw new NativeSelectedSourceError(
      "source-unreadable",
      "The selected native source manifest is unreadable.",
    );
  const doc = new DOMParser().parseFromString(args.html, "text/html");
  const matches = [
    ...doc.querySelectorAll<HTMLElement>("[data-agent-native-node-id]"),
  ].filter(
    (element) =>
      element.getAttribute("data-agent-native-node-id") === crop.data.nodeId,
  );
  const target = matches[0];
  if (matches.length !== 1 || !target || !doc.body.contains(target))
    throw new NativeSelectedSourceError(
      "selection-unavailable",
      "The selected authored node is missing or ambiguous in the packaged scene.",
    );
  const scripts = [...doc.querySelectorAll<HTMLScriptElement>("script")];
  const scriptKinds = scripts.map(requiredScriptKind);
  const approvals = scripts.filter(
    (_, index) => scriptKinds[index] === "approvals",
  );
  if (
    scriptKinds.filter((kind) => kind === "runtime").length !== 1 ||
    scriptKinds.filter((kind) => kind === "manifest").length !== 1 ||
    approvals.length !== 1
  )
    throw new NativeSelectedSourceError(
      "source-unreadable",
      "The selected native package is missing exact runtime metadata.",
    );

  const selectedNodeIds = [
    target,
    ...target.querySelectorAll<HTMLElement>("[data-agent-native-node-id]"),
  ]
    .map((element) => element.getAttribute("data-agent-native-node-id"))
    .filter((id): id is string => Boolean(id));
  const selectedIds = new Set(selectedNodeIds);
  if (selectedIds.size !== selectedNodeIds.length)
    throw new NativeSelectedSourceError(
      "selection-unavailable",
      "The selected subtree has ambiguous authored node IDs.",
    );
  const instances = parsed.document.instances.filter((instance) =>
    selectedIds.has(instance.nodeId),
  );
  if (!instances.some((instance) => instance.enabled))
    throw new NativeSelectedSourceError(
      "selection-unavailable",
      "The selected source contains no enabled native effect.",
    );
  for (const instance of instances) {
    if (instance.placement === "backdrop")
      throw new NativeSelectedSourceError(
        "dependency-outside-selection",
        "A selected backdrop needs authored content outside the selected subtree.",
      );
    for (const binding of Object.values(instance.bindings ?? {}))
      if (binding.kind === "authored-node" && !selectedIds.has(binding.nodeId))
        throw new NativeSelectedSourceError(
          "dependency-outside-selection",
          "A native input binding leaves the selected authored subtree.",
        );
  }
  for (
    let ancestor = target.parentElement;
    ancestor && ancestor !== doc.body;
    ancestor = ancestor.parentElement
  ) {
    const id = ancestor.getAttribute("data-agent-native-node-id");
    if (
      id &&
      parsed.document.instances.some(
        (instance) => instance.enabled && instance.nodeId === id,
      )
    )
      throw new NativeSelectedSourceError(
        "dependency-outside-selection",
        "An ancestor native effect changes the selected subtree.",
      );
  }
  const definitionKeys = new Set(
    instances.map(
      (instance) =>
        `${instance.definitionId}\u0000${instance.definitionVersion}`,
    ),
  );
  const definitions = parsed.document.definitions.filter((definition) =>
    definitionKeys.has(`${definition.id}\u0000${definition.version}`),
  );
  const next: EffectDocument = {
    schemaVersion: 2,
    definitions,
    instances,
    ...(parsed.document.presets && {
      presets: parsed.document.presets.filter((preset) =>
        definitionKeys.has(
          `${preset.definitionId}\u0000${preset.definitionVersion}`,
        ),
      ),
    }),
    ...(parsed.document.preview && { preview: parsed.document.preview }),
  };

  let kept: Element = target;
  for (
    let parent = target.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (parent !== doc.body && !doc.body.contains(parent))
      throw new NativeSelectedSourceError(
        "selection-unavailable",
        "The selected node left the scene body.",
      );
    for (const child of [...parent.childNodes]) {
      if (child === kept) continue;
      if (
        child instanceof Element &&
        (child.tagName === "STYLE" || child.tagName === "SCRIPT")
      )
        continue;
      child.remove();
    }
    if (parent === doc.body) break;
    kept = parent;
  }
  for (const script of scripts)
    if (!script.isConnected) doc.body.append(script);

  const approved = approvals[0];
  let approvalState: ReturnType<typeof parseNativeEffectApprovalState>;
  try {
    approvalState = parseNativeEffectApprovalState(
      JSON.parse(approved.textContent ?? ""),
    );
  } catch {
    throw new NativeSelectedSourceError(
      "source-unreadable",
      "The native approval metadata is unreadable.",
    );
  }
  const retainedHashes = new Set(
    await Promise.all(definitions.map(hashEffectDefinition)),
  );
  const builtinHashes = new Set(
    await Promise.all(
      NATIVE_EFFECT_DEFINITION_CATALOG.map(hashEffectDefinition),
    ),
  );
  const customHashes = [...retainedHashes].filter(
    (hash) => !builtinHashes.has(hash),
  );
  if (customHashes.some((hash) => !approvalState.hashes.includes(hash)))
    throw new NativeSelectedSourceError(
      "source-unreadable",
      "The selected native definitions lack approved source hashes.",
    );
  approved.textContent = JSON.stringify({
    schemaVersion: 1,
    hashes: approvalState.hashes.filter((hash) => customHashes.includes(hash)),
  });
  const assetScripts = scripts.filter(
    (_, index) => scriptKinds[index] === "assets",
  );
  if (assetScripts.length > 1)
    throw new NativeSelectedSourceError(
      "source-unreadable",
      "The selected scene has ambiguous embedded assets.",
    );
  if (assetScripts[0]) {
    let registry: ReturnType<typeof parseNativeEmbeddedAssetRegistryText>;
    try {
      registry = parseNativeEmbeddedAssetRegistryText(
        assetScripts[0].textContent ?? "",
      );
    } catch {
      throw new NativeSelectedSourceError(
        "source-unreadable",
        "The selected scene has unreadable embedded assets.",
      );
    }
    const references = [
      JSON.stringify(next),
      ...[...doc.querySelectorAll("*:not(script)")].flatMap((element) => [
        ...[...element.attributes].map((attribute) => attribute.value),
        ...(element.tagName === "STYLE" ? [element.textContent ?? ""] : []),
      ]),
    ];
    assetScripts[0].textContent = JSON.stringify({
      schemaVersion: 1,
      assets: registry.assets.filter((asset) =>
        references.some((reference) => reference.includes(asset.path)),
      ),
    });
  }
  const cropStyle = doc.createElement("style");
  cropStyle.setAttribute("data-agent-native-export-crop", "");
  cropStyle.textContent = `body{translate:${-crop.data.x}px ${-crop.data.y}px !important}`;
  doc.head.append(cropStyle);
  const output = writeEffectsToHtml(
    `<!doctype html>${doc.documentElement.outerHTML}`,
    next,
  );
  const verified = parseEffectsFromHtml(output);
  if (
    verified.errors.length ||
    verified.document?.instances.length !== instances.length
  )
    throw new NativeSelectedSourceError(
      "source-unreadable",
      "The selected native source could not be validated.",
    );
  return output;
}
