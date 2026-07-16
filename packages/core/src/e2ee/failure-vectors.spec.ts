import { describe, expect, it } from "vitest";

import { PROTOCOL_FAILURE_FIXTURES } from "./failure-fixtures.js";
import { validateProtocolState } from "./failure-vectors.js";

describe("E2EE pre-crypto failure corpus", () => {
  it.each(PROTOCOL_FAILURE_FIXTURES)("rejects $fixtureId", (fixture) => {
    expect(validateProtocolState(fixture.check)).toEqual({
      ok: false,
      code: fixture.expected,
      disposition: fixture.expectedDisposition,
    });
  });
});
