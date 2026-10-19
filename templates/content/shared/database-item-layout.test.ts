import { describe, expect, it } from "vitest";

import type { ContentDatabaseItemLayout } from "./api";
import {
  contentDatabaseItemLayoutField,
  contentDatabaseItemLayoutPresets,
  contentDatabaseItemLayoutReferenceErrors,
  itemLayoutLine2Candidates,
  matchingContentDatabaseItemLayoutPreset,
  normalizeContentDatabaseItemLayout,
  pruneContentDatabaseItemLayout,
  resolveContentDatabaseItemLayout,
  startingContentDatabaseItemLayout,
  withSavedContentDatabaseItemLayout,
} from "./database-item-layout";
import type { DocumentPropertyType } from "./properties";

function property(
  id: string,
  type: DocumentPropertyType,
  options: Record<string, unknown> = {},
) {
  return { definition: { id, type, options } };
}

const done = property("done", "checkbox");
const pitch = property("pitch", "text");
const body = property("body", "blocks", { blocks: { primary: true } });
const notes = property("notes", "blocks", { blocks: { primary: false } });
const stage = property("stage", "status");
const due = property("due", "date");
const owner = property("owner", "person");
const tags = property("tags", "multi_select");
const all = [done, pitch, body, notes, stage, due, owner, tags];

describe("normalizeContentDatabaseItemLayout", () => {
  it("keeps the default rows when nothing is saved", () => {
    expect(normalizeContentDatabaseItemLayout(undefined)).toBeNull();
    expect(normalizeContentDatabaseItemLayout(null)).toBeNull();
    expect(normalizeContentDatabaseItemLayout([])).toBeNull();
  });

  it("fills missing slots and drops values it cannot use", () => {
    expect(
      normalizeContentDatabaseItemLayout({
        leading: { kind: "sparkle", propertyId: "done" },
        titleWeight: "heavy",
        line2: { propertyId: "  ", lines: 7 },
        line3: ["due", "due", 4, " owner "],
        trailing: "tags",
      }),
    ).toEqual({
      leading: { kind: "page_icon", propertyId: null },
      titleWeight: "medium",
      line2: { propertyId: null, lines: 1 },
      line3: ["due", "owner"],
      trailing: [],
    });
  });

  it("caps line 3 and the end slot at six properties", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(
      normalizeContentDatabaseItemLayout({ line3: ids, trailing: ids }),
    ).toMatchObject({
      line3: ids.slice(0, 6),
      trailing: ids.slice(0, 6),
    });
  });
});

describe("resolveContentDatabaseItemLayout", () => {
  it("matches property IDs and skips ones that no longer fit", () => {
    const resolved = resolveContentDatabaseItemLayout(
      {
        leading: { kind: "checkbox", propertyId: "done" },
        titleWeight: "bold",
        line2: { propertyId: "notes", lines: 2 },
        line3: ["due", "deleted", "notes"],
        trailing: ["owner"],
      },
      all,
    );
    expect(resolved.leading).toEqual({ kind: "checkbox", property: done });
    expect(resolved.line2).toEqual({ property: notes, lines: 2 });
    expect(resolved.line3).toEqual([due]);
    expect(resolved.trailing).toEqual([owner]);
  });

  it("falls back to the page icon when the checkbox or status property is gone", () => {
    const layout: ContentDatabaseItemLayout = {
      leading: { kind: "status", propertyId: "deleted" },
      titleWeight: "regular",
      line2: { propertyId: "due", lines: 1 },
      line3: [],
      trailing: [],
    };
    const resolved = resolveContentDatabaseItemLayout(layout, all);
    expect(resolved.leading).toEqual({ kind: "page_icon", property: null });
    expect(resolved.line2.property).toBeNull();
  });

  it("uses the first property of the right type when none is named", () => {
    expect(
      resolveContentDatabaseItemLayout(
        {
          leading: { kind: "status", propertyId: null },
          titleWeight: "medium",
          line2: { propertyId: null, lines: 1 },
          line3: [],
          trailing: [],
        },
        all,
      ).leading,
    ).toEqual({ kind: "status", property: stage });
  });
});

describe("item layout candidates", () => {
  it("offers text, URL, and non-body Blocks properties for line 2", () => {
    expect(
      itemLayoutLine2Candidates([...all, property("site", "url")]),
    ).toEqual([pitch, notes, property("site", "url")]);
  });
});

describe("always-hidden properties", () => {
  const secret = {
    definition: { ...pitch.definition, visibility: "always_hide" as const },
  };
  const withSecret = [done, secret, due];
  const layout: ContentDatabaseItemLayout = {
    leading: { kind: "checkbox", propertyId: "done" },
    titleWeight: "bold",
    line2: { propertyId: "pitch", lines: 2 },
    line3: ["pitch", "due"],
    trailing: [],
  };

  it("are never offered, shown, or accepted in a slot", () => {
    expect(itemLayoutLine2Candidates(withSecret)).toEqual([]);
    const resolved = resolveContentDatabaseItemLayout(layout, withSecret);
    expect(resolved.line2.property).toBeNull();
    expect(resolved.line3).toEqual([due]);
    expect(
      contentDatabaseItemLayoutReferenceErrors(layout, withSecret),
    ).toHaveLength(2);
    expect(
      contentDatabaseItemLayoutPresets(withSecret).find(
        (preset) => preset.id === "checklist",
      )?.layout?.line2.propertyId,
    ).toBeNull();
  });

  it("are dropped from a saved layout along with deleted properties", () => {
    expect(
      pruneContentDatabaseItemLayout(
        { ...layout, leading: { kind: "status", propertyId: "deleted" } },
        withSecret,
      ),
    ).toEqual({
      leading: { kind: "page_icon", propertyId: null },
      titleWeight: "bold",
      line2: { propertyId: null, lines: 2 },
      line3: ["due"],
      trailing: [],
    });
    expect(pruneContentDatabaseItemLayout(layout, all)).toEqual(layout);
  });
});

describe("contentDatabaseItemLayoutReferenceErrors", () => {
  it("accepts a layout that only references usable properties", () => {
    expect(
      contentDatabaseItemLayoutReferenceErrors(
        {
          leading: { kind: "checkbox", propertyId: "done" },
          titleWeight: "bold",
          line2: { propertyId: "pitch", lines: 2 },
          line3: ["due"],
          trailing: ["tags"],
        },
        all,
      ),
    ).toEqual([]);
  });

  it("names each bad reference", () => {
    expect(
      contentDatabaseItemLayoutReferenceErrors(
        {
          leading: { kind: "checkbox", propertyId: "stage" },
          titleWeight: "bold",
          line2: { propertyId: "body", lines: 2 },
          line3: ["missing"],
          trailing: ["notes"],
        },
        all,
      ),
    ).toEqual([
      "leading.propertyId must reference a checkbox property for a checkbox leading slot.",
      "line2.propertyId must reference a text, URL, or non-body Blocks property.",
      'line3 references unavailable property "missing".',
      'trailing cannot show the Blocks property "notes".',
    ]);
  });

  it("rejects a checkbox slot when the collection has no checkbox", () => {
    expect(
      contentDatabaseItemLayoutReferenceErrors(
        {
          leading: { kind: "checkbox", propertyId: null },
          titleWeight: "bold",
          line2: { propertyId: null, lines: 1 },
          line3: [],
          trailing: [],
        },
        [pitch],
      ),
    ).toEqual(["A checkbox leading slot needs a checkbox property."]);
  });
});

describe("presets", () => {
  it("builds each preset from the collection's properties", () => {
    const presets = contentDatabaseItemLayoutPresets(all);
    expect(presets.map((preset) => preset.id)).toEqual([
      "default",
      "checklist",
      "reminders",
      "tracker",
      "digest",
    ]);
    expect(presets[1]).toEqual({
      id: "checklist",
      missingPropertyType: null,
      layout: {
        leading: { kind: "checkbox", propertyId: "done" },
        titleWeight: "bold",
        line2: { propertyId: "pitch", lines: 2 },
        line3: [],
        trailing: [],
      },
    });
    expect(presets[3].layout).toMatchObject({
      leading: { kind: "status", propertyId: "stage" },
      trailing: ["tags", "owner", "due"],
    });
  });

  it("marks presets the collection cannot support", () => {
    const presets = contentDatabaseItemLayoutPresets([pitch]);
    expect(
      Object.fromEntries(
        presets.map((preset) => [preset.id, preset.missingPropertyType]),
      ),
    ).toEqual({
      default: null,
      checklist: "checkbox",
      reminders: "checkbox",
      tracker: "status",
      digest: null,
    });
  });

  it("recognizes the preset a layout matches", () => {
    const checklist = contentDatabaseItemLayoutPresets(all)[1].layout;
    expect(matchingContentDatabaseItemLayoutPreset(null, all)).toBe("default");
    expect(matchingContentDatabaseItemLayoutPreset(checklist, all)).toBe(
      "checklist",
    );
    expect(
      matchingContentDatabaseItemLayoutPreset(
        { ...checklist!, titleWeight: "regular" },
        all,
      ),
    ).toBeNull();
  });
});

describe("startingContentDatabaseItemLayout", () => {
  it("matches the default rows: page icon, title, first four properties", () => {
    expect(startingContentDatabaseItemLayout(all)).toEqual({
      leading: { kind: "page_icon", propertyId: null },
      titleWeight: "medium",
      line2: { propertyId: null, lines: 1 },
      line3: [],
      trailing: ["done", "pitch", "stage", "due"],
    });
  });
});

describe("saving item layouts", () => {
  const layout = startingContentDatabaseItemLayout(all);

  it("keeps an explicit reset and leaves out a missing or unreadable layout", () => {
    expect(contentDatabaseItemLayoutField(null)).toEqual({ itemLayout: null });
    expect(contentDatabaseItemLayoutField(undefined)).toEqual({});
    expect(contentDatabaseItemLayoutField("checklist")).toEqual({});
    expect(contentDatabaseItemLayoutField(layout)).toEqual({
      itemLayout: layout,
    });
  });

  it("carries the saved layout into a save that left it out", () => {
    const savedViews = [{ id: "ideas", itemLayout: layout }];
    expect(
      withSavedContentDatabaseItemLayout({ id: "ideas" }, savedViews),
    ).toEqual({ id: "ideas", itemLayout: layout });
    expect(
      withSavedContentDatabaseItemLayout(
        { id: "ideas", itemLayout: null },
        savedViews,
      ),
    ).toEqual({ id: "ideas", itemLayout: null });
    expect(
      withSavedContentDatabaseItemLayout({ id: "other" }, savedViews),
    ).toEqual({ id: "other" });
  });
});
