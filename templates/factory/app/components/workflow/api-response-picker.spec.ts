import { describe, expect, it } from "vitest";

import type { LiveTest } from "./api-request-test";
import {
  NO_RESPONSE,
  PICKER_MAX_PATHS,
  pickableResponseOf,
  pickerStateOf,
} from "./api-response-picker";
import type { LiveAnswer } from "./node-details/api-request-output";

const plain = { includeStatus: false };

function done(answer: LiveAnswer): LiveTest {
  return { phase: "done", nodeId: "n1", token: 1, answer };
}
const answered = (value: unknown): LiveTest =>
  done({ kind: "answer", value, status: 200, elapsedMs: 40 });

describe("the response the picker reads", () => {
  it("is nothing until a test has run in this window", () => {
    expect(pickableResponseOf({ phase: "idle" })).toEqual(NO_RESPONSE);
  });

  it("follows the test: running, then its answer or its failure", () => {
    expect(
      pickableResponseOf({ phase: "running", nodeId: "n1", token: 1 }),
    ).toEqual({ state: "running" });
    expect(pickableResponseOf(answered([{ id: 1 }]))).toEqual({
      state: "ready",
      value: [{ id: 1 }],
      cut: false,
    });
    expect(
      pickableResponseOf(
        done({
          kind: "failed",
          failure: {
            kind: "not_found",
            code: "provider_not_found",
            status: 404,
            message: "",
          },
          elapsedMs: 30,
        }),
      ),
    ).toEqual({ state: "failed" });
  });

  it("knows an answer the step cut", () => {
    const cut = {
      truncated: true,
      count: 1,
      totalAvailable: 9,
      cuts: [{ path: "value", kept: 1, of: 9 }],
      value: [{ id: 1 }],
    };
    expect(pickableResponseOf(answered(cut))).toMatchObject({
      state: "ready",
      cut: true,
    });
  });
});

describe("whether the picker can be used", () => {
  it("is off, with its reason, until there is an answer to pick from", () => {
    expect(pickerStateOf({ state: "none" }, plain)).toEqual({
      kind: "disabled",
      reason: "needs_test",
    });
    expect(pickerStateOf({ state: "running" }, plain)).toEqual({
      kind: "disabled",
      reason: "running",
    });
    expect(pickerStateOf({ state: "failed" }, plain)).toEqual({
      kind: "disabled",
      reason: "failed",
    });
  });

  it("is off for an answer with no fields", () => {
    expect(
      pickerStateOf({ state: "ready", value: "hello", cut: false }, plain),
    ).toEqual({ kind: "disabled", reason: "no_fields" });
    expect(
      pickerStateOf({ state: "ready", value: [], cut: false }, plain),
    ).toEqual({ kind: "disabled", reason: "no_fields" });
  });

  it("lists the fields of the entries of a paged answer", () => {
    expect(
      pickerStateOf(
        {
          state: "ready",
          value: {
            pagesRead: 2,
            moreAvailable: false,
            nextCursor: null,
            items: [{ id: 1, name: "a" }],
          },
          cut: false,
        },
        plain,
      ),
    ).toMatchObject({ kind: "ready", paths: ["id", "name"] });
  });

  it("lists the fields of a list of records, from the entries' own paths", () => {
    const state = pickerStateOf(
      {
        state: "ready",
        value: [
          { number: 1, title: "A", user: { login: "ada" } },
          { number: 2, title: "B", user: { login: "grace" } },
        ],
        cut: false,
      },
      plain,
    );
    expect(state).toEqual({
      kind: "ready",
      paths: ["number", "title", "user.login"],
      capped: false,
      cut: false,
    });
  });

  it("still lists what a cut answer kept, and says it was cut", () => {
    const state = pickerStateOf(
      {
        state: "ready",
        value: {
          truncated: true,
          count: 2,
          totalAvailable: 40,
          cuts: [{ path: "value", kept: 2, of: 40 }],
          value: [
            { id: 1, name: "a" },
            { id: 2, name: "b" },
          ],
        },
        cut: true,
      },
      plain,
    );
    expect(state).toEqual({
      kind: "ready",
      paths: ["id", "name"],
      capped: false,
      cut: true,
    });
  });

  it("lists the fields of the body when the status and headers come with the answer", () => {
    const report = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: 1, owner: { login: "a" } },
    };
    expect(
      pickerStateOf(
        { state: "ready", value: report, cut: false },
        { includeStatus: true },
      ),
    ).toMatchObject({ kind: "ready", paths: ["id", "owner.login"] });
    expect(
      pickerStateOf({ state: "ready", value: report, cut: false }, plain),
    ).toMatchObject({
      paths: ["status", "headers.content-type", "body.id", "body.owner.login"],
    });
  });

  it("stops at the most paths it lists and says so", () => {
    const wide = Object.fromEntries(
      Array.from({ length: PICKER_MAX_PATHS + 5 }, (_, i) => [`f${i}`, i]),
    );
    const state = pickerStateOf(
      { state: "ready", value: wide, cut: false },
      plain,
    );
    expect(state.kind === "ready" && state.paths).toHaveLength(
      PICKER_MAX_PATHS,
    );
    expect(state.kind === "ready" && state.capped).toBe(true);
  });
});
