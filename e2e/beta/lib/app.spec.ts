import assert from "node:assert/strict";
import test from "node:test";

import { isKnownThirdPartyPageError } from "./app";

test("classifies Vector fetch failures as third-party noise", () => {
  assert.equal(
    isKnownThirdPartyPageError(
      "Failed to fetch",
      "TypeError: Failed to fetch\n    at https://beta.example.com/assets/app.js\n    at https://cdn.vector.co/pixel.js:2:33164",
    ),
    true,
  );
  assert.equal(
    isKnownThirdPartyPageError(
      "Failed to fetch",
      "TypeError: Failed to fetch\n    at https://beta.example.com/assets/app.js",
    ),
    false,
  );
  assert.equal(
    isKnownThirdPartyPageError(
      "Failed to fetch",
      "TypeError: Failed to fetch\n    at https://cdn.example.test/pixel.js",
    ),
    false,
  );
});
