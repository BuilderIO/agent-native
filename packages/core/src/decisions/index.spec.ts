import { describe, expect, it } from "vitest";

import {
  DECISION_PROVIDER_CAPABILITIES,
  decide,
  getDecisionsStatus,
  JEV_DECISIONS_MODEL,
  MAX_DECISION_PAYLOAD_BYTES,
  OPENAI_DECISIONS_MODEL,
} from "./index.js";

// oracle-change: removed the type-export test, whose runtime assertions only compared string literals it had just assigned; the calendar, mail and tasks templates import DecisionAnswer from the public entry, so tsc owns that export

describe("public Decisions exports", () => {
  it("exports the shared providers, capabilities, and payload budget", () => {
    expect(typeof decide).toBe("function");
    expect(typeof getDecisionsStatus).toBe("function");
    expect(JEV_DECISIONS_MODEL).toBe("jev-latest");
    expect(OPENAI_DECISIONS_MODEL).toBe("gpt-6-luna");
    expect(MAX_DECISION_PAYLOAD_BYTES).toBe(256 * 1024);
    expect(DECISION_PROVIDER_CAPABILITIES).toHaveProperty("openai");
    expect(DECISION_PROVIDER_CAPABILITIES).toHaveProperty("jev");
  });
});
