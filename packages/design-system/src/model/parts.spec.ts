import { describe, expect, it } from "vitest";

import { MODEL_PARTS, modelPartRefs } from "./parts.js";

describe("MODEL_PARTS", () => {
  it("holds version 1 of the vocabulary", () => {
    expect(
      MODEL_PARTS.map(
        ({ group, name, subParts }) =>
          `${group} ${name}${subParts.length > 0 ? `: ${subParts.join(" ")}` : ""}`,
      ),
    ).toEqual([
      "shell app-shell: nav topbar main aside banner overlays skeleton split",
      "shell sidebar: header item section tree rail footer resize-handle slot",
      "shell page-header",
      "shell toolbar",
      "shell filter-bar",
      "shell tabs",
      "shell search",
      "shell command-palette",
      "shell shortcuts-panel",
      "shell settings: nav nav-group nav-item group row content section notice report",
      "overlay menu",
      "overlay popover",
      "overlay picker",
      "overlay select",
      "overlay date-picker",
      "overlay dialog",
      "overlay toast",
      "overlay tooltip",
      "overlay banner",
      "overlay form",
      "overlay file-upload",
      "overlay empty-state",
      "overlay skeleton",
      "content list: section row",
      "content card",
      "content table",
      "content data-grid",
      "content board",
      "content timeline",
      "content calendar-view",
      "content chart",
      "content inspector",
      "content property-list",
      "content activity-feed",
      "content rich-text-editor",
      "agent chat-thread",
      "agent composer",
      "agent agent-panel",
      "primitive button",
      "primitive input",
      "primitive checkbox",
      "primitive switch",
      "primitive badge",
      "primitive avatar",
      "primitive kbd",
    ]);
  });

  it("names each part once", () => {
    const names = MODEL_PARTS.map((part) => part.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("refers to parts and sub-parts, not to catalog components", () => {
    const refs = modelPartRefs();
    expect(refs.has("sidebar.item")).toBe(true);
    expect(refs.has("list.row")).toBe(true);
    expect(refs.has("navigation-menu.link")).toBe(false);
    expect(refs.has("sidebar.brand")).toBe(false);
  });
});
