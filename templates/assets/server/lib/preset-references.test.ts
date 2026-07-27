import { describe, expect, it } from "vitest";

import {
  normalizePresetReferences,
  PRESET_REFERENCE_SUBJECT_IMAGES_ERROR,
  PRESET_REFERENCE_TOTAL_IMAGES_ERROR,
  resolvePresetReferenceFills,
} from "./preset-references.js";

describe("preset reference board", () => {
  it("normalizes entries, clamps images, dedupes ids, and enforces caps", () => {
    const entries = normalizePresetReferences([
      null,
      { id: "Bad ID", label: "Bad", role: "subject", assetIds: ["x"] },
      {
        id: "steve",
        label: " Steve ",
        role: "subject",
        description: " Usual host ",
        assetIds: ["a", "b", "b", "c", "d", "e"],
        variable: 1,
        required: true,
      },
      {
        id: "steve",
        label: "Duplicate",
        role: "style",
        assetIds: ["ignored"],
      },
      {
        id: "guest",
        label: "Guest",
        role: "product",
        assetIds: [],
        variable: true,
        required: true,
      },
      {
        id: "style",
        label: "Style",
        role: "style",
        assetIds: ["e", 7, "f", "g", "h"],
      },
    ]);

    expect(entries.map((entry) => entry.id)).toEqual([
      "steve",
      "guest",
      "style",
    ]);
    expect(entries[0]).toMatchObject({
      id: "steve",
      label: "Steve",
      description: "Usual host",
      assetIds: ["a", "b", "c", "d"],
      variable: true,
      required: true,
    });
  });

  it("caps normalized entries at six and drops trailing entries over subject cap", () => {
    const entries = normalizePresetReferences(
      Array.from({ length: 8 }, (_, index) => ({
        id: `subject-${index + 1}`,
        label: `Subject ${index + 1}`,
        role: "subject",
        assetIds: [`asset-${index + 1}`],
        variable: false,
        required: false,
      })),
    );

    expect(entries).toHaveLength(4);
    expect(entries.map((entry) => entry.id)).toEqual([
      "subject-1",
      "subject-2",
      "subject-3",
      "subject-4",
    ]);
  });

  it("resolves fills with replace semantics and declaration order", () => {
    const entries = normalizePresetReferences([
      {
        id: "steve",
        label: "Steve",
        role: "subject",
        assetIds: ["old", "keep"],
        variable: true,
        required: true,
      },
      {
        id: "style",
        label: "Style",
        role: "style",
        assetIds: ["style-1"],
        variable: false,
        required: false,
      },
      {
        id: "empty",
        label: "Empty",
        role: "product",
        assetIds: [],
        variable: true,
        required: false,
      },
    ]);

    expect(
      resolvePresetReferenceFills({
        entries,
        presetTitle: "Launch",
        fills: [{ referenceId: "steve", assetIds: ["new", "new", "second"] }],
      }),
    ).toEqual([
      {
        entry: entries[0],
        assetIds: ["new", "second"],
        filled: true,
      },
      {
        entry: entries[1],
        assetIds: ["style-1"],
        filled: false,
      },
    ]);
  });

  it("throws for unknown entries, fixed fills, over-limit fills, and required empty entries", () => {
    const entries = normalizePresetReferences([
      {
        id: "fixed",
        label: "Fixed",
        role: "style",
        assetIds: ["a"],
        variable: false,
        required: false,
      },
      {
        id: "guest",
        label: "Guest speaker",
        role: "subject",
        assetIds: [],
        variable: true,
        required: true,
      },
    ]);

    expect(() =>
      resolvePresetReferenceFills({
        entries,
        presetTitle: "Launch",
        fills: [{ referenceId: "missing", assetIds: ["x"] }],
      }),
    ).toThrow(
      'Unknown reference entry "missing" for preset "Launch". Available entries: fixed, guest.',
    );
    expect(() =>
      resolvePresetReferenceFills({
        entries,
        presetTitle: "Launch",
        fills: [{ referenceId: "fixed", assetIds: ["x"] }],
      }),
    ).toThrow(
      'Reference entry "fixed" is fixed by the preset designer. Edit the preset to change it, or mark it as variable.',
    );
    expect(() =>
      resolvePresetReferenceFills({
        entries,
        presetTitle: "Launch",
        fills: [
          {
            referenceId: "guest",
            assetIds: ["a", "b", "c", "d", "e"],
          },
        ],
      }),
    ).toThrow('Reference entry "guest" accepts at most 4 images; got 5.');
    expect(() =>
      resolvePresetReferenceFills({
        entries,
        presetTitle: "Launch",
      }),
    ).toThrow(
      'Preset "Launch" requires image(s) for reference entry "Guest speaker" (guest). Pass them via presetReferenceFills (up to 4).',
    );
  });

  it("enforces runtime total and subject image caps", () => {
    const totalEntries = normalizePresetReferences([
      {
        id: "subject",
        label: "Subject",
        role: "subject",
        assetIds: ["a", "b", "c", "d"],
        variable: false,
        required: false,
      },
      {
        id: "style",
        label: "Style",
        role: "style",
        assetIds: ["e", "f", "g", "h"],
        variable: false,
        required: false,
      },
      {
        id: "extra",
        label: "Extra",
        role: "product",
        assetIds: [],
        variable: true,
        required: false,
      },
    ]);

    expect(() =>
      resolvePresetReferenceFills({
        entries: totalEntries,
        presetTitle: "Launch",
        fills: [{ referenceId: "extra", assetIds: ["i"] }],
      }),
    ).toThrow(PRESET_REFERENCE_TOTAL_IMAGES_ERROR);

    const subjectEntries = normalizePresetReferences([
      {
        id: "one",
        label: "One",
        role: "subject",
        assetIds: ["a", "b"],
        variable: false,
        required: false,
      },
      {
        id: "two",
        label: "Two",
        role: "subject",
        assetIds: ["c", "d"],
        variable: true,
        required: false,
      },
    ]);

    expect(() =>
      resolvePresetReferenceFills({
        entries: subjectEntries,
        presetTitle: "Launch",
        fills: [{ referenceId: "two", assetIds: ["c", "d", "e"] }],
      }),
    ).toThrow(PRESET_REFERENCE_SUBJECT_IMAGES_ERROR);
  });
});
