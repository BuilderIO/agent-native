import { describe, expect, it } from "vitest";

import { createReplayNodeLabels } from "./session-replay-node-labels";

const text = (id: number, textContent: string) => ({
  type: 3,
  id,
  textContent,
});
const element = (
  id: number,
  tagName: string,
  attributes: Record<string, unknown> = {},
  childNodes: unknown[] = [],
) => ({ type: 2, id, tagName, attributes, childNodes });
const fullSnapshot = (node: unknown) => ({
  type: 2,
  timestamp: 1,
  data: { node },
});

function labelsFor(...roots: unknown[]) {
  const labels = createReplayNodeLabels();
  labels.observe(
    fullSnapshot({ type: 0, id: 1, childNodes: roots }) as Record<
      string,
      unknown
    >,
  );
  return labels;
}

describe("createReplayNodeLabels", () => {
  it("names a control from its text, wherever the text sits inside it", () => {
    const labels = labelsFor(
      element(2, "button", {}, [
        element(3, "span", {}, [element(4, "b", {}, [text(5, " Send  now ")])]),
      ]),
    );

    expect(labels.describe(2)).toBe('button "Send now"');
    expect(labels.describe(4)).toBe('button "Send now"');
  });

  it("prefers a control's attributes to its text", () => {
    const labels = labelsFor(
      element(2, "button", { "aria-label": "Close dialog" }, [text(3, "x")]),
      element(4, "input", { placeholder: "Search decks" }),
    );

    expect(labels.describe(2)).toBe('button "Close dialog"');
    expect(labels.describe(4)).toBe('input "Search decks"');
  });

  it("uses a role before the tag name", () => {
    const labels = labelsFor(
      element(2, "div", { role: "menuitem" }, [text(3, "Rename")]),
    );

    expect(labels.describe(2)).toBe('menuitem "Rename"');
  });

  it("names nodes a later mutation adds", () => {
    const labels = labelsFor(element(2, "div"));
    labels.observe({
      type: 3,
      timestamp: 2,
      data: {
        source: 0,
        adds: [
          { parentId: 2, node: element(3, "button") },
          { parentId: 3, node: text(4, "Retry") },
        ],
      },
    });

    expect(labels.describe(3)).toBe('button "Retry"');
  });

  it("takes no name from masked text, and never from what was typed", () => {
    const labels = labelsFor(
      element(2, "button", {}, [text(3, "*****")]),
      element(4, "input", { value: "my secret" }),
      element(5, "textarea", {}, [text(6, "a private draft")]),
    );

    expect(labels.describe(2)).toBeNull();
    expect(labels.describe(4)).toBeNull();
    expect(labels.describe(5)).toBeNull();
  });

  it("does not name a select after its first option", () => {
    const labels = labelsFor(
      element(2, "select", {}, [
        element(3, "option", {}, [text(4, "Monthly")]),
      ]),
    );

    expect(labels.describe(2)).toBeNull();
  });

  it("ignores script and style text", () => {
    const labels = labelsFor(
      element(2, "div", {}, [element(3, "style", {}, [text(4, ".a{}")])]),
    );

    expect(labels.describe(2)).toBeNull();
    expect(labels.describe(3)).toBeNull();
  });

  it("bounds a long name", () => {
    const labels = labelsFor(
      element(2, "button", {}, [text(3, "x".repeat(200))]),
    );

    expect(labels.describe(2)).toBe(`button "${"x".repeat(80)}…"`);
  });

  describe("errors put on screen", () => {
    const mutation = (data: Record<string, unknown>) => ({
      type: 3,
      timestamp: 2,
      data: { source: 0, adds: [], attributes: [], ...data },
    });
    const add = (parentId: number, node: unknown) => ({ parentId, node });
    const toast = (id: number, type: string) =>
      element(id, "li", { "data-sonner-toast": "", "data-type": type });
    const toastWithText = (type: string) =>
      mutation({
        adds: [
          add(2, toast(3, type)),
          add(3, element(4, "div", { "data-description": "" })),
          add(4, text(5, "File storage is not configured.")),
          add(3, element(6, "div", { "data-title": "" })),
          add(6, text(7, "Upload failed")),
        ],
      });

    it("reads an error toast, title first", () => {
      const labels = labelsFor(element(2, "ol"));

      expect(labels.observe(toastWithText("error"))).toEqual([
        {
          kind: "error-toast",
          label: "Error toast",
          detail: "Upload failed — File storage is not configured.",
        },
      ]);
    });

    it("ignores other toasts until one turns into an error", () => {
      const labels = labelsFor(element(2, "ol"));

      expect(labels.observe(toastWithText("loading"))).toEqual([]);
      expect(
        labels.observe(
          mutation({
            attributes: [{ id: 3, attributes: { "data-type": "error" } }],
          }),
        ),
      ).toEqual([
        {
          kind: "error-toast",
          label: "Error toast",
          detail: "Upload failed — File storage is not configured.",
        },
      ]);
    });

    it("still reports a toast whose text was masked", () => {
      const labels = labelsFor(element(2, "ol"));

      expect(
        labels.observe(
          mutation({
            adds: [
              add(2, toast(3, "error")),
              add(3, element(4, "div")),
              add(4, text(5, "*****")),
            ],
          }),
        ),
      ).toEqual([{ kind: "error-toast", label: "Error toast", detail: null }]);
    });

    it("reads a failed agent run's heading and the message beside it", () => {
      const labels = labelsFor(element(2, "div"));

      expect(
        labels.observe(
          mutation({
            adds: [
              add(2, element(3, "div")),
              add(3, element(4, "p")),
              add(4, text(5, "The provider rejected the request.")),
              add(3, element(6, "div")),
              add(6, text(7, "The agent hit an error")),
              add(2, element(8, "p")),
              add(8, text(9, "Something unrelated")),
            ],
          }),
        ),
      ).toEqual([
        {
          kind: "agent-error",
          label: "The agent hit an error",
          detail: "The provider rejected the request.",
        },
      ]);
    });

    it("reports a failed agent run whose message was masked", () => {
      const labels = labelsFor(element(2, "div"));

      expect(
        labels.observe(
          mutation({
            adds: [
              add(2, element(3, "div")),
              add(3, text(4, "The agent run failed before it finished.")),
              add(2, element(5, "p")),
              add(5, text(6, "*****")),
            ],
          }),
        ),
      ).toEqual([
        {
          kind: "agent-error",
          label: "The agent run failed before it finished.",
          detail: null,
        },
      ]);
    });

    it("does not count an error already on the page at a snapshot", () => {
      const labels = createReplayNodeLabels();

      expect(
        labels.observe(
          fullSnapshot(
            element(2, "div", {}, [text(3, "The agent hit an error")]),
          ) as Record<string, unknown>,
        ),
      ).toEqual([]);
    });
  });

  it("returns null for a node the replay never named or showed", () => {
    const labels = labelsFor(element(2, "div"));

    expect(labels.describe(2)).toBeNull();
    expect(labels.describe(99)).toBeNull();
    expect(labels.describe("2")).toBeNull();
  });
});
