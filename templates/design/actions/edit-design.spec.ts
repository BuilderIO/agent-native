import { readFileSync } from "node:fs";

import { ActionContractError } from "@agent-native/core/action";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/action")>();
  return {
    ...actual,
    NoWriteError: class NoWriteError extends actual.ActionContractError {
      readonly noWrite = true;

      constructor(
        message: string,
        options: { errorCode?: string; statusCode?: number } = {},
      ) {
        super(message, {
          errorCode: options.errorCode ?? "action_failed",
          statusCode: options.statusCode ?? 400,
        });
        this.name = "NoWriteError";
      }
    },
  };
});

import action, {
  applySearchReplaceEdits,
  preCheckpointNoWriteError,
} from "./edit-design.js";

describe("pre-checkpoint Design edit failures", () => {
  it("keeps unexpected failures distinguishable as verified no-write errors", () => {
    expect(
      preCheckpointNoWriteError(new Error("invalid edit value")),
    ).toMatchObject({
      name: "NoWriteError",
      noWrite: true,
      errorCode: "action_failed",
      statusCode: 400,
      message: "invalid edit value",
    });
  });

  it("preserves an existing contract error code when adding no-write status", () => {
    const contractError = new ActionContractError("invalid context", {
      errorCode: "custom_contract_error",
      statusCode: 409,
    });

    expect(preCheckpointNoWriteError(contractError)).toMatchObject({
      name: "NoWriteError",
      noWrite: true,
      errorCode: "custom_contract_error",
      statusCode: 409,
      message: "invalid context",
    });
  });
});

describe("edit-design action schema", () => {
  it("keeps variant replacement guidance compact", () => {
    const source = readFileSync("actions/edit-design.ts", "utf8");

    expect(source).toContain("complete but compact");
    expect(source).toContain("primary workflow");
    expect(source).not.toContain("full chosen direction");
    expect(source).toContain("oversized payload");
  });

  it("accepts the legacy search/replace shape", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        filename: "index.html",
        edits: [{ search: "<h1>Hello</h1>", replace: "<h1>Hola</h1>" }],
      }).success,
    ).toBe(true);
  });

  it("accepts replace-file mode for broad copy-only edits", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        filename: "index.html",
        mode: "replace-file",
        replacementContent:
          "<!DOCTYPE html><html><body><h1>Hola</h1></body></html>",
      }).success,
    ).toBe(true);
  });

  it("accepts replace-file mode targeted by fileId", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        fileId: "file_variant_123",
        mode: "replace-file",
        replacementContent:
          "<!DOCTYPE html><html><body><h1>Chosen direction</h1></body></html>",
      }).success,
    ).toBe(true);
  });

  it("infers replace-file mode when replacementContent is provided", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        filename: "index.html",
        replacementContent:
          "<!DOCTYPE html><html><body><h1>Hola</h1></body></html>",
      }).success,
    ).toBe(true);
  });

  it("rejects calls without an edit operation", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        filename: "index.html",
      }).success,
    ).toBe(false);
  });

  it("rejects mixing search/replace edits with full-file replacement", () => {
    expect(
      action.schema.safeParse({
        designId: "design_123",
        filename: "index.html",
        edits: [{ search: "Hello", replace: "Hola" }],
        replacementContent:
          "<!DOCTYPE html><html><body><h1>Hola</h1></body></html>",
      }).success,
    ).toBe(false);
  });

  it("matches search/replace edits when only stable node ids differ", () => {
    const current = `<main><button data-agent-native-node-id="live-node">Buy</button></main>`;
    const { content, applied } = applySearchReplaceEdits(current, [
      {
        search: `<button data-agent-native-node-id="snapshot-node">Buy</button>`,
        replace: `<button>Start</button>`,
      },
    ]);

    expect(applied).toBe(1);
    expect(content).toBe(`<main><button>Start</button></main>`);
  });

  it("rejects whitespace-variant duplicates after stripping stable ids", () => {
    const content =
      '<p  data-agent-native-node-id="one" >One</p><p data-agent-native-node-id="two" >One</p>';
    const search = '<p data-agent-native-node-id="old" >One</p>';
    expect(() =>
      applySearchReplaceEdits(content, [{ search, replace: "X" }]),
    ).toThrow(/matched .* places/);
  });

  it("words a stable-id boundary rejection so the review agent reads it as ambiguous", () => {
    const content = '<p data-agent-native-node-id="live" class="old">Hi</p>';
    const search = ' data-agent-native-node-id="stale" class="old"';
    expect(() =>
      applySearchReplaceEdits(content, [{ search, replace: ' class="new"' }]),
    ).toThrow(/matched .* places/);
  });

  it("rejects a whitespace-only stable-id fallback match", () => {
    const content =
      '<main><p data-agent-native-node-id="live"  class="item">Hi</p><aside>Keep</aside></main>';
    const search = '<p data-agent-native-node-id="old" class="item">Hi</p>';
    expect(() =>
      applySearchReplaceEdits(content, [{ search, replace: "<p>Updated</p>" }]),
    ).toThrow(/search text was not found/);
  });

  it("matches a unique whitespace-insensitive edit", () => {
    const { content, applied } = applySearchReplaceEdits(
      `<div>\n  <span>label</span>\n</div>`,
      [
        {
          search: `<div> <span>label</span> </div>`,
          replace: `<div><b>label</b></div>`,
        },
      ],
    );

    expect(applied).toBe(1);
    expect(content).toBe(`<div><b>label</b></div>`);
  });

  it("preserves unexpected edit failures instead of labeling them conflicts", () => {
    expect(() =>
      applySearchReplaceEdits("<p>hello</p>", [
        { search: "hello", replace: null } as never,
      ]),
    ).toThrow('"replace" must be a string');
  });

  it("returns a typed no-write conflict for ambiguous whitespace-insensitive matches", () => {
    let error: unknown;
    try {
      applySearchReplaceEdits(
        `<div><span>\n  label\n</span></div><section><span> \tlabel\t </span></section>`,
        [
          {
            search: `<span> label </span>`,
            replace: `<b>label</b>`,
          },
        ],
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      name: "NoWriteError",
      noWrite: true,
      errorCode: "design_edit_conflict",
      statusCode: 409,
    });
    expect(error).toHaveProperty("message", expect.stringContaining("matched"));
  });

  it("names the earlier edit in the batch that changed a later edit's search text", () => {
    const css = `:root{--color-ink:#20382e;--color-muted:#65746a;}`;
    let error: unknown;
    try {
      applySearchReplaceEdits(css, [
        { search: "--color-muted:#65746a;", replace: "--color-muted:#58685d;" },
        {
          search: ":root{--color-ink:#20382e;--color-muted:#65746a;",
          replace: ":root{--color-ink:#111;--color-muted:#65746a;",
        },
      ]);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      name: "NoWriteError",
      errorCode: "design_edit_conflict",
      message: expect.stringContaining(
        "Edit 2: its search text is in the file you read, but edit 1 earlier in this batch already changed that text.",
      ),
    });
  });

  it("points at the line when the search has \\n where the file has a real line break", () => {
    let error: unknown;
    try {
      applySearchReplaceEdits(
        `<main></main>\n<script type="module">\nimport * as THREE from 'three';\n</script>`,
        [
          {
            search: `<script type="module">\\nimport * as THREE from 'three';`,
            replace: `<script>\\nwindow.fallback=true;`,
          },
        ],
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      name: "NoWriteError",
      errorCode: "design_edit_conflict",
      message: expect.stringContaining(
        "backslash escapes such as \\n where the file has real line breaks, tabs, or quotes (line 2)",
      ),
    });
  });
});
