import assert from "node:assert/strict";
import test from "node:test";

import { selectRecoverySessionToken } from "./recovery-session-token";

test("accepts a wildcard only for a validated single-app diagnostic", () => {
  for (const app of ["content", "dispatch"]) {
    assert.deepEqual(
      selectRecoverySessionToken(
        app,
        { "*": "fixture-wildcard" },
        "fixture-wildcard",
        true,
      ),
      {
        kind: "selected",
        token: "fixture-wildcard",
      },
    );
    assert.deepEqual(
      selectRecoverySessionToken(
        app,
        { "*": "fixture-wildcard" },
        "fixture-wildcard",
        false,
      ),
      {
        kind: "unavailable",
        code: "app_token_missing",
      },
    );
  }
});

test("explicit app entries take precedence and invalid entries block fallback", () => {
  for (const allowWildcard of [true, false]) {
    assert.deepEqual(
      selectRecoverySessionToken(
        "content",
        { content: "fixture-app", "*": "fixture-wildcard" },
        "fixture-app",
        allowWildcard,
      ),
      {
        kind: "selected",
        token: "fixture-app",
      },
    );
    for (const content of ["", " ", null, undefined, false, 12, {}, []]) {
      assert.deepEqual(
        selectRecoverySessionToken(
          "content",
          { content, "*": "fixture-wildcard" },
          "fixture-wildcard",
          allowWildcard,
        ),
        {
          kind: "unavailable",
          code: "app_token_missing",
        },
      );
    }
  }
});

test("rejects invalid maps, unknown apps, inherited entries and override mismatches without private errors", () => {
  for (const map of [null, undefined, [], "fixture-private-map", 12]) {
    assert.deepEqual(
      selectRecoverySessionToken(
        "content",
        map,
        "fixture-private-resolved",
        true,
      ),
      {
        kind: "unavailable",
        code: "token_map_unreadable",
      },
    );
  }
  assert.deepEqual(
    selectRecoverySessionToken(
      "fixture-private-app",
      { "*": "fixture-private-token" },
      "fixture-private-token",
      true,
    ),
    {
      kind: "unavailable",
      code: "invalid_app",
    },
  );
  assert.deepEqual(
    selectRecoverySessionToken(
      "content,dispatch",
      { "*": "fixture-private-token" },
      "fixture-private-token",
      true,
    ),
    {
      kind: "unavailable",
      code: "invalid_app",
    },
  );
  assert.deepEqual(
    selectRecoverySessionToken("content", {}, "fixture-private-override", true),
    {
      kind: "unavailable",
      code: "app_token_missing",
    },
  );
  assert.deepEqual(
    selectRecoverySessionToken(
      "content",
      { content: "fixture-app", "*": "fixture-wildcard" },
      "fixture-wildcard",
      true,
    ),
    {
      kind: "unavailable",
      code: "app_token_ambiguous",
    },
  );
  assert.deepEqual(
    selectRecoverySessionToken(
      "content",
      Object.create({
        content: "fixture-private-token",
        "*": "fixture-private-token",
      }),
      "fixture-private-token",
      true,
    ),
    {
      kind: "unavailable",
      code: "app_token_missing",
    },
  );
  for (const map of [
    { content: "fixture-private-app-token" },
    { "*": "fixture-private-wildcard" },
  ]) {
    const result = selectRecoverySessionToken(
      "content",
      map,
      "fixture-private-override",
      true,
    );
    assert.deepEqual(result, {
      kind: "unavailable",
      code: "app_token_ambiguous",
    });
    assert.equal(JSON.stringify(result).includes("fixture-private"), false);
  }
});
