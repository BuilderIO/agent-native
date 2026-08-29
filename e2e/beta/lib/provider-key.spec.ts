import assert from "node:assert/strict";
import test from "node:test";

import { isConfirmedOpenAiKeyInstall } from "./provider-key";

test("requires the user-scoped OpenAI install response contract", () => {
  const valid = {
    status: 200,
    body: '{"ok":true,"key":"OPENAI_API_KEY","scope":"user"}',
  };
  assert.equal(isConfirmedOpenAiKeyInstall(valid), true);
  assert.equal(
    isConfirmedOpenAiKeyInstall({
      status: 204,
      body: "",
    }),
    false,
  );
  assert.equal(
    isConfirmedOpenAiKeyInstall({
      status: 200,
      body: '{"ok":true,"key":"OPENAI_API_KEY","scope":"org"}',
    }),
    false,
  );
});
