import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  type ContentDatabaseSourceCapabilities,
  type ContentDatabaseSourcePushMode,
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
  liveWritesEnabled: boolean;
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

function uniqueModes(
  modes: readonly BuilderCmsLiveWriteMode[] | undefined,
): BuilderCmsLiveWriteMode[] {
  const unique: BuilderCmsLiveWriteMode[] = [];
  for (const mode of modes ?? []) {
    if (!unique.includes(mode)) unique.push(mode);
  }
  return unique;
}

export function builderCmsWriteSettingsFromJson(args: {
  capabilitiesJson: string | null | undefined;
  metadataJson: string | null | undefined;
}) {
  const capabilities = parseRecord(args.capabilitiesJson);
  const metadata = parseRecord(args.metadataJson);
  const allowedWriteModes = Array.isArray(metadata.allowedWriteModes)
    ? uniqueModes(
        metadata.allowedWriteModes
          .map(normalizeMode)
          .filter((mode): mode is BuilderCmsLiveWriteMode => !!mode),
      )
    : [];

  return {
    liveWritesEnabled: capabilities.liveWritesEnabled === true,
    allowedWriteModes,
    allowDraftWrites: metadata.allowDraftWrites === true,
    allowPublishWrites: metadata.allowPublishWrites === true,
  };
}

export function buildBuilderCmsWriteModeJson(
  args: BuilderCmsWriteSettingsPatch,
) {
  const capabilities = parseRecord(args.capabilitiesJson);
  const metadata = parseRecord(args.metadataJson);

  if (args.liveWritesEnabled) {
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

  const enabled = args.liveWritesEnabled === true;
  const allowedWriteModes = enabled ? uniqueModes(args.allowedWriteModes) : [];
  if (args.liveWritesEnabled && allowedWriteModes.length === 0) {
    throw new Error(
      "Choose at least one allowed Builder write mode before enabling live writes.",
    );
  }
  if (
    enabled &&
    allowedWriteModes.includes("draft") &&
    args.allowDraftWrites !== true
  ) {
    throw new Error("Draft writes require explicit draft opt-in.");
  }
  if (
    enabled &&
    allowedWriteModes.includes("publish") &&
    args.allowPublishWrites !== true
  ) {
    throw new Error("Publish writes require explicit publish opt-in.");
  }

  const nextCapabilities: Partial<ContentDatabaseSourceCapabilities> = {
    ...capabilities,
    liveWritesEnabled: enabled,
  };
  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    allowedWriteModes: enabled ? allowedWriteModes : [],
    allowDraftWrites: enabled && args.allowDraftWrites === true,
    allowPublishWrites: enabled && args.allowPublishWrites === true,
  };

  if (
    enabled &&
    (!nextMetadata.pushMode ||
      nextMetadata.pushMode === "none" ||
      !allowedWriteModes.includes(
        normalizeMode(nextMetadata.pushMode) ?? "autosave",
      ))
  ) {
    nextMetadata.pushMode = allowedWriteModes[0];
  }

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
    currentSettings.allowedWriteModes.length === 0
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
    liveWritesEnabled: true,
    allowedWriteModes: currentSettings.allowedWriteModes,
    allowDraftWrites: currentSettings.allowDraftWrites,
    allowPublishWrites: currentSettings.allowPublishWrites,
  });
}
