import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { COMMENT_AI_MUTATIONS } from "../app/hooks/content-action-refresh.js";

const names = readdirSync(new URL(".", import.meta.url))
  .filter(
    (file) =>
      file.includes("comment-ai") &&
      file.endsWith(".ts") &&
      !/\.(test|spec)\.ts$/.test(file),
  )
  .map((file) => file.slice(0, -".ts".length));

const actions = Object.fromEntries(
  await Promise.all(
    names.map(async (name) => {
      const loaded = (await import(`./${name}.ts`)) as {
        default: {
          readOnly?: boolean;
          changeResource?: (input: never, result: never) => unknown;
        };
      };
      return [name, loaded.default] as const;
    }),
  ),
);
const writes = names.filter((name) => actions[name]?.readOnly !== true);

function named(name: string, input: unknown, result?: unknown) {
  return actions[name]?.changeResource?.(input as never, result as never);
}

const page = { resourceType: "document", resourceId: "doc-1" };

describe("comment AI writes", () => {
  it("are all ones an open page refreshes on", () => {
    expect(writes.length).toBeGreaterThan(0);
    expect(new Set(writes)).toEqual(COMMENT_AI_MUTATIONS);
  });

  it.each(writes)("%s names the page of the operation it returns", (name) => {
    expect(named(name, { requestId: "op-1" }, { documentId: "doc-1" })).toEqual(
      page,
    );
    expect(
      named(name, {}, { request: { documentId: "doc-1" }, pendingSession: {} }),
    ).toEqual(page);
  });

  it.each(writes)("%s names no page for a call with no result", (name) => {
    expect(named(name, { requestId: "op-1" }, undefined)).toBeNull();
  });

  it("start-comment-ai-request names the page it was asked on", () => {
    expect(
      named("start-comment-ai-request", { documentId: "doc-1" }, undefined),
    ).toEqual(page);
  });
});
