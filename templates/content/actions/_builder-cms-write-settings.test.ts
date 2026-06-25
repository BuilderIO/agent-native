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
  pushMode: "autosave",
  readMode: "builder-api",
  liveReadConfigured: true,
  allowedWriteModes: ["autosave"],
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
      liveWritesEnabled: true,
      allowedWriteModes: ["autosave"],
    });

    expect(
      builderCmsWriteSettingsFromJson({
        capabilitiesJson: next.capabilitiesJson,
        metadataJson: next.metadataJson,
      }),
    ).toEqual({
      liveWritesEnabled: true,
      allowedWriteModes: ["autosave"],
      allowDraftWrites: false,
      allowPublishWrites: false,
    });
  });

  it("refuses enablement when allowed modes are missing", () => {
    expect(() =>
      buildBuilderCmsWriteModeJson({
        sourceType: "builder-cms",
        sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
        capabilitiesJson: sourceCapabilitiesForType("builder-cms"),
        metadataJson: baseMetadata,
        liveWritesEnabled: true,
        allowedWriteModes: [],
      }),
    ).toThrow(/at least one allowed Builder write mode/);
  });

  it("blocks live writes for non-test Builder models", () => {
    expect(() =>
      buildBuilderCmsWriteModeJson({
        sourceType: "builder-cms",
        sourceTable: "blog_article",
        capabilitiesJson: sourceCapabilitiesForType("builder-cms"),
        metadataJson: baseMetadata,
        liveWritesEnabled: true,
        allowedWriteModes: ["autosave"],
      }),
    ).toThrow(
      `Live Builder writes are only allowed for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
    );
  });

  it("requires explicit draft and publish opt-ins", () => {
    expect(() =>
      buildBuilderCmsWriteModeJson({
        sourceType: "builder-cms",
        sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
        capabilitiesJson: sourceCapabilitiesForType("builder-cms"),
        metadataJson: baseMetadata,
        liveWritesEnabled: true,
        allowedWriteModes: ["draft"],
      }),
    ).toThrow("Draft writes require explicit draft opt-in.");

    expect(() =>
      buildBuilderCmsWriteModeJson({
        sourceType: "builder-cms",
        sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
        capabilitiesJson: sourceCapabilitiesForType("builder-cms"),
        metadataJson: baseMetadata,
        liveWritesEnabled: true,
        allowedWriteModes: ["publish"],
      }),
    ).toThrow("Publish writes require explicit publish opt-in.");
  });

  it("disabling clears live write eligibility and mode opt-ins", () => {
    const enabled = buildBuilderCmsWriteModeJson({
      sourceType: "builder-cms",
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      capabilitiesJson: sourceCapabilitiesForType("builder-cms"),
      metadataJson: baseMetadata,
      liveWritesEnabled: true,
      allowedWriteModes: ["autosave"],
    });
    const disabled = buildBuilderCmsWriteModeJson({
      sourceType: "builder-cms",
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      capabilitiesJson: enabled.capabilitiesJson,
      metadataJson: enabled.metadataJson,
      liveWritesEnabled: false,
      allowedWriteModes: ["draft", "publish"],
    });

    expect(
      builderCmsWriteSettingsFromJson({
        capabilitiesJson: disabled.capabilitiesJson,
        metadataJson: disabled.metadataJson,
      }),
    ).toEqual({
      liveWritesEnabled: false,
      allowedWriteModes: [],
      allowDraftWrites: false,
      allowPublishWrites: false,
    });
  });

  it("preserves explicit safe-model enablement across Builder refresh metadata", () => {
    const enabled = buildBuilderCmsWriteModeJson({
      sourceType: "builder-cms",
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      capabilitiesJson: sourceCapabilitiesForType("builder-cms"),
      metadataJson: baseMetadata,
      liveWritesEnabled: true,
      allowedWriteModes: ["autosave"],
    });

    const refreshed = mergeBuilderCmsWriteSettingsIntoJson({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      currentCapabilitiesJson: enabled.capabilitiesJson,
      currentMetadataJson: enabled.metadataJson,
      nextCapabilitiesJson: sourceCapabilitiesForType("builder-cms"),
      nextMetadataJson: JSON.stringify({
        primaryKey: "id",
        titleField: "data.title",
        pushMode: "autosave",
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
});
