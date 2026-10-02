import assert from "node:assert/strict";
import test from "node:test";

import {
  MISSING_ENGINE,
  readTurnSelection,
  spendViolations,
  type ChatRequestLog,
} from "./chat";

const OPENAI = "ai-sdk:openai";
const LUNA = "gpt-5.6-luna";

function log(
  requests: Array<{ model: string | null; engine: string | null }>,
): ChatRequestLog {
  return {
    models: requests.flatMap((r) => (r.model ? [r.model] : [])),
    engines: requests.map((r) => r.engine ?? MISSING_ENGINE),
    modelless: requests.filter((r) => !r.model).length,
    count: requests.length,
    requests,
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

test("a turn that names luna and the expected engine is clean", () => {
  assert.deepEqual(
    spendViolations(log([{ model: LUNA, engine: OPENAI }]), {
      engine: OPENAI,
    }),
    [],
  );
});

test("a turn that names no engine is a violation, because the server picks the engine", () => {
  const lines = spendViolations(log([{ model: LUNA, engine: null }]), {
    engine: OPENAI,
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /1 request\(s\) named no engine/);
  assert.match(lines[0], /did not provably bill the dedicated key/);
});

test("a turn that names no model is a violation", () => {
  assert.match(
    spendViolations(log([{ model: null, engine: OPENAI }]), {
      engine: OPENAI,
    }).join("\n"),
    /1 request\(s\) carried no model field/,
  );
});

test("a non-luna model is a violation", () => {
  assert.match(
    spendViolations(log([{ model: "claude-opus-4-8", engine: OPENAI }]), {
      engine: OPENAI,
    }).join("\n"),
    /non-luna models: claude-opus-4-8/,
  );
});

test("a turn that names a different engine is a violation", () => {
  assert.match(
    spendViolations(log([{ model: LUNA, engine: "builder" }]), {
      engine: OPENAI,
    }).join("\n"),
    /routed through engine\(s\) builder instead of ai-sdk:openai/,
  );
});

test("one unprovable turn among clean ones still fails the run", () => {
  const lines = spendViolations(
    log([
      { model: LUNA, engine: OPENAI },
      { model: LUNA, engine: null },
      { model: LUNA, engine: OPENAI },
    ]),
    { engine: OPENAI },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /1 request\(s\) named no engine/);
});
