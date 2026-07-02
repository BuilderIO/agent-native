import { describe, expect, it } from "vitest";

import { BUILDER_CMS_SAFE_WRITE_MODEL } from "../shared/api";
import {
  builderCmsWriteSettingsFromJson,
  buildBuilderCmsWriteModeJson,
  mergeBuilderCmsWriteSettingsIntoJson,
} from "./_builder-cms-write-settings";
import { sourceCapabilitiesForType } from "./_database-source-utils";

const baseMetadata = JSON.stringify({
  primaryKey: "id",
  titleField: "data.title",
  pushMode: "none",
  writeMode: "read_only",
  readMode: "builder-api",
  liveReadConfigured: true,
  allowedWriteModes: [],
  allowPublicationTransitions: false,
  allowDraftWrites: false,
  allowPublishWrites: false,
});

describe("Builder CMS write settings", () => {
  it("enables live writes only with explicit modes for the safe test model", () => {
    const next = buildBuilderCmsWriteModeJson({
      sourceType: "builder-cms",
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      capabilitiesJson: sourceCapabilitiesForType("builder-cms"),
      metadataJson: baseMetadata,
      writeMode: "stage_only",
    });

    expect(
      builderCmsWriteSettingsFromJson({
        capabilitiesJson: next.capabilitiesJson,
        metadataJson: next.metadataJson,
      }),
    ).toEqual({
      writeMode: "stage_only",
      liveWritesEnabled: true,
      allowedWriteModes: ["autosave"],
      allowPublicationTransitions: false,
      allowDraftWrites: false,
      allowPublishWrites: false,
    });
  });

  it("derives live write capability and allowed modes from publish updates", () => {
    const next = buildBuilderCmsWriteModeJson({
      sourceType: "builder-cms",
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      capabilitiesJson: sourceCapabilitiesForType("builder-cms"),
      metadataJson: baseMetadata,
      writeMode: "publish_updates",
      allowPublicationTransitions: true,
    });

    expect(
      builderCmsWriteSettingsFromJson({
        capabilitiesJson: next.capabilitiesJson,
        metadataJson: next.metadataJson,
      }),
    ).toEqual({
      writeMode: "publish_updates",
      liveWritesEnabled: true,
      allowedWriteModes: ["autosave", "publish"],
      allowPublicationTransitions: true,
      allowDraftWrites: false,
      allowPublishWrites: true,
    });
    expect(JSON.parse(next.metadataJson)).toMatchObject({
      pushMode: "publish",
      writeMode: "publish_updates",
      allowedWriteModes: ["autosave", "publish"],
    });
  });

  it("requires publish updates before enabling publication transitions", () => {
    expect(() =>
      buildBuilderCmsWriteModeJson({
        sourceType: "builder-cms",
        sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
        capabilitiesJson: sourceCapabilitiesForType("builder-cms"),
        metadataJson: baseMetadata,
        writeMode: "stage_only",
        allowPublicationTransitions: true,
      }),
    ).toThrow("Publication transitions require publish updates mode.");
  });

  it("blocks publish updates for non-test Builder models", () => {
    expect(() =>
      buildBuilderCmsWriteModeJson({
        sourceType: "builder-cms",
        sourceTable: "blog_article",
        capabilitiesJson: sourceCapabilitiesForType("builder-cms"),
        metadataJson: baseMetadata,
        writeMode: "publish_updates",
      }),
    ).toThrow(
      `Live Builder writes are only allowed for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
    );
  });

  it("disabling clears live write eligibility and mode opt-ins", () => {
    const enabled = buildBuilderCmsWriteModeJson({
      sourceType: "builder-cms",
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      capabilitiesJson: sourceCapabilitiesForType("builder-cms"),
      metadataJson: baseMetadata,
      writeMode: "publish_updates",
      allowPublicationTransitions: true,
    });
    const disabled = buildBuilderCmsWriteModeJson({
      sourceType: "builder-cms",
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      capabilitiesJson: enabled.capabilitiesJson,
      metadataJson: enabled.metadataJson,
      writeMode: "read_only",
    });

    expect(
      builderCmsWriteSettingsFromJson({
        capabilitiesJson: disabled.capabilitiesJson,
        metadataJson: disabled.metadataJson,
      }),
    ).toEqual({
      writeMode: "read_only",
      liveWritesEnabled: false,
      allowedWriteModes: [],
      allowPublicationTransitions: false,
      allowDraftWrites: false,
      allowPublishWrites: false,
    });
    expect(JSON.parse(disabled.metadataJson)).toMatchObject({
      pushMode: "none",
      writeMode: "read_only",
      allowPublicationTransitions: false,
    });
  });

  it("preserves explicit safe-model enablement across Builder refresh metadata", () => {
    const enabled = buildBuilderCmsWriteModeJson({
      sourceType: "builder-cms",
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      capabilitiesJson: sourceCapabilitiesForType("builder-cms"),
      metadataJson: baseMetadata,
      writeMode: "stage_only",
    });

    const refreshed = mergeBuilderCmsWriteSettingsIntoJson({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      currentCapabilitiesJson: enabled.capabilitiesJson,
      currentMetadataJson: enabled.metadataJson,
      nextCapabilitiesJson: sourceCapabilitiesForType("builder-cms"),
      nextMetadataJson: JSON.stringify({
        primaryKey: "id",
        titleField: "data.title",
        pushMode: "none",
        writeMode: "read_only",
        readMode: "builder-api",
        liveReadConfigured: true,
        lastReadEntryCount: 20,
        lastReadMatchedRowCount: 20,
      }),
    });

    expect(
      builderCmsWriteSettingsFromJson({
        capabilitiesJson: refreshed.capabilitiesJson,
        metadataJson: refreshed.metadataJson,
      }),
    ).toMatchObject({
      writeMode: "stage_only",
      liveWritesEnabled: true,
      allowedWriteModes: ["autosave"],
    });
    expect(JSON.parse(refreshed.metadataJson)).toMatchObject({
      liveReadConfigured: true,
      lastReadEntryCount: 20,
      lastReadMatchedRowCount: 20,
    });
  });

  it("does not preserve enablement across refresh for non-test Builder models", () => {
    const refreshed = mergeBuilderCmsWriteSettingsIntoJson({
      sourceTable: "blog_article",
      currentCapabilitiesJson: JSON.stringify({ liveWritesEnabled: true }),
      currentMetadataJson: JSON.stringify({
        writeMode: "stage_only",
        allowedWriteModes: ["autosave"],
      }),
      nextCapabilitiesJson: sourceCapabilitiesForType("builder-cms"),
      nextMetadataJson: baseMetadata,
    });

    expect(
      builderCmsWriteSettingsFromJson({
        capabilitiesJson: refreshed.capabilitiesJson,
        metadataJson: refreshed.metadataJson,
      }).liveWritesEnabled,
    ).toBe(false);
  });

  it("keeps legacy live-write requests working as stage-only", () => {
    const next = buildBuilderCmsWriteModeJson({
      sourceType: "builder-cms",
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      capabilitiesJson: sourceCapabilitiesForType("builder-cms"),
      metadataJson: baseMetadata,
      liveWritesEnabled: true,
      allowedWriteModes: ["autosave"],
    });

    expect(
      builderCmsWriteSettingsFromJson({
        capabilitiesJson: next.capabilitiesJson,
        metadataJson: next.metadataJson,
      }),
    ).toMatchObject({
      writeMode: "stage_only",
      liveWritesEnabled: true,
      allowedWriteModes: ["autosave"],
    });
  });
});
