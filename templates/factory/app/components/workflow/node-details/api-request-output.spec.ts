import { describe, expect, it } from "vitest";

import { STANDALONE_TEST_ITEM_ID } from "@/lib/workflow-editor";

import { boundOutput } from "../../../../server/workflow-host/provider-request.js";
import type {
  ItemJourneyData,
  JourneyEvent,
  JourneyStep,
} from "../items/read-types";
import {
  cutsOf,
  failureOf,
  isCutByStep,
  liveAnswerOf,
  listOf,
  readRecordedAnswer,
  standaloneResultOf,
} from "./api-request-output";
import { rawTableOf, schemaOfValue, textOf } from "./node-data-model";

function event(over: Partial<JourneyEvent>): JourneyEvent {
  return {
    id: "e1",
    runId: "run1",
    at: "2026-10-30T10:00:00.000Z",
    kind: "output",
    mode: "test",
    nodeId: "n1",
    nodeName: "n1",
    port: null,
    summary: "",
    summaryTruncated: false,
    receiptKey: null,
    threadId: null,
    outcome: null,
    code: null,
    ...over,
  };
}

function step(over: Partial<JourneyStep>): JourneyStep {
  return {
    runId: "run1",
    nodeId: "n1",
    nodeName: "n1",
    status: "succeeded",
    mode: "test",
    startedAt: "2026-10-30T10:00:00.000Z",
    finishedAt: "2026-10-30T10:00:01.000Z",
    ports: [],
    portIdsTruncated: false,
    error: null,
    receiptKeys: [],
    agentThreadId: null,
    ...over,
  };
}

function journey(
  events: JourneyEvent[],
  steps: JourneyStep[] = [],
): ItemJourneyData {
  return {
    workflow: { id: "w1", name: "Workflow", version: 1 },
    item: {
      id: STANDALONE_TEST_ITEM_ID,
      inbox: false,
      title: null,
      source: null,
      sourceUrl: null,
      status: null,
    },
    state: null,
    events,
    eventsHasMore: false,
    olderCursor: null,
    steps,
    path: [],
    receipts: [],
    receiptsTruncated: false,
  };
}

describe("failureOf", () => {
  it("words a provider failure by the typed code the engine appended to its message", () => {
    const cases: [string, string, string, number | null][] = [
      [
        "lookup_failed",
        "github could not find what github.apiRequest asked for. (provider_not_found)",
        "not_found",
        null,
      ],
      [
        "credential_missing",
        "github refused the connected credential for github.apiRequest (HTTP 403). Connect github in Dispatch. (provider_access_denied)",
        "access_denied",
        403,
      ],
      [
        "lookup_failed",
        "github is rate limiting this workspace while running github.apiRequest. (provider_rate_limited)",
        "rate_limited",
        null,
      ],
      [
        "lookup_failed",
        "github failed while running github.apiRequest (HTTP 502). (provider_unavailable)",
        "provider_problem",
        502,
      ],
      [
        "lookup_failed",
        "github rejected github.apiRequest (HTTP 422). (provider_rejected)",
        "rejected",
        422,
      ],
    ];
    for (const [stepCode, message, kind, status] of cases) {
      const failure = failureOf(stepCode, message);
      expect(failure.kind).toBe(kind);
      expect(failure.status).toBe(status);
      expect(failure.message).toBe(message);
    }
  });

  it("reports the typed code, not the step's catch-all code", () => {
    expect(
      failureOf("lookup_failed", "Nothing found. (provider_not_found)").code,
    ).toBe("provider_not_found");
    expect(failureOf("lookup_failed", "Something broke").code).toBe(
      "lookup_failed",
    );
  });

  it("names each refusal the engine can raise before anything is sent", () => {
    for (const code of [
      "full_url_refused",
      "unsafe_path_value",
      "invalid_query",
      "invalid_header",
      "header_denied",
      "invalid_pagination",
      "invalid_timeout",
      "incompatible_fields",
      "invalid_field",
    ]) {
      expect(
        failureOf("lookup_failed", `The step was refused. (${code})`).kind,
      ).toBe(code);
    }
  });

  it("does not take the names of an object's own properties for codes", () => {
    expect(failureOf("constructor", "Odd. (toString)")).toMatchObject({
      kind: "failed",
      code: "constructor",
    });
  });

  it("words the action's own field check, such as a status switch beside paging", () => {
    expect(
      failureOf(
        "lookup_failed",
        "github.apiRequest cannot use includeStatus with pagination. (operation_fields_invalid)",
      ),
    ).toMatchObject({
      kind: "invalid_field",
      code: "operation_fields_invalid",
    });
  });

  it("words a request that never got an answer, and one refused before it was sent", () => {
    expect(
      failureOf(
        "lookup_failed",
        "github request timed out for github.apiRequest. (provider_request_failed)",
      ).kind,
    ).toBe("request_failed");
    expect(
      failureOf(
        "lookup_failed",
        "github request for github.apiRequest was refused before it was sent. (provider_request_refused)",
      ).kind,
    ).toBe("request_refused");
    expect(
      failureOf(
        "credential_missing",
        "posthog is missing projectId. (provider_not_configured)",
      ).kind,
    ).toBe("not_connected");
  });

  it("keeps the whole message of a step the cap failed, which names the largest parts and what to do", () => {
    const message =
      'Step "Fetch PR" (fetch) hands on 3 items of 71,000 bytes, over the 65,536-byte cap. Largest: nodes.fetch (60,000 bytes). Narrow the query, use pagination, or make fewer calls.';
    expect(failureOf("output_over_cap", message)).toEqual({
      kind: "too_large",
      code: "output_over_cap",
      status: null,
      message,
    });
  });

  it("falls back to the step's code, then to the HTTP status, then to a plain failure", () => {
    expect(
      failureOf("credential_missing", "github is not connected.").kind,
    ).toBe("not_connected");
    expect(failureOf("output_over_cap", "Too big.").kind).toBe("too_large");
    expect(failureOf("lookup_failed", "Got HTTP 404 from the host.").kind).toBe(
      "not_found",
    );
    expect(failureOf("lookup_failed", "Got HTTP 503 from the host.").kind).toBe(
      "provider_problem",
    );
    expect(failureOf("lookup_failed", "Got HTTP 401 from the host.").kind).toBe(
      "access_denied",
    );
    expect(failureOf("lookup_failed", "Got HTTP 418 from the host.").kind).toBe(
      "rejected",
    );
    expect(failureOf("engine_error", "Boom").kind).toBe("failed");
  });
});

describe("standaloneResultOf", () => {
  it("reads the answer the step recorded, without the name it was recorded under", () => {
    const result = standaloneResultOf(
      journey([event({ summary: 'read: {"status":"ok"}' })]),
      "n1",
      "run1",
    );
    expect(result).toEqual({ kind: "output", text: '{"status":"ok"}' });
  });

  it("takes the latest answer of this run at this step, and no other run's or step's", () => {
    const result = standaloneResultOf(
      journey([
        event({ id: "a", runId: "old", summary: 'read: {"v":1}' }),
        event({ id: "b", nodeId: "n2", summary: 'other: {"v":2}' }),
        event({ id: "c", summary: 'read: {"v":3}' }),
        event({ id: "d", summary: 'read: {"v":4}' }),
      ]),
      "n1",
      "run1",
    );
    expect(result).toEqual({ kind: "output", text: '{"v":4}' });
  });

  it("reports the step's own error before anything else", () => {
    const result = standaloneResultOf(
      journey(
        [event({ summary: 'read: {"v":1}' })],
        [
          step({
            status: "failed",
            error: {
              code: "lookup_failed",
              message: "Not here. (provider_not_found)",
            },
          }),
        ],
      ),
      "n1",
      "run1",
    );
    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" && result.failure.kind).toBe("not_found");
  });

  it("falls back to the error event when the step row has none", () => {
    const result = standaloneResultOf(
      journey([
        event({
          kind: "error",
          code: "lookup_failed",
          summary: "Refused. (header_denied)",
        }),
      ]),
      "n1",
      "run1",
    );
    expect(result.kind === "failed" && result.failure.kind).toBe(
      "header_denied",
    );
  });

  it("says nothing was recorded when the run left no answer for the step", () => {
    expect(standaloneResultOf(journey([]), "n1", "run1")).toEqual({
      kind: "none",
    });
    expect(
      standaloneResultOf(
        journey([event({ runId: "elsewhere", summary: "read: {}" })]),
        "n1",
        "run1",
      ),
    ).toEqual({ kind: "none" });
  });
});

describe("readRecordedAnswer", () => {
  it("reads a whole answer as it is", () => {
    expect(readRecordedAnswer('{"status":"ok","n":2}')).toEqual({
      kind: "value",
      value: { status: "ok", n: 2 },
      cut: false,
    });
    expect(readRecordedAnswer("[1,2]")).toEqual({
      kind: "value",
      value: [1, 2],
      cut: false,
    });
  });

  it("reads the start of an answer the step cut, keeping the whole fields of the entry the cut fell in", () => {
    const cut = '[{"id":1,"name":"a"},{"id":2,"name":"bb"},{"id":3,"na…[cut]';
    expect(readRecordedAnswer(cut)).toEqual({
      kind: "value",
      value: [{ id: 1, name: "a" }, { id: 2, name: "bb" }, { id: 3 }],
      cut: true,
    });
  });

  it("closes nested containers and drops a key that lost its value", () => {
    expect(
      readRecordedAnswer(
        '{"meta":{"page":1,"next":"x"},"items":[{"a":1},{"a"…[cut]',
      ),
    ).toEqual({
      kind: "value",
      value: { meta: { page: 1, next: "x" }, items: [{ a: 1 }] },
      cut: true,
    });
    expect(readRecordedAnswer('{"a":1,"b"…[cut]')).toEqual({
      kind: "value",
      value: { a: 1 },
      cut: true,
    });
  });

  it("does not keep a number the cut may have shortened", () => {
    expect(readRecordedAnswer('{"a":1,"total":12…[cut]')).toEqual({
      kind: "value",
      value: { a: 1 },
      cut: true,
    });
  });

  it("keeps a comma inside a string from being taken for a boundary", () => {
    expect(readRecordedAnswer('{"a":"x, y","b":"z…[cut]')).toEqual({
      kind: "value",
      value: { a: "x, y" },
      cut: true,
    });
  });

  it("shows text it cannot read at all as text, never as an empty answer", () => {
    expect(readRecordedAnswer("not json")).toEqual({
      kind: "text",
      text: "not json",
    });
    expect(readRecordedAnswer('{"only…[cut]')).toEqual({
      kind: "text",
      text: '{"only…[cut]',
    });
  });
});

describe("what the answer is", () => {
  it("counts a list, and the entries of a paged answer", () => {
    expect(listOf([1, 2, 3])).toEqual({ entries: [1, 2, 3], total: null });
    expect(
      listOf({
        pagesRead: 2,
        moreAvailable: false,
        nextCursor: null,
        items: [1],
      }),
    ).toEqual({ entries: [1], total: null });
    expect(listOf({ items: [1] })).toBe(null);
    expect(listOf({ status: "ok" })).toBe(null);
    expect(listOf("x")).toBe(null);
  });

  it("counts the kept entries of a list the step cut, against how many there were", () => {
    expect(
      listOf({
        truncated: true,
        count: 2,
        totalAvailable: 30,
        cuts: [{ path: "value", kept: 2, of: 30 }],
        value: [{ id: 1 }, { id: 2 }],
      }),
    ).toEqual({ entries: [{ id: 1 }, { id: 2 }], total: 30 });
    expect(listOf({ truncated: true, count: 1, value: [{ id: 1 }] })).toEqual({
      entries: [{ id: 1 }],
      total: null,
    });
    // A `value` beside no cut is just a field of the answer.
    expect(listOf({ value: [1] })).toBe(null);
  });

  it("knows the step cut the provider's answer", () => {
    expect(isCutByStep({ data: [], truncated: true })).toBe(true);
    expect(isCutByStep({ data: [] })).toBe(false);
    expect(isCutByStep([{ truncated: true }])).toBe(false);
  });

  it("lists where the step cut, in each of the shapes it writes", () => {
    expect(
      cutsOf({
        truncated: true,
        cuts: [
          { path: "items", kept: 3, of: 40 },
          { path: "body.text", keptChars: 300, ofChars: 4000 },
          { path: "body", droppedKeys: ["a", "b"], droppedCount: 2 },
          { path: "x", mystery: true },
          "not an entry",
        ],
        cutsOmitted: 4,
      }),
    ).toEqual({
      cuts: [
        { kind: "list", path: "items", kept: 3, of: 40 },
        { kind: "text", path: "body.text", kept: 300, of: 4000 },
        { kind: "keys", path: "body", count: 2 },
      ],
      omitted: 4,
    });
    expect(cutsOf({ truncated: true })).toEqual({ cuts: [], omitted: 0 });
    expect(cutsOf("x")).toEqual({ cuts: [], omitted: 0 });
  });
});

describe("the answer in the Schema and Table views", () => {
  it("makes a schema row of each key of an object, with its nested fields", () => {
    const rows = schemaOfValue({ status: "ok", user: { id: 7 }, tags: ["a"] });
    expect(rows.map((row) => [row.label, row.kind, row.sample])).toEqual([
      ["status", "text", "ok"],
      ["user", "object", null],
      ["tags", "list", null],
    ]);
    expect(rows[1]?.children.map((child) => child.label)).toEqual(["id"]);
  });

  it("makes one expandable row of a list, and a row for a bare value or an empty object", () => {
    const list = schemaOfValue([{ id: 1 }, { id: 2 }]);
    expect(list).toHaveLength(1);
    expect(list[0]?.children.map((child) => child.label)).toEqual(
      ["[ ][0]", "[ ][1]"].map((label) => label.replace("[ ]", "")),
    );
    expect(schemaOfValue("hello")[0]).toMatchObject({
      label: "value",
      sample: "hello",
    });
    expect(schemaOfValue({})[0]).toMatchObject({
      label: "value",
      sample: "{}",
    });
  });

  it("makes a table row of each record of a list, with a column for each key in the order they first appear", () => {
    const table = rawTableOf([
      { id: 1, a: "x" },
      { id: 2, b: "y" },
    ]);
    expect(table.columns.map((column) => column.key)).toEqual(["id", "a", "b"]);
    expect(table.rows).toHaveLength(2);
    expect(table.hidden).toBe(0);
  });

  it("makes a single row of an object and a value column of anything else", () => {
    expect(rawTableOf({ status: "ok" })).toMatchObject({
      columns: [{ key: "status", label: "status" }],
      rows: [{ status: "ok" }],
    });
    expect(rawTableOf([1, 2]).rows).toEqual([{ value: 1 }, { value: 2 }]);
    expect(rawTableOf("x").rows).toEqual([{ value: "x" }]);
  });

  it("counts the columns past the limit instead of drawing them", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 45 }, (_, index) => [`k${index}`, index]),
    );
    const table = rawTableOf(wide);
    expect(table.columns).toHaveLength(40);
    expect(table.hidden).toBe(5);
  });

  it("searches the values and not the key names", () => {
    expect(textOf({ name: "Ada", nested: [1, true] })).toBe("Ada 1 true");
  });
});

describe("the answer of a test just run", () => {
  const pull = (n: number) => ({ id: n, body: `${n}`.repeat(25_000) });

  it("reads the whole bounded response the server sends, as the answer", () => {
    expect(
      liveAnswerOf({
        ok: true,
        status: 200,
        output: [{ id: 1 }],
        truncated: false,
        elapsedMs: 130,
      }),
    ).toEqual({
      kind: "answer",
      value: [{ id: 1 }],
      status: 200,
      elapsedMs: 130,
    });
  });

  it("shows how many entries a cut list kept of how many the provider sent, from the cuts the server wrote", () => {
    const { output } = boundOutput([pull(1), pull(2), pull(3)]);
    const live = liveAnswerOf({
      ok: true,
      status: 200,
      output,
      truncated: true,
      elapsedMs: 5,
    });
    if (live.kind !== "answer") throw new Error("Expected an answer.");

    expect(isCutByStep(live.value)).toBe(true);
    const list = listOf(live.value);
    expect(list?.total).toBe(3);
    expect(list?.entries.length).toBeLessThan(3);
    expect(cutsOf(live.value)).toEqual({
      cuts: [
        { kind: "list", path: "value", kept: list?.entries.length, of: 3 },
      ],
      omitted: 0,
    });
  });

  it("shows an answer that fit as the list it is, with nothing cut", () => {
    const { output } = boundOutput([{ id: 1 }, { id: 2 }]);
    expect(isCutByStep(output)).toBe(false);
    expect(listOf(output)).toEqual({
      entries: [{ id: 1 }, { id: 2 }],
      total: null,
    });
  });

  it("reads a status answer's body as one the pane lays out", () => {
    expect(listOf({ status: 200, headers: {}, body: [{ id: 1 }] })).toBeNull();
  });
});
