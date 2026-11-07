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

const toastAdd = (parentId: number, id: number) => ({
  parentId,
  node: element(id, "li", { "data-sonner-toast": "" }),
});

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

  describe("when text changes in place", () => {
    const textChange = (id: number, value: string) => ({
      type: 3,
      timestamp: 2,
      data: { source: 0, texts: [{ id, value }] },
    });

    it("names a control by the text it has now", () => {
      const labels = labelsFor(element(2, "button", {}, [text(3, "Save")]));

      labels.observe(textChange(3, "Saved"));

      expect(labels.describe(2)).toBe('button "Saved"');
    });

    it("keeps a name that came from an attribute", () => {
      const labels = labelsFor(
        element(2, "button", { "aria-label": "Close" }, [text(3, "x")]),
      );

      labels.observe(textChange(3, "y"));

      expect(labels.describe(2)).toBe('button "Close"');
    });

    it("keeps a name that came from other text", () => {
      const labels = labelsFor(
        element(2, "button", {}, [
          element(3, "span", {}, [text(4, "Save")]),
          element(5, "span", {}, [text(6, "3")]),
        ]),
      );

      labels.observe(textChange(6, "4"));

      expect(labels.describe(2)).toBe('button "Save"');
    });

    it("drops a name whose text becomes masked, and takes one that stops", () => {
      const labels = labelsFor(element(2, "button", {}, [text(3, "Save")]));

      labels.observe(textChange(3, "*****"));
      expect(labels.describe(2)).toBeNull();

      labels.observe(textChange(3, "Saved"));
      expect(labels.describe(2)).toBe('button "Saved"');
    });

    it("never takes a name from what was typed", () => {
      const labels = labelsFor(
        element(2, "div", { contenteditable: "true" }, [
          element(3, "button", {}, [text(4, "*****")]),
        ]),
        element(5, "textarea", {}, [text(6, "*****")]),
      );

      labels.observe(textChange(4, "a private note"));
      labels.observe(textChange(6, "a private draft"));

      expect(labels.describe(3)).toBeNull();
      expect(labels.describe(5)).toBeNull();
    });

    it("ignores a text node the replay never showed", () => {
      const labels = labelsFor(element(2, "button"));

      expect(labels.observe(textChange(99, "The agent hit an error"))).toEqual(
        [],
      );
      expect(labels.describe(2)).toBeNull();
    });
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

  it("takes no name from an attribute under the replay mask", () => {
    const labels = labelsFor(
      element(2, "button", { "aria-label": "Invoice for a private client" }),
      element(3, "button", {
        "aria-label": "A private name",
        "data-an-mask": "",
      }),
      element(4, "button", {
        title: "A private title",
        class: "row an-mask",
      }),
      element(5, "section", { "data-an-mask": "" }, [
        element(6, "div", {}, [
          element(7, "button", { "aria-label": "Private under a parent" }),
        ]),
      ]),
      element(8, "button", { class: "an-masked", title: "Not the marker" }),
    );

    expect(labels.describe(2)).toBe('button "Invoice for a private client"');
    expect(labels.describe(3)).toBeNull();
    expect(labels.describe(4)).toBeNull();
    expect(labels.describe(7)).toBeNull();
    expect(labels.describe(8)).toBe('button "Not the marker"');
  });

  it("stops naming a node once a mutation marks it masked", () => {
    const labels = labelsFor(
      element(2, "button", { "aria-label": "Named for now" }),
    );
    expect(labels.describe(2)).toBe('button "Named for now"');

    labels.observe({
      type: 3,
      data: {
        source: 0,
        attributes: [{ id: 2, attributes: { "data-an-mask": "" } }],
      },
    });

    expect(labels.describe(2)).toBeNull();
  });

  it("takes no name from text being typed in a rich-text editor", () => {
    const labels = labelsFor(
      element(2, "div", { role: "button", contenteditable: "true" }, [
        element(3, "p", {}, [
          element(4, "span", {}, [text(5, "a private note")]),
        ]),
      ]),
    );
    labels.observe({
      type: 3,
      timestamp: 2,
      data: {
        source: 0,
        adds: [{ parentId: 4, node: text(6, "more private text") }],
      },
    });

    expect(labels.describe(2)).toBeNull();
    expect(labels.describe(4)).toBeNull();
  });

  it.each([
    ["an empty attribute", ""],
    ["plain text only", "plaintext-only"],
  ])("treats %s as an editor", (_label, contenteditable) => {
    const labels = labelsFor(
      element(2, "button", { contenteditable }, [text(3, "a private note")]),
    );

    expect(labels.describe(2)).toBeNull();
  });

  it("still names a control marked as not editable", () => {
    const labels = labelsFor(
      element(2, "button", { contenteditable: "false" }, [text(3, "Send")]),
    );

    expect(labels.describe(2)).toBe('button "Send"');
  });

  it("follows an element that becomes editable, or stops being", () => {
    const labels = labelsFor(element(2, "button"), element(3, "button"));
    labels.observe({
      type: 3,
      timestamp: 2,
      data: {
        source: 0,
        attributes: [
          { id: 2, attributes: { contenteditable: "true" } },
          { id: 3, attributes: { contenteditable: "true" } },
        ],
      },
    });
    labels.observe({
      type: 3,
      timestamp: 3,
      data: {
        source: 0,
        attributes: [{ id: 3, attributes: { contenteditable: null } }],
        adds: [
          { parentId: 2, node: text(4, "typed") },
          { parentId: 3, node: text(5, "Save") },
        ],
      },
    });

    expect(labels.describe(2)).toBeNull();
    expect(labels.describe(3)).toBe('button "Save"');
  });

  it("treats text as typed when its parent becomes an editor in the same mutation", () => {
    const labels = labelsFor(
      element(2, "button"),
      element(3, "ol"),
      element(4, "div"),
    );
    labels.observe({
      type: 3,
      timestamp: 2,
      data: { source: 0, adds: [toastAdd(3, 5)] },
    });

    const shown = labels.observe({
      type: 3,
      timestamp: 3,
      data: {
        source: 0,
        attributes: [
          { id: 2, attributes: { contenteditable: "true" } },
          { id: 5, attributes: { contenteditable: "true" } },
          { id: 4, attributes: { contenteditable: "true" } },
        ],
        adds: [
          { parentId: 2, node: text(6, "my password") },
          { parentId: 5, node: text(7, "my password") },
          { parentId: 4, node: text(8, "The agent hit an error") },
        ],
      },
    });

    expect(labels.describe(2)).toBeNull();
    expect(labels.describe(5)).toBeNull();
    expect(shown).toEqual([]);
  });

  it("stops at a parent chain that loops, and counts its text as typed", () => {
    const labels = labelsFor(element(2, "div"));

    const shown = labels.observe({
      type: 3,
      timestamp: 2,
      data: {
        source: 0,
        adds: [
          { parentId: 3, node: element(3, "button") },
          { parentId: 3, node: text(4, "my password") },
          { parentId: 6, node: element(5, "button") },
          { parentId: 5, node: element(6, "div") },
          { parentId: 6, node: text(7, "The agent hit an error") },
        ],
      },
    });

    expect(labels.describe(3)).toBeNull();
    expect(labels.describe(5)).toBeNull();
    expect(shown).toEqual([]);
  });

  it("still reads text under a deep, ordinary page", () => {
    let page = element(100, "button", {}, [text(101, "Send")]);
    for (let id = 99; id >= 3; id -= 1) {
      page = element(id, "div", {}, [page]);
    }
    const labels = labelsFor(page);

    expect(labels.describe(100)).toBe('button "Send"');
  });

  it("reads text inside an iframe's document", () => {
    const labels = labelsFor(element(2, "iframe"));
    labels.observe({
      type: 3,
      timestamp: 2,
      data: {
        source: 0,
        adds: [
          {
            parentId: 2,
            node: {
              type: 0,
              id: 3,
              childNodes: [
                element(4, "html", {}, [
                  element(5, "button", {}, [text(6, "Send")]),
                ]),
              ],
            },
          },
        ],
      },
    });

    expect(labels.describe(5)).toBe('button "Send"');
  });

  it("names nothing under an ancestor the replay never showed", () => {
    const labels = labelsFor(element(2, "div"));
    labels.observe({
      type: 3,
      timestamp: 2,
      data: {
        source: 0,
        adds: [
          { parentId: 90, node: element(3, "div") },
          { parentId: 3, node: element(4, "button", {}, [text(5, "Draft")]) },
          {
            parentId: 3,
            node: element(6, "button", { "aria-label": "A private name" }),
          },
        ],
      },
    });

    expect(labels.describe(4)).toBeNull();
    expect(labels.describe(6)).toBeNull();
  });

  it("never reports what was typed as an agent error's message", () => {
    const labels = labelsFor(
      element(2, "div", {}, [
        element(3, "div"),
        element(4, "div", { contenteditable: "true" }),
      ]),
    );

    const shown = labels.observe({
      type: 3,
      timestamp: 2,
      data: {
        source: 0,
        adds: [
          { parentId: 4, node: text(5, "a private note") },
          { parentId: 3, node: text(6, "The agent hit an error") },
        ],
      },
    });

    expect(shown).toEqual([
      { kind: "agent-error", label: "The agent hit an error", detail: null },
    ]);
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

    it("keeps text under an ancestor the replay never showed out of a toast", () => {
      const labels = labelsFor(element(2, "ol"));

      expect(
        labels.observe(
          mutation({
            adds: [
              add(90, toast(3, "error")),
              add(3, text(4, "What someone was typing")),
            ],
          }),
        ),
      ).toEqual([{ kind: "error-toast", label: "Error toast", detail: null }]);
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

    it("reads the text a toast has when it turns into an error", () => {
      const labels = labelsFor(element(2, "ol"));
      labels.observe(
        mutation({
          adds: [
            add(2, toast(3, "loading")),
            add(3, element(4, "div", { "data-title": "" })),
            add(4, text(5, "Saving")),
            add(3, element(6, "div", { "data-description": "" })),
            add(6, text(7, "*****")),
          ],
        }),
      );

      expect(
        labels.observe(
          mutation({
            attributes: [{ id: 3, attributes: { "data-type": "error" } }],
            texts: [
              { id: 5, value: "Upload failed" },
              { id: 7, value: "File storage is not configured." },
            ],
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

    it("reports a failed agent run whose text changed in place", () => {
      const labels = labelsFor(element(2, "div"));
      labels.observe(
        mutation({
          adds: [
            add(2, element(3, "div")),
            add(3, element(4, "div")),
            add(4, text(5, "Working")),
            add(3, element(6, "p")),
            add(6, text(7, "*****")),
          ],
        }),
      );

      expect(
        labels.observe(
          mutation({
            texts: [
              { id: 5, value: "The agent hit an error" },
              { id: 7, value: "The provider rejected the request." },
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

    it("never reports a change to typed text as an agent error", () => {
      const labels = labelsFor(
        element(2, "div", { contenteditable: "true" }, [text(3, "*****")]),
      );

      expect(
        labels.observe(
          mutation({
            texts: [{ id: 3, value: "The agent hit an error" }],
          }),
        ),
      ).toEqual([]);
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
