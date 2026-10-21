import { describe, expect, it } from "vitest";

import type { SlideTransition } from "../../../shared/slides-2-transition";
import {
  canMoveSourceBuildStep,
  effectiveSourceTransition,
  getBuildSelectionAction,
  getSourceBuildDuration,
  getSourceMorphId,
  isSourceMorphIdUnique,
  moveSourceBuildStep,
  readSourceTransition,
  removeSourcePageTransition,
  setSourceBuildDuration,
  setSourceBuildStep,
  setSourceMorphId,
  setSourceTransition,
  transitionForPreset,
} from "./motion-source";

const slideSource =
  'export default function Slide() { return <main><h1 data-slide-object-id="title">Title</h1></main>; }';

function selectionFor(source: string, marker: string) {
  const offset = source.indexOf(marker);
  if (offset < 0) throw new Error("selection marker is missing");
  const before = source.slice(0, offset);
  return {
    line: before.split("\n").length,
    column: offset - before.lastIndexOf("\n") - 1,
  };
}

describe("source motion edits", () => {
  it("adds a first build group and removes the selected build safely", () => {
    const initialSelection = selectionFor(slideSource, "<h1");
    const added = setSourceBuildStep(slideSource, initialSelection, true);
    expect(added).not.toBeNull();
    expect(added?.sourceTsx).toContain(
      'import { Step, Steps } from "@agent-native/slides-core";',
    );
    expect(added?.sourceTsx).toContain(
      '<Steps><Step><h1 data-slide-object-id="title">Title</h1></Step></Steps>',
    );
    expect(
      getBuildSelectionAction(added?.sourceTsx ?? "", added?.selection ?? null),
    ).toBe("remove");

    const removed = setSourceBuildStep(
      added?.sourceTsx ?? "",
      added?.selection ?? initialSelection,
      false,
    );
    expect(removed?.sourceTsx).not.toContain("<Step>");
    expect(removed?.sourceTsx).not.toContain("<Steps>");
    expect(removed?.sourceTsx).toContain(
      '<h1 data-slide-object-id="title">Title</h1>',
    );
  });

  it("uses aliased step imports and adds a direct child to an existing Steps group", () => {
    const source =
      'import { Step as Reveal, Steps as Build } from "@agent-native/slides-core";\n' +
      "export default function Slide() { return <main><Build><h1>Title</h1></Build></main>; }";
    const selection = selectionFor(source, "<h1");
    const added = setSourceBuildStep(source, selection, true);

    expect(added?.sourceTsx).toBe(
      source.replace(
        "<Build><h1>Title</h1></Build>",
        "<Build><Reveal><h1>Title</h1></Reveal></Build>",
      ),
    );
    expect(
      getBuildSelectionAction(added?.sourceTsx ?? "", added?.selection ?? null),
    ).toBe("remove");
  });

  it("rejects selected Steps groups and parents containing build groups", () => {
    const nested =
      'import { Step, Steps } from "@agent-native/slides-core";\n' +
      "export default function Slide() { return <main><Steps><Step><div><h1>Title</h1></div></Step></Steps></main>; }";
    expect(getBuildSelectionAction(nested, selectionFor(nested, "<main"))).toBe(
      "unsupported",
    );
    expect(
      getBuildSelectionAction(nested, selectionFor(nested, "<Steps")),
    ).toBe("unsupported");
    expect(getBuildSelectionAction(nested, selectionFor(nested, "<h1"))).toBe(
      "remove",
    );
    expect(
      setSourceBuildStep(nested, selectionFor(nested, "<main"), true),
    ).toBeNull();

    const detachedStep =
      'import { Step, Steps } from "@agent-native/slides-core";\n' +
      "export default function Slide() { return <main><div><Step><h1>Title</h1></Step></div></main>; }";
    expect(
      getBuildSelectionAction(detachedStep, selectionFor(detachedStep, "<h1")),
    ).toBe("unsupported");
  });

  it("supports reveal timing and moves a selected build in source reveal order", () => {
    const source =
      'import { Step, Steps } from "@agent-native/slides-core";\n' +
      "export default function Slide() { return <main><Steps><Step><h1>First</h1></Step><Step><h2>Second</h2></Step></Steps></main>; }";
    const selected = selectionFor(source, "<h2");
    const moved = moveSourceBuildStep(source, selected, "earlier");
    expect(moved).not.toBeNull();
    const reorderedSource = moved?.sourceTsx ?? "";
    expect(reorderedSource.indexOf("<Step><h2>Second")).toBeLessThan(
      reorderedSource.indexOf("<Step><h1>First"),
    );
    expect(
      getBuildSelectionAction(moved?.sourceTsx ?? "", moved?.selection ?? null),
    ).toBe("remove");

    const durationSource = setSourceBuildDuration(source, selected, 420);
    expect(durationSource).toContain(
      "<Step duration={420}><h2>Second</h2></Step>",
    );
    expect(
      getSourceBuildDuration(
        durationSource ?? "",
        selectionFor(durationSource ?? "", "<h2"),
      ),
    ).toBe(420);
  });

  it("reports build movement only when a neighboring reveal step exists", () => {
    const source =
      'import { Step, Steps } from "@agent-native/slides-core";\n' +
      "export default function Slide() { return <main><Steps><Step><h1>First</h1></Step><Step><h2>Second</h2></Step></Steps></main>; }";
    const first = selectionFor(source, "<h1");
    const second = selectionFor(source, "<h2");

    expect(canMoveSourceBuildStep(source, first, "earlier")).toBe(false);
    expect(canMoveSourceBuildStep(source, first, "later")).toBe(true);
    expect(canMoveSourceBuildStep(source, second, "earlier")).toBe(true);
    expect(canMoveSourceBuildStep(source, second, "later")).toBe(false);
    expect(canMoveSourceBuildStep(source, null, "earlier")).toBe(false);
  });

  it("adds, reads, updates, removes, and prevents duplicate morph IDs on a slide", () => {
    const source =
      "export default function Slide() { return <main><h1>First</h1><h2>Second</h2></main>; }";
    const first = selectionFor(source, "<h1");
    const added = setSourceMorphId(source, first, "brand-mark");
    expect(added?.sourceTsx).toContain(
      'import { MorphElement } from "@agent-native/slides-core";',
    );
    expect(added?.sourceTsx).toContain(
      '<MorphElement id="brand-mark"><h1>First</h1></MorphElement>',
    );
    expect(
      getSourceMorphId(added?.sourceTsx ?? "", added?.selection ?? null),
    ).toBe("brand-mark");
    expect(
      isSourceMorphIdUnique(
        added?.sourceTsx ?? "",
        selectionFor(added?.sourceTsx ?? "", "<h2"),
        "brand-mark",
      ),
    ).toBe(false);

    const updated = setSourceMorphId(
      added?.sourceTsx ?? "",
      added?.selection ?? first,
      "cover-title",
    );
    expect(updated?.sourceTsx).toContain('id="cover-title"');
    expect(
      getSourceMorphId(updated?.sourceTsx ?? "", updated?.selection ?? null),
    ).toBe("cover-title");
    const removed = setSourceMorphId(
      updated?.sourceTsx ?? "",
      updated?.selection ?? first,
      null,
    );
    expect(removed?.sourceTsx).toContain("<h1>First</h1>");
    expect(removed?.sourceTsx).not.toContain("<MorphElement");
  });

  it("keeps module and page transition precedence independent while editing", () => {
    const source =
      "const moduleMotion = { duration: 4000, easing: 'linear', enter: { keyframes: [{ transform: 'scale(.8)' }, { transform: 'scale(1)' }] } };\n" +
      "export const transition = moduleMotion;\n" +
      "export default function Slide() { return <main />; }\n" +
      "Slide.transition = { duration: 120 };\n";
    expect(readSourceTransition(source, "module")).toMatchObject({
      duration: 4000,
      easing: "linear",
    });
    expect(readSourceTransition(source, "page")).toEqual({ duration: 120 });
    expect(effectiveSourceTransition(source)).toEqual({ duration: 120 });

    const moduleUpdated = setSourceTransition(
      source,
      transitionForPreset("fade", 5000),
      "module",
    );
    expect(readSourceTransition(moduleUpdated ?? "", "module")?.duration).toBe(
      5000,
    );
    expect(readSourceTransition(moduleUpdated ?? "", "page")).toEqual({
      duration: 120,
    });

    const pageUpdated = setSourceTransition(
      moduleUpdated ?? "",
      transitionForPreset("slide", 250),
      "page",
    );
    expect(readSourceTransition(pageUpdated ?? "", "page")?.duration).toBe(250);
    expect(readSourceTransition(pageUpdated ?? "", "module")?.duration).toBe(
      5000,
    );
    const inherited = removeSourcePageTransition(pageUpdated ?? "");
    expect(readSourceTransition(inherited ?? "", "page")).toBeUndefined();
    expect(effectiveSourceTransition(inherited ?? "")?.duration).toBe(5000);
  });

  it("preserves custom transition keyframes while editing timing metadata", () => {
    const custom: SlideTransition = {
      duration: 4000,
      enter: {
        keyframes: [{ transform: "scale(.8)" }, { transform: "scale(1)" }],
      },
      throughBackground: true,
      morph: { duration: 900, delay: 30, easing: "ease-in" },
    };
    const source = setSourceTransition(slideSource, custom, "module");
    const saved = setSourceTransition(
      source ?? "",
      { ...custom, duration: 6000 },
      "module",
    );
    expect(readSourceTransition(saved ?? "", "module")).toEqual({
      ...custom,
      duration: 6000,
    });
    expect(saved).toContain('transform":"scale(.8)');
    expect(saved).toContain('"throughBackground":true');
    expect(saved).toContain(
      '"morph":{"duration":900,"delay":30,"easing":"ease-in"}',
    );
  });

  it("writes page-only overrides and module defaults as static source metadata", () => {
    const moduleSource = setSourceTransition(
      "export default function Slide() { return <main />; }",
      transitionForPreset("fade", 600),
      "module",
    );
    expect(moduleSource).toContain(
      'export const transition = {"duration":600,"easing":"cubic-bezier(0.22, 1, 0.36, 1)","enter":{"keyframes":[{"opacity":0},{"opacity":1}],"duration":600},"exit":{"keyframes":[{"opacity":1},{"opacity":0}],"duration":600}};',
    );

    const pageSource = setSourceTransition(
      "export default function Slide() { return <main />; }",
      transitionForPreset("slide", 500),
      "page",
    );
    expect(pageSource).toContain("Slide.transition = {");
    expect(readSourceTransition(pageSource ?? "", "page")?.duration).toBe(500);
    expect(readSourceTransition(pageSource ?? "", "module")).toBeUndefined();
  });
});
