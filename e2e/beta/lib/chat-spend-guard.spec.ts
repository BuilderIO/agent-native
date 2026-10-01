import assert from "node:assert/strict";
import test from "node:test";

import {
  judgeResolvedEngine,
  MISSING_ENGINE,
  readTurnSelection,
  spendViolations,
  type ApiProbe,
  type ChatRequestLog,
} from "./chat";

const OPENAI = "ai-sdk:openai";
const LUNA = "gpt-5.6-luna";

const ok = (json: unknown, status = 200): ApiProbe => ({
  kind: "response",
  status,
  json,
});

const status = (engine: unknown, configured: unknown = true) =>
  ok({ configured, engine, source: "settings" });

const noAppDefault = ok({ appId: "chat", engine: null, model: null });

function log(
  requests: Array<{ model: string | null; engine: string | null }>,
): ChatRequestLog {
  return {
    models: requests.flatMap((r) => (r.model ? [r.model] : [])),
    engines: requests.map((r) => r.engine ?? MISSING_ENGINE),
    modelless: requests.filter((r) => !r.model).length,
    count: requests.length,
    requests,
    origin: "https://beta.chat.agent-native.com",
    engineProof: null,
  };
}

test("reads only what a turn body names at the top level", () => {
  assert.deepEqual(
    readTurnSelection(JSON.stringify({ model: LUNA, engine: OPENAI })),
    { model: LUNA, engine: OPENAI },
  );
  // The Chat template's composer puts the engine in metadata, which the server ignores.
  assert.deepEqual(
    readTurnSelection(
      JSON.stringify({ model: LUNA, metadata: { engine: OPENAI } }),
    ),
    { model: LUNA, engine: null },
  );
  assert.deepEqual(readTurnSelection(JSON.stringify({ model: "  " })), {
    model: null,
    engine: null,
  });
  assert.deepEqual(readTurnSelection("not json"), {
    model: null,
    engine: null,
  });
  assert.deepEqual(readTurnSelection(null), { model: null, engine: null });
});

test("a turn that names luna and the expected engine needs no proof", () => {
  assert.deepEqual(
    spendViolations(
      log([{ model: LUNA, engine: OPENAI }]),
      { engine: OPENAI },
      null,
    ),
    [],
  );
});

test("an engine-less luna turn passes only with a proven engine", () => {
  const turns = log([{ model: LUNA, engine: null }]);
  const unproven = spendViolations(turns, { engine: OPENAI }, null);
  assert.equal(unproven.length, 1);
  assert.match(unproven[0], /named no engine/);
  assert.match(unproven[0], /no engine proof was read/);

  const rejected = spendViolations(
    turns,
    { engine: OPENAI },
    { proven: false, reason: "the account resolves to engine builder" },
  );
  assert.match(rejected[0], /resolves to engine builder/);

  assert.deepEqual(
    spendViolations(
      turns,
      { engine: OPENAI },
      { proven: true, detail: "account engine ai-sdk:openai" },
    ),
    [],
  );
});

test("a proven engine never excuses a wrong model, a missing model, or a wrong explicit engine", () => {
  const proof = {
    proven: true as const,
    detail: "account engine ai-sdk:openai",
  };
  assert.match(
    spendViolations(
      log([{ model: "claude-opus-4-8", engine: null }]),
      { engine: OPENAI },
      proof,
    ).join("\n"),
    /non-luna models: claude-opus-4-8/,
  );
  assert.match(
    spendViolations(
      log([
        { model: LUNA, engine: null },
        { model: null, engine: null },
      ]),
      { engine: OPENAI },
      proof,
    ).join("\n"),
    /1 request\(s\) carried no model field/,
  );
  assert.match(
    spendViolations(
      log([{ model: LUNA, engine: "builder" }]),
      { engine: OPENAI },
      proof,
    ).join("\n"),
    /routed through engine\(s\) builder instead of ai-sdk:openai/,
  );
});

test("proves the engine only when the account and the app default both resolve to it", () => {
  assert.deepEqual(
    judgeResolvedEngine(
      { status: status(OPENAI), appDefault: noAppDefault },
      OPENAI,
    ),
    {
      proven: true,
      detail:
        "account engine ai-sdk:openai (source settings), app default none",
    },
  );
  assert.equal(
    judgeResolvedEngine(
      {
        status: status(OPENAI),
        appDefault: ok({ engine: OPENAI, model: LUNA }),
      },
      OPENAI,
    ).proven,
    true,
  );
});

test("refuses to prove a Builder gateway or a shared-credit engine", () => {
  const builder = judgeResolvedEngine(
    { status: status("builder"), appDefault: noAppDefault },
    OPENAI,
  );
  assert.equal(builder.proven, false);
  assert.match(
    builder.proven ? "" : builder.reason,
    /resolves to engine builder, not ai-sdk:openai/,
  );

  const overridden = judgeResolvedEngine(
    {
      status: status(OPENAI),
      appDefault: ok({ engine: "builder", model: "gpt-5-6-luna" }),
    },
    OPENAI,
  );
  assert.equal(overridden.proven, false);
  assert.match(
    overridden.proven ? "" : overridden.reason,
    /app's default engine is builder/,
  );
});

test("an unreadable or unexpected answer is unproven, never an empty default", () => {
  const cases: Array<
    [string, Parameters<typeof judgeResolvedEngine>[0], RegExp]
  > = [
    [
      "status unreadable",
      {
        status: { kind: "unreadable", reason: "timeout" },
        appDefault: noAppDefault,
      },
      /agent-engine\/status was unreadable \(timeout\)/,
    ],
    [
      "status HTTP error",
      { status: ok({}, 503), appDefault: noAppDefault },
      /agent-engine\/status answered HTTP 503/,
    ],
    [
      "status not configured",
      { status: status(OPENAI, false), appDefault: noAppDefault },
      /configured=false/,
    ],
    [
      "status carries no engine",
      { status: ok({ configured: true }), appDefault: noAppDefault },
      /engine=undefined/,
    ],
    [
      "app default unreadable",
      {
        status: status(OPENAI),
        appDefault: {
          kind: "unreadable",
          reason: "HTTP 200 was not JSON: <html",
        },
      },
      /agent-model-defaults was unreadable/,
    ],
    [
      "app default HTTP error",
      { status: status(OPENAI), appDefault: ok({}, 401) },
      /agent-model-defaults answered HTTP 401/,
    ],
    [
      "app default has no engine field",
      { status: status(OPENAI), appDefault: ok({ appId: "chat" }) },
      /carried no engine field/,
    ],
    [
      "app default is not an object",
      { status: status(OPENAI), appDefault: ok([]) },
      /did not answer with a JSON object/,
    ],
  ];
  for (const [name, read, expected] of cases) {
    const proof = judgeResolvedEngine(read, OPENAI);
    assert.equal(proof.proven, false, name);
    assert.match(proof.proven ? "" : proof.reason, expected, name);
  }
});
