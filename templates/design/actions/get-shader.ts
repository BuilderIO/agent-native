import { defineAction, fail } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import {
  loadSelectedSourceWorkspaceFile,
  readLiveSourceFile,
  resolveSourceWorkspace,
} from "../server/source-workspace.js";
import { nativeEffectAnimationCapability } from "../shared/native-effect-animation-capability.js";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_PRESETS,
} from "../shared/native-effect-presets.js";
import {
  NativeEffectApprovalStateError,
  nativeEffectApprovalKey,
  parseNativeEffectApprovalState,
} from "../shared/native-effect-trust.js";
import {
  inspectNativeEffectHtml,
  type EffectDefinition,
} from "../shared/native-effects.js";
import {
  SHADER_PRESET_MAP,
  SHADER_PRESETS,
  type ShaderPresetName,
} from "../shared/shader-presets.js";

function summarizeNativeDefinition(definition: EffectDefinition) {
  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    kind: definition.kind,
    animationCapability: nativeEffectAnimationCapability(definition),
    placements: definition.placements,
    properties: definition.properties,
    inputs: definition.inputs ?? null,
    outputs: definition.outputs ?? null,
    resources: definition.resources ?? null,
    output: definition.output ?? null,
    passes: definition.passes.map((pass) => ({
      id: pass.id,
      kind: pass.kind,
      reads: pass.reads,
      output: pass.output,
    })),
  };
}

export default defineAction({
  description:
    "Discover the exact registered native GPU effect versions and presets, or inspect a selected inline Design file's saved native manifest. " +
    "Only the 16 curated exact versions execute in Tier 1; existing custom definitions remain inspectable in saved manifests. Use the returned versionHash with edit-native-shader for CAS-protected changes. format=legacy returns read-only historical shader descriptors.",
  http: { method: "GET" },
  schema: z.object({
    format: z.enum(["native-v2", "legacy"]).default("native-v2"),
    definitionId: z.string().optional(),
    definitionVersion: z.coerce.number().int().positive().optional(),
    includeSource: z
      .union([
        z.boolean(),
        z.enum(["true", "false"]).transform((value) => value === "true"),
      ])
      .optional(),
    source: z
      .object({
        kind: z.enum(["design-file", "inline-html"]).default("design-file"),
        designId: z.string().optional(),
        fileId: z.string().optional(),
        path: z.string().optional(),
      })
      .optional()
      .describe(
        "Optional design source context. When provided, the instructions are tailored to the source kind.",
      ),
    target: z
      .object({
        nodeId: z.string().optional(),
        selector: z.string().optional(),
      })
      .optional()
      .describe(
        "Optional target element. When provided, the inspection hint is scoped to that element.",
      ),
  }),
  readOnly: true,
  run: async ({
    format,
    definitionId,
    definitionVersion,
    includeSource,
    source,
    target,
  }) => {
    if (format === "native-v2") {
      if (
        source?.kind === "inline-html" ||
        (source && (!source.designId || (!source.fileId && !source.path)))
      )
        fail("Native effect inspection needs a Design file ID or path.", {
          errorCode: "native_effect_source_required",
          statusCode: 400,
        });
      let document: ReturnType<typeof inspectNativeEffectHtml>["document"] =
        null;
      let file: { id: string; filename: string } | null = null;
      let versionHash: string | null = null;
      let targetNodeState: "not-requested" | "present" = "not-requested";
      let approvedDefinitionHashes: string[] = [];
      if (source) {
        const designId = source.designId!;
        const workspace = await resolveSourceWorkspace(designId, {
          includeContent: false,
          includeBoard: true,
        });
        const selectedFile = workspace.files.find((candidate) =>
          source.fileId
            ? candidate.id === source.fileId
            : candidate.filename === source.path,
        );
        if (!selectedFile)
          fail("Design source file not found.", {
            errorCode: "native_effect_file_not_found",
            statusCode: 404,
          });
        if (selectedFile.fileType !== "html")
          fail("Native effects require an inline HTML file.", {
            errorCode: "native_effect_non_html",
            statusCode: 400,
          });
        const selectedWithContent =
          await loadSelectedSourceWorkspaceFile(selectedFile);
        if (!selectedWithContent)
          fail("Design source file not found.", {
            errorCode: "native_effect_file_not_found",
            statusCode: 404,
          });
        const live = await readLiveSourceFile(selectedWithContent);
        const parsed = inspectNativeEffectHtml(live.content, target?.nodeId);
        if (parsed.errors.length)
          fail(
            `Native effect manifest is unreadable: ${parsed.errors.join("; ")}`,
            {
              errorCode: "native_effect_manifest_unreadable",
              statusCode: 422,
              details: { errors: parsed.errors },
            },
          );
        if (target?.nodeId) {
          if (parsed.target.activeCount !== 1)
            fail(
              `Expected one authored node ${target.nodeId}, found ${parsed.target.activeCount}.`,
              {
                errorCode: parsed.target.activeCount
                  ? "native_effect_target_ambiguous"
                  : "native_effect_target_not_found",
                statusCode: parsed.target.activeCount ? 422 : 404,
              },
            );
          targetNodeState = "present";
        }
        document = parsed.document;
        file = selectedFile;
        versionHash = live.versionHash;
        try {
          approvedDefinitionHashes = parseNativeEffectApprovalState(
            await readAppState(nativeEffectApprovalKey(designId)),
          ).hashes;
        } catch (error) {
          if (!(error instanceof NativeEffectApprovalStateError)) throw error;
          fail("Native effect approval state is unreadable.", {
            errorCode: "native_effect_approvals_unreadable",
            statusCode: 422,
          });
        }
      }
      const definitions = new Map<string, EffectDefinition>();
      for (const definition of [
        ...NATIVE_EFFECT_DEFINITION_CATALOG,
        ...(document?.definitions ?? []),
      ])
        definitions.set(
          `${definition.id}\u0000${definition.version}`,
          definition,
        );
      const catalog = [...definitions.values()].filter(
        (definition) =>
          (!definitionId || definition.id === definitionId) &&
          (!definitionVersion || definition.version === definitionVersion),
      );
      if (definitionId && catalog.length === 0)
        fail("Native effect definition version not found.", {
          errorCode: "native_effect_definition_not_found",
          statusCode: 404,
        });
      const builtins = NATIVE_EFFECT_DEFINITION_CATALOG.map(
        summarizeNativeDefinition,
      );
      return {
        format,
        manifestState: !source
          ? ("not-requested" as const)
          : document
            ? ("present" as const)
            : ("absent" as const),
        designId: source?.designId ?? null,
        fileId: file?.id ?? null,
        path: file?.filename ?? null,
        versionHash,
        targetNodeState,
        approvedDefinitionHashes,
        document: document
          ? {
              schemaVersion: document.schemaVersion,
              definitions: document.definitions.map(summarizeNativeDefinition),
              instances: document.instances,
              presets: document.presets ?? [],
              preview: document.preview ?? null,
            }
          : null,
        targetInstances: target?.nodeId
          ? (document?.instances ?? []).filter(
              (instance) => instance.nodeId === target.nodeId,
            )
          : (document?.instances ?? []),
        definitions: catalog.map(summarizeNativeDefinition),
        selectedDefinition: includeSource ? (catalog[0] ?? null) : null,
        presets: [...NATIVE_EFFECT_PRESETS, ...(document?.presets ?? [])],
        library: {
          builtins,
          items: [],
          hasMore: false,
          nextCursor: null,
          selectedEntry: null,
        },
      };
    }
    const sourceKind = source?.kind ?? "design-file";
    const targetDescription = target?.nodeId
      ? `element with id="${target.nodeId}"`
      : target?.selector
        ? `element matching "${target.selector}"`
        : "any element";

    const availablePresets = (
      Object.keys(SHADER_PRESET_MAP) as ShaderPresetName[]
    ).map((name) => {
      const def = SHADER_PRESET_MAP[name];
      return {
        name,
        label: def.label,
        description: def.description,
        isEffect: def.isEffect ?? false,
        maxColorCount: def.maxColorCount,
        paramKeys: def.params.map((p) => p.key),
      };
    });

    const presetSummaryLines = SHADER_PRESETS.map((p) => {
      const paramKeys = p.params.map((param) => param.key).join(", ");
      return `  ${p.name} (${p.label}): ${p.description}${paramKeys ? ` — params: ${paramKeys}` : ""}`;
    });

    const inspectionStepsFramework = [
      `1. Call get-code-layer-projection with the design source to retrieve the rendered HTML or JSX.`,
      `2. Look for any import from "@paper-design/shaders-react".`,
      `   If found, note the imported component name — that is the active preset.`,
      `3. Read the component's JSX props: colors, colorBack, colorFront, speed, frame, fit, scale,`,
      `   rotation, offsetX, offsetY, and any shader-specific params (distortion, swirl, shape, etc.).`,
      `4. The zIndex prop (or style.zIndex) tells you whether it's a fill (0) or effect (2).`,
      `5. Reconstruct the ShaderDescriptor from those props to pass back to apply-shader if editing.`,
    ];

    const inspectionStepsInline = [
      `1. Call get-code-layer-projection with the design source to retrieve the rendered HTML.`,
      `2. Look for <canvas data-shader='...'> elements${target ? ` inside ${targetDescription}` : ""}.`,
      `3. Parse the data-shader JSON attribute — it is a ShaderDescriptor object with`,
      `   { preset, params, colors?, speed?, frame?, fit?, scale?, rotation?, offsetX?, offsetY? }.`,
      `4. The canvas element's inline style z-index tells you whether it's a fill (0) or effect (2).`,
      `5. To update the shader, modify the data-shader attribute value via apply-visual-edit`,
      `   with a style or attribute intent, or use apply-shader to regenerate the canvas element.`,
    ];

    const inspectionSteps =
      sourceKind === "inline-html"
        ? inspectionStepsInline
        : inspectionStepsFramework;

    const hint =
      sourceKind === "inline-html"
        ? `Search the HTML for data-shader attributes. The value is a JSON ShaderDescriptor. ` +
          `Example: data-shader='{"preset":"MeshGradient","params":{"distortion":0.8},"colors":["#e0eaff","#241d9a"]}'.`
        : `Search the JSX for imports from "@paper-design/shaders-react" and look for the component ` +
          `(e.g. <MeshGradient colors={[...]} distortion={0.8} style={{...}} />). ` +
          `The component name is the preset name.`;

    const instructions = [
      `To read the current shader state on ${targetDescription}:`,
      "",
      ...inspectionSteps,
      "",
      `Hint: ${hint}`,
      "",
      `To apply or change a shader, call apply-shader with the desired descriptor.`,
      `apply-shader validates params and returns the exact JSX or HTML to insert.`,
    ].join("\n");

    return {
      availablePresets,
      presetNames: availablePresets.map((p) => p.name),
      presetSummary: presetSummaryLines.join("\n"),
      instructions,
      hint,
    };
  },
});
