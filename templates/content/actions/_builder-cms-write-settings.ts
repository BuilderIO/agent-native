import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  type ContentDatabaseSourceCapabilities,
  type ContentDatabaseSourcePushMode,
  type ContentDatabaseSourceWriteMode,
} from "../shared/api.js";

export type BuilderCmsLiveWriteMode = Exclude<
  ContentDatabaseSourcePushMode,
  "none"
>;

export interface BuilderCmsWriteSettingsPatch {
  sourceType: string;
  sourceTable: string;
  capabilitiesJson: string;
  metadataJson: string;
  liveWritesEnabled?: boolean;
  writeMode?: ContentDatabaseSourceWriteMode;
  allowPublicationTransitions?: boolean;
  allowedWriteModes?: BuilderCmsLiveWriteMode[];
  allowDraftWrites?: boolean;
  allowPublishWrites?: boolean;
}

function parseRecord(
  value: string | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeMode(value: unknown): BuilderCmsLiveWriteMode | null {
  return value === "autosave" || value === "draft" || value === "publish"
    ? value
    : null;
}

function normalizeWriteMode(
  value: unknown,
): ContentDatabaseSourceWriteMode | null {
  return value === "read_only" ||
    value === "stage_only" ||
    value === "publish_updates"
    ? value
    : null;
}

function uniqueModes(
  modes: readonly BuilderCmsLiveWriteMode[] | undefined,
): BuilderCmsLiveWriteMode[] {
  const unique: BuilderCmsLiveWriteMode[] = [];
  for (const mode of modes ?? []) {
    if (!unique.includes(mode)) unique.push(mode);
  }
  return unique;
}

function legacyWriteModeFromStored(args: {
  liveWritesEnabled: boolean;
  allowedWriteModes: readonly BuilderCmsLiveWriteMode[];
  pushMode?: unknown;
}): ContentDatabaseSourceWriteMode {
  if (!args.liveWritesEnabled) return "read_only";
  const pushMode = normalizeMode(args.pushMode);
  return args.allowedWriteModes.some((mode) => mode !== "autosave") ||
    (pushMode && pushMode !== "autosave")
    ? "publish_updates"
    : "stage_only";
}

function writeModeFromPatch(
  args: BuilderCmsWriteSettingsPatch,
): ContentDatabaseSourceWriteMode {
  const explicit = normalizeWriteMode(args.writeMode);
  if (args.writeMode !== undefined && !explicit) {
    throw new Error("Choose a valid Builder write mode.");
  }
  if (explicit) return explicit;
  if (args.liveWritesEnabled === false) return "read_only";
  if (args.liveWritesEnabled === true) {
    const allowed = uniqueModes(args.allowedWriteModes);
    return allowed.some((mode) => mode !== "autosave")
      ? "publish_updates"
      : "stage_only";
  }
  const metadata = parseRecord(args.metadataJson);
  const capabilities = parseRecord(args.capabilitiesJson);
  const allowedWriteModes = Array.isArray(metadata.allowedWriteModes)
    ? uniqueModes(
        metadata.allowedWriteModes
          .map(normalizeMode)
          .filter((mode): mode is BuilderCmsLiveWriteMode => !!mode),
      )
    : [];
  return (
    normalizeWriteMode(metadata.writeMode) ??
    legacyWriteModeFromStored({
      liveWritesEnabled: capabilities.liveWritesEnabled === true,
      allowedWriteModes,
      pushMode: metadata.pushMode,
    })
  );
}

function allowedWriteModesForTier(
  writeMode: ContentDatabaseSourceWriteMode,
): BuilderCmsLiveWriteMode[] {
  if (writeMode === "stage_only") return ["autosave"];
  if (writeMode === "publish_updates") return ["autosave", "publish"];
  return [];
}

function pushModeForTier(
  writeMode: ContentDatabaseSourceWriteMode,
): ContentDatabaseSourcePushMode {
  if (writeMode === "stage_only") return "autosave";
  if (writeMode === "publish_updates") return "publish";
  return "none";
}

export function builderCmsWriteSettingsFromJson(args: {
  capabilitiesJson: string | null | undefined;
  metadataJson: string | null | undefined;
}) {
  const capabilities = parseRecord(args.capabilitiesJson);
  const metadata = parseRecord(args.metadataJson);
  const legacyAllowedWriteModes = Array.isArray(metadata.allowedWriteModes)
    ? uniqueModes(
        metadata.allowedWriteModes
          .map(normalizeMode)
          .filter((mode): mode is BuilderCmsLiveWriteMode => !!mode),
      )
    : [];
  const writeMode =
    normalizeWriteMode(metadata.writeMode) ??
    legacyWriteModeFromStored({
      liveWritesEnabled: capabilities.liveWritesEnabled === true,
      allowedWriteModes: legacyAllowedWriteModes,
      pushMode: metadata.pushMode,
    });
  const allowedWriteModes = allowedWriteModesForTier(writeMode);

  return {
    writeMode,
    liveWritesEnabled: writeMode !== "read_only",
    allowedWriteModes,
    allowPublicationTransitions:
      writeMode === "publish_updates" &&
      metadata.allowPublicationTransitions === true,
    allowDraftWrites: false,
    allowPublishWrites: writeMode === "publish_updates",
  };
}

export function buildBuilderCmsWriteModeJson(
  args: BuilderCmsWriteSettingsPatch,
) {
  const capabilities = parseRecord(args.capabilitiesJson);
  const metadata = parseRecord(args.metadataJson);
  const writeMode = writeModeFromPatch(args);
  const enabled = writeMode !== "read_only";
  const allowPublicationTransitions =
    enabled &&
    writeMode === "publish_updates" &&
    args.allowPublicationTransitions === true;

  if (enabled) {
    if (args.sourceType !== "builder-cms") {
      throw new Error(
        "Live writes can only be enabled for Builder CMS sources.",
      );
    }
    if (args.sourceTable !== BUILDER_CMS_SAFE_WRITE_MODEL) {
      throw new Error(
        `Live Builder writes are only allowed for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
      );
    }
  }

  if (
    args.allowPublicationTransitions === true &&
    writeMode !== "publish_updates"
  ) {
    throw new Error("Publication transitions require publish updates mode.");
  }

  const allowedWriteModes = allowedWriteModesForTier(writeMode);
  const nextCapabilities: Partial<ContentDatabaseSourceCapabilities> = {
    ...capabilities,
    liveWritesEnabled: enabled,
  };
  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    writeMode,
    allowPublicationTransitions,
    allowedWriteModes,
    allowDraftWrites: false,
    allowPublishWrites: writeMode === "publish_updates",
    pushMode: pushModeForTier(writeMode),
  };

  return {
    capabilitiesJson: JSON.stringify(nextCapabilities),
    metadataJson: JSON.stringify(nextMetadata),
  };
}

export function mergeBuilderCmsWriteSettingsIntoJson(args: {
  sourceTable: string;
  currentCapabilitiesJson: string | null | undefined;
  currentMetadataJson: string | null | undefined;
  nextCapabilitiesJson: string;
  nextMetadataJson: string;
}) {
  const currentSettings = builderCmsWriteSettingsFromJson({
    capabilitiesJson: args.currentCapabilitiesJson,
    metadataJson: args.currentMetadataJson,
  });
  if (
    currentSettings.liveWritesEnabled !== true ||
    args.sourceTable !== BUILDER_CMS_SAFE_WRITE_MODEL ||
    currentSettings.writeMode === "read_only"
  ) {
    return {
      capabilitiesJson: args.nextCapabilitiesJson,
      metadataJson: args.nextMetadataJson,
    };
  }

  return buildBuilderCmsWriteModeJson({
    sourceType: "builder-cms",
    sourceTable: args.sourceTable,
    capabilitiesJson: args.nextCapabilitiesJson,
    metadataJson: args.nextMetadataJson,
    writeMode: currentSettings.writeMode,
    allowPublicationTransitions: currentSettings.allowPublicationTransitions,
  });
}

export function builderCmsAllowedWriteModesForTier(
  writeMode: ContentDatabaseSourceWriteMode,
) {
  return allowedWriteModesForTier(writeMode);
}

export function builderCmsPushModeForTier(
  writeMode: ContentDatabaseSourceWriteMode,
) {
  return pushModeForTier(writeMode);
}
