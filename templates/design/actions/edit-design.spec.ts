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
      errorCode: "creative_context_pack_mismatch",
      statusCode: 409,
    });

    expect(preCheckpointNoWriteError(contractError)).toMatchObject({
      name: "NoWriteError",
      noWrite: true,
      errorCode: "creative_context_pack_mismatch",
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
});
