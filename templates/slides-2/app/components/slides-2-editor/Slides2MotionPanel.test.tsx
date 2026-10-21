// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SlideTransition } from "../../../shared/slides-2-transition";
import { readSourceTransition } from "./motion-source";
import { Slides2MotionPanel } from "./Slides2MotionPanel";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

afterEach(cleanup);

const customTransition: SlideTransition = {
  duration: 4000,
  easing: "ease-in",
  enter: {
    keyframes: [{ transform: "scale(.8)" }, { transform: "scale(1)" }],
    duration: 4000,
  },
  throughBackground: true,
  morph: { duration: 900, delay: 30, easing: "ease-in" },
};

const sourceTsx =
  "export const transition = " +
  JSON.stringify(customTransition) +
  ";\n" +
  "export default function Slide() { return <main><h1>Title</h1></main>; }";

function renderPanel(onCommit = vi.fn().mockResolvedValue(true)) {
  render(
    <Slides2MotionPanel
      sourceTsx={sourceTsx}
      transition={customTransition}
      selection={null}
      disabled={false}
      t={((key: string) => key) as never}
      onCommit={onCommit}
    />,
  );
  return onCommit;
}

function selectionFor(source: string, marker: string) {
  const offset = source.indexOf(marker);
  if (offset < 0) throw new Error("selection marker is missing");
  const before = source.slice(0, offset);
  return {
    line: before.split("\n").length,
    column: offset - before.lastIndexOf("\n") - 1,
  };
}

function buildPanel(sourceTsx: string, selectionMarker: string) {
  const selection = selectionFor(sourceTsx, selectionMarker);
  return (
    <Slides2MotionPanel
      sourceTsx={sourceTsx}
      selection={selection}
      disabled={false}
      t={((key: string) => key) as never}
      onCommit={vi.fn().mockResolvedValue(true)}
    />
  );
}

describe("Slides2MotionPanel", () => {
  it("keeps imported durations and custom transition controls available", async () => {
    const onCommit = renderPanel();

    expect(
      screen.getByRole("switch", { name: "slides2Editor.throughBackground" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "slides2Editor.morph" }),
    ).toBeTruthy();
    expect(screen.getByText("slides2Editor.respectReducedMotion")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "editorToolbar.transition_fade",
      }),
    );

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const savedSource = onCommit.mock.calls[0]?.[0];
    expect(readSourceTransition(String(savedSource), "module")?.duration).toBe(
      4000,
    );
  });

  it("renders and selects the inherited easing option without an empty Radix value", async () => {
    const onCommit = renderPanel();
    const easingLabel = screen.getAllByText(
      "slides2Editor.transitionEasing",
    )[0];
    const trigger =
      easingLabel?.parentElement?.querySelector('[role="combobox"]');
    expect(trigger).toBeTruthy();

    fireEvent.keyDown(trigger!, { key: "Enter", code: "Enter" });
    const inheritedOption = await screen.findByRole("option", {
      name: "slides2Editor.defaultEasing",
    });
    fireEvent.click(inheritedOption);

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const saved = readSourceTransition(
      String(onCommit.mock.calls[0]?.[0]),
      "module",
    );
    expect(saved?.easing).toBeUndefined();
    expect(saved?.enter?.keyframes).toEqual(customTransition.enter?.keyframes);
  });

  it("writes a page override when the module default remains inherited", async () => {
    const moduleTransition: SlideTransition = {
      duration: 800,
      enter: { keyframes: [{ opacity: 0 }, { opacity: 1 }] },
    };
    const moduleSource =
      "export const transition = " +
      JSON.stringify(moduleTransition) +
      ";\n" +
      "export default function Slide() { return <main />; }";
    const onCommit = vi.fn().mockResolvedValue(true);

    render(
      <Slides2MotionPanel
        sourceTsx={moduleSource}
        transition={moduleTransition}
        selection={null}
        disabled={false}
        t={((key: string) => key) as never}
        onCommit={onCommit}
      />,
    );

    const scopeLabel = screen.getByText("slides2Editor.motionScope");
    const scopeTrigger =
      scopeLabel.parentElement?.querySelector('[role="combobox"]');
    expect(scopeTrigger).toBeTruthy();
    fireEvent.keyDown(scopeTrigger!, { key: "Enter", code: "Enter" });
    fireEvent.click(
      await screen.findByRole("option", {
        name: "slides2Editor.pageOverride",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "editorToolbar.transition_slide_from_right",
      }),
    );

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const saved = String(onCommit.mock.calls[0]?.[0]);
    expect(readSourceTransition(saved, "module")).toEqual(moduleTransition);
    expect(readSourceTransition(saved, "page")?.duration).toBe(800);
  });

  it("disables morph IDs already used elsewhere on the selected slide", () => {
    const source =
      'import { MorphElement } from "@agent-native/slides-core";\n' +
      'export default function Slide() { return <main><MorphElement id="first"><h1>First</h1></MorphElement><MorphElement id="second"><h2>Second</h2></MorphElement></main>; }';
    const offset = source.indexOf("<h1>");
    const before = source.slice(0, offset);
    const selection = {
      line: before.split("\n").length,
      column: offset - before.lastIndexOf("\n") - 1,
    };

    render(
      <Slides2MotionPanel
        sourceTsx={source}
        selection={selection}
        disabled={false}
        t={((key: string) => key) as never}
        onCommit={vi.fn().mockResolvedValue(true)}
      />,
    );
    const idInput = screen.getByRole("textbox", {
      name: "slides2Editor.morphId",
    });
    const saveButton = screen.getByRole("button", {
      name: "slides2Editor.setMorphId",
    });

    fireEvent.change(idInput, { target: { value: "second" } });
    expect(saveButton).toHaveProperty("disabled", true);
    fireEvent.change(idInput, { target: { value: "unique" } });
    expect(saveButton).toHaveProperty("disabled", false);
  });

  it("disables build reordering beyond the first and last reveal steps", () => {
    const source =
      'import { Step, Steps } from "@agent-native/slides-core";\n' +
      "export default function Slide() { return <main><Steps><Step><h1>First</h1></Step><Step><h2>Second</h2></Step></Steps></main>; }";
    const { rerender } = render(buildPanel(source, "<h1"));
    const earlier = screen.getByRole("button", {
      name: "slides2Editor.moveBuildEarlier",
    });
    const later = screen.getByRole("button", {
      name: "slides2Editor.moveBuildLater",
    });

    expect(earlier).toHaveProperty("disabled", true);
    expect(later).toHaveProperty("disabled", false);

    rerender(buildPanel(source, "<h2"));
    expect(earlier).toHaveProperty("disabled", false);
    expect(later).toHaveProperty("disabled", true);
  });
});
