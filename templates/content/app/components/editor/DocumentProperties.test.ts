// @vitest-environment happy-dom

import type { DocumentPropertyOption } from "@shared/properties";
import { describe, expect, it } from "vitest";

import {
  canCreatePropertyOption,
  createPropertyMetadataUpdateQueue,
  createPropertyOptionUpdateQueue,
  dateInputValueForOffset,
  filesMediaEditorValue,
  filesMediaItems,
  filesMediaKind,
  filesMediaLabel,
  filterDocumentPropertyTypes,
  filterPropertyOptions,
  firstMatchingPropertyOption,
  formatPropertyDateEndInputValue,
  formatPropertyDateInputValue,
  formatPropertyDateTimeInputValue,
  isValidFilesMediaLink,
  mergeFilesMediaItems,
  nextPropertyOption,
  personItems,
  personLabel,
  placeLabel,
  propertyTypeForSourceFieldType,
  relationItems,
  removePropertyOption,
  renamePropertyOption,
  updatePropertyOptionColor,
  updatePropertyOptionDescription,
} from "./DocumentProperties";

const options: DocumentPropertyOption[] = [
  { id: "draft", name: "Draft", color: "gray" },
  { id: "in-review", name: "In review", color: "blue" },
  { id: "published", name: "Published", color: "green" },
];

describe("document property type picker", () => {
  it("filters property types by label or machine name", () => {
    expect(filterDocumentPropertyTypes("date")).toEqual(["date"]);
    expect(filterDocumentPropertyTypes("created")).toEqual([
      "created_time",
      "created_by",
    ]);
    expect(filterDocumentPropertyTypes("edited by")).toEqual([
      "last_edited_by",
    ]);
    expect(filterDocumentPropertyTypes("people")).toEqual(["person"]);
    expect(filterDocumentPropertyTypes("person")).toEqual(["person"]);
    expect(filterDocumentPropertyTypes("location")).toEqual(["place"]);
    expect(filterDocumentPropertyTypes("place")).toEqual(["place"]);
    expect(filterDocumentPropertyTypes("attachment")).toEqual(["files_media"]);
    expect(filterDocumentPropertyTypes("files")).toEqual(["files_media"]);
    expect(filterDocumentPropertyTypes("calculation")).toEqual([]);
    expect(filterDocumentPropertyTypes("formula")).toEqual([]);
    expect(filterDocumentPropertyTypes("database")).toEqual([]);
    expect(filterDocumentPropertyTypes("aggregate")).toEqual([]);
    expect(filterDocumentPropertyTypes("multi select")).toEqual([
      "multi_select",
    ]);
  });

  it("returns all property types for empty queries", () => {
    expect(filterDocumentPropertyTypes("")).toContain("text");
    expect(filterDocumentPropertyTypes("")).toContain("person");
    expect(filterDocumentPropertyTypes("")).toContain("place");
    expect(filterDocumentPropertyTypes("")).toContain("files_media");
    expect(filterDocumentPropertyTypes("")).not.toContain("relation");
    expect(filterDocumentPropertyTypes("")).not.toContain("rollup");
    expect(filterDocumentPropertyTypes("")).not.toContain("formula");
    expect(filterDocumentPropertyTypes("")).toContain("last_edited_time");
    expect(filterDocumentPropertyTypes("")).toContain("last_edited_by");
  });
});

describe("source field type compatibility", () => {
  it("keeps raw list fields conservative for binding compatibility", () => {
    expect(propertyTypeForSourceFieldType("list")).toBe("text");
    expect(propertyTypeForSourceFieldType("array")).toBe("text");
    expect(propertyTypeForSourceFieldType("tags")).toBe("multi_select");
    expect(propertyTypeForSourceFieldType("multi_select")).toBe("multi_select");
  });
});

describe("document relation property display", () => {
  it("normalizes relation values for row links", () => {
    expect(relationItems(["doc-a", "", "doc-b"])).toEqual(["doc-a", "doc-b"]);
    expect(relationItems("doc-a")).toEqual(["doc-a"]);
    expect(relationItems(null)).toEqual([]);
  });
});

describe("document person property display", () => {
  it("keeps person labels explicit", () => {
    expect(personLabel(" Alice Moore ")).toBe("Alice Moore");
    expect(personLabel("alice@example.com")).toBe("Alice");
    expect(personLabel("")).toBe("Empty");
  });

  it("normalizes person selections for chip editing", () => {
    expect(personItems("Alice Moore, alice@example.com\nAlice Moore")).toEqual([
      "Alice Moore",
      "alice@example.com",
    ]);
    expect(personItems([" Alice ", "", "ALICE", "Taylor"])).toEqual([
      "Alice",
      "Taylor",
    ]);
  });
});

describe("document place property display", () => {
  it("keeps place labels explicit", () => {
    expect(placeLabel(" Indianapolis, IN ")).toBe("Indianapolis, IN");
    expect(placeLabel("")).toBe("Empty");
  });
});

describe("document files media property display", () => {
  it("normalizes file media lists for editing and display", () => {
    expect(filesMediaItems([" https://example.com/brief.pdf ", ""])).toEqual([
      "https://example.com/brief.pdf",
    ]);
    expect(filesMediaItems("one.png\ntwo.mov")).toEqual(["one.png", "two.mov"]);
    expect(filesMediaEditorValue(["one.png", "two.mov"])).toBe(
      "one.png\ntwo.mov",
    );
    expect(filesMediaLabel("https://example.com/uploads/brief.pdf")).toBe(
      "brief.pdf",
    );
    expect(filesMediaKind("https://example.com/uploads/brief.pdf")).toBe(
      "Link",
    );
    expect(filesMediaKind("https://example.com/uploads/hero.png")).toBe(
      "Image",
    );
    expect(filesMediaKind("clip.mov")).toBe("Video");
  });

  it("accepts only explicit HTTP(S) links", () => {
    expect(isValidFilesMediaLink(" https://example.com/brief.pdf ")).toBe(true);
    expect(isValidFilesMediaLink("http://example.com/image.png")).toBe(true);
    expect(isValidFilesMediaLink("ftp://example.com/image.png")).toBe(false);
    expect(isValidFilesMediaLink("image.png")).toBe(false);
    expect(isValidFilesMediaLink("not a link")).toBe(false);
  });

  it("merges a valid pending link once for saving", () => {
    const items = ["https://example.com/one.png"];

    expect(
      mergeFilesMediaItems(items, " https://example.com/two.png "),
    ).toEqual(["https://example.com/one.png", "https://example.com/two.png"]);
    expect(mergeFilesMediaItems(items, "HTTPS://EXAMPLE.COM/ONE.PNG")).toBe(
      items,
    );
    expect(mergeFilesMediaItems(items, "file:///tmp/two.png")).toBe(items);
  });
});

describe("document property option picker", () => {
  it("filters options by label, stable id, or usage description", () => {
    const documentedOptions = [
      ...options,
      {
        id: "ready",
        name: "Ready",
        color: "green" as const,
        description: "Use once editorial review is complete.",
      },
    ];
    expect(filterPropertyOptions(options, "pub")).toEqual([options[2]]);
    expect(filterPropertyOptions(options, "review")).toEqual([options[1]]);
    expect(filterPropertyOptions(documentedOptions, "editorial")).toEqual([
      documentedOptions[3],
    ]);
    expect(filterPropertyOptions(options, "")).toEqual(options);
  });

  it("returns the first matching option for keyboard selection", () => {
    expect(firstMatchingPropertyOption(options, "pub")).toBe(options[2]);
    expect(firstMatchingPropertyOption(options, "review")).toBe(options[1]);
    expect(firstMatchingPropertyOption(options, "missing")).toBeNull();
  });

  it("only creates options for non-empty unique names", () => {
    expect(canCreatePropertyOption(options, "")).toBe(false);
    expect(canCreatePropertyOption(options, " Published ")).toBe(false);
    expect(canCreatePropertyOption(options, "Scheduled")).toBe(true);
  });

  it("creates stable unique option ids from names", () => {
    expect(nextPropertyOption("In review", options)).toMatchObject({
      id: "in-review-2",
      name: "In review",
    });
    expect(nextPropertyOption("Needs legal", options)).toMatchObject({
      id: "needs-legal",
      name: "Needs legal",
    });
  });

  it("renames options without changing their stable ids", () => {
    expect(renamePropertyOption(options, "draft", "Idea")).toEqual([
      { id: "draft", name: "Idea", color: "gray" },
      options[1],
      options[2],
    ]);
    expect(renamePropertyOption(options, "draft", "Published")).toBe(options);
    expect(renamePropertyOption(options, "draft", " ")).toBe(options);
  });

  it("updates option colors without changing ids or names", () => {
    expect(updatePropertyOptionColor(options, "published", "purple")).toEqual([
      options[0],
      options[1],
      { id: "published", name: "Published", color: "purple" },
    ]);
  });

  it("updates an option description without changing its stable id", () => {
    expect(
      updatePropertyOptionDescription(options, "draft", "Use for early work."),
    ).toEqual([
      {
        id: "draft",
        name: "Draft",
        color: "gray",
        description: "Use for early work.",
      },
      options[1],
      options[2],
    ]);
  });

  it("serializes a fast rename and description edit without losing either", async () => {
    const persisted: DocumentPropertyOption[][] = [];
    const queue = createPropertyOptionUpdateQueue(options, async (next) => {
      persisted.push(next);
    });

    await Promise.all([
      queue.enqueue((current) =>
        renamePropertyOption(current, "draft", "In progress"),
      ),
      queue.enqueue((current) =>
        updatePropertyOptionDescription(
          current,
          "draft",
          "Use while active work is underway.",
        ),
      ),
    ]);

    expect(persisted).toEqual([
      [
        { id: "draft", name: "In progress", color: "gray" },
        options[1],
        options[2],
      ],
      [
        {
          id: "draft",
          name: "In progress",
          color: "gray",
          description: "Use while active work is underway.",
        },
        options[1],
        options[2],
      ],
    ]);
  });

  it("removes options by stable id", () => {
    expect(removePropertyOption(options, "in-review")).toEqual([
      options[0],
      options[2],
    ]);
    expect(removePropertyOption(options, "missing")).toBe(options);
  });
});

describe("document property metadata persistence", () => {
  it("serializes a fast rename and description edit without restoring the old name", async () => {
    const persisted: Array<{
      name: string;
      description: string;
    }> = [];
    const queue = createPropertyMetadataUpdateQueue(
      {
        name: "Status",
        type: "select",
        description: "",
        visibility: "always_show",
        options: { options },
      },
      async (metadata) => {
        persisted.push({
          name: metadata.name,
          description: metadata.description ?? "",
        });
      },
    );

    await Promise.all([
      queue.enqueue((current) => ({ ...current, name: "Workflow stage" })),
      queue.enqueue((current) => ({
        ...current,
        description: "Tracks where the work is in the editorial workflow.",
      })),
    ]);

    expect(persisted).toEqual([
      { name: "Workflow stage", description: "" },
      {
        name: "Workflow stage",
        description: "Tracks where the work is in the editorial workflow.",
      },
    ]);
  });

  it("keeps option edits when a property metadata save follows them", async () => {
    const persisted: Array<{
      description: string;
      options: DocumentPropertyOption[];
    }> = [];
    const queue = createPropertyMetadataUpdateQueue(
      {
        name: "Status",
        type: "select",
        description: "",
        visibility: "always_show",
        options: { options },
      },
      async (metadata) => {
        persisted.push({
          description: metadata.description ?? "",
          options: metadata.options.options ?? [],
        });
      },
    );

    await Promise.all([
      queue.enqueue((current) => ({
        ...current,
        options: {
          options: renamePropertyOption(
            current.options.options ?? [],
            "draft",
            "In progress",
          ),
        },
      })),
      queue.enqueue((current) => ({
        ...current,
        options: {
          options: updatePropertyOptionDescription(
            current.options.options ?? [],
            "draft",
            "Use while active work is underway.",
          ),
        },
      })),
      queue.enqueue((current) => ({
        ...current,
        description: "Tracks the editorial workflow.",
      })),
    ]);

    expect(persisted[persisted.length - 1]).toEqual({
      description: "Tracks the editorial workflow.",
      options: [
        {
          id: "draft",
          name: "In progress",
          color: "gray",
          description: "Use while active work is underway.",
        },
        options[1],
        options[2],
      ],
    });
  });
});

describe("document date property editor", () => {
  it("normalizes stored date values for native date inputs", () => {
    expect(formatPropertyDateInputValue("2026-05-28")).toBe("2026-05-28");
    expect(formatPropertyDateInputValue("2026-05-28T12:34:00.000Z")).toBe(
      "2026-05-28",
    );
    expect(
      formatPropertyDateInputValue({
        start: "2026-05-28T10:30",
        end: "2026-05-29T16:00",
        includeTime: true,
      }),
    ).toBe("2026-05-28");
    expect(
      formatPropertyDateEndInputValue({
        start: "2026-05-28T10:30",
        end: "2026-05-29T16:00",
        includeTime: true,
      }),
    ).toBe("2026-05-29");
    expect(
      formatPropertyDateTimeInputValue({
        start: "2026-05-28T10:30",
        end: "2026-05-29T16:00",
        includeTime: true,
      }),
    ).toBe("2026-05-28T10:30");
    expect(
      formatPropertyDateTimeInputValue(
        {
          start: "2026-05-28T10:30",
          end: "2026-05-29T16:00",
          includeTime: true,
        },
        "end",
      ),
    ).toBe("2026-05-29T16:00");
    expect(formatPropertyDateInputValue("not a date")).toBe("");
    expect(formatPropertyDateInputValue(null)).toBe("");
  });

  it("creates local YYYY-MM-DD values for date shortcuts", () => {
    expect(dateInputValueForOffset(new Date(2026, 4, 28), 0)).toBe(
      "2026-05-28",
    );
    expect(dateInputValueForOffset(new Date(2026, 4, 28), 1)).toBe(
      "2026-05-29",
    );
  });
});
