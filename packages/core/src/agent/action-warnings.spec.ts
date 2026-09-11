import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";
import {
  drainAgentWarnings,
  formatAgentWarningsForToolResult,
  warnAgent,
} from "./action-warnings.js";

describe("warnAgent", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockClear();
  });

  // The dropped warning is the failure being fixed: outside an agent run there
  // is no conversation to reach, so the console must still get it.
  it("falls through to the console with no run context", () => {
    warnAgent({
      severity: "critical",
      code: "org-cross-org-repoint",
      message: "Repointed an account across organizations.",
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe(
      "[agent-native][critical:org-cross-org-repoint] Repointed an account across organizations.",
    );
    expect(drainAgentWarnings()).toEqual([]);
  });

  it("falls through to the console when a request context has no run", async () => {
    await runWithRequestContext({ userEmail: "a@example.com" }, async () => {
      warnAgent({
        severity: "advisory",
        code: "probe",
        message: "Advisory message.",
      });
    });

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("collects onto the active run instead of the console", async () => {
    await runWithRequestContext(
      { userEmail: "a@example.com", run: {} },
      async () => {
        warnAgent({
          severity: "critical",
          code: "org-additional-organization",
          message: "Created an ADDITIONAL organization.",
        });

        expect(warn).not.toHaveBeenCalled();
        expect(drainAgentWarnings()).toEqual([
          {
            severity: "critical",
            code: "org-additional-organization",
            message: "Created an ADDITIONAL organization.",
          },
        ]);
      },
    );
  });

  it("drains once and leaves nothing behind for the next tool call", async () => {
    await runWithRequestContext(
      { userEmail: "a@example.com", run: {} },
      async () => {
        warnAgent({ severity: "advisory", code: "a", message: "First." });

        expect(drainAgentWarnings()).toHaveLength(1);
        expect(drainAgentWarnings()).toEqual([]);
      },
    );
  });

  it("dedupes an identical warning within one drain", async () => {
    await runWithRequestContext(
      { userEmail: "a@example.com", run: {} },
      async () => {
        warnAgent({ severity: "critical", code: "a", message: "Same." });
        warnAgent({ severity: "critical", code: "a", message: "Same." });
        warnAgent({ severity: "critical", code: "a", message: "Different." });

        expect(drainAgentWarnings().map((w) => w.message)).toEqual([
          "Same.",
          "Different.",
        ]);
      },
    );
  });

  // A second repoint in a later tool call is a second real operation. Dedupe
  // must not turn it into silence the way an unreset module-level Set would.
  it("re-reports the same warning raised after an earlier drain", async () => {
    await runWithRequestContext(
      { userEmail: "a@example.com", run: {} },
      async () => {
        warnAgent({ severity: "critical", code: "a", message: "Same." });
        drainAgentWarnings();
        warnAgent({ severity: "critical", code: "a", message: "Same." });

        expect(drainAgentWarnings()).toHaveLength(1);
      },
    );
  });

  it("keeps runs isolated from each other", async () => {
    const runA = {};
    const runB = {};

    await runWithRequestContext({ run: runA }, async () => {
      warnAgent({ severity: "advisory", code: "a", message: "A." });
    });
    await runWithRequestContext({ run: runB }, async () => {
      expect(drainAgentWarnings()).toEqual([]);
    });
    await runWithRequestContext({ run: runA }, async () => {
      expect(drainAgentWarnings().map((w) => w.message)).toEqual(["A."]);
    });
  });
});

describe("formatAgentWarningsForToolResult", () => {
  it("tags each warning with its severity and code", () => {
    expect(
      formatAgentWarningsForToolResult([
        {
          severity: "critical",
          code: "org-cross-org-repoint",
          message: "Bad.",
        },
        { severity: "advisory", code: "probe", message: "Heads up." },
      ]),
    ).toBe(
      '<agent-warning severity="critical" code="org-cross-org-repoint">\n' +
        "Bad.\n" +
        "</agent-warning>\n" +
        '<agent-warning severity="advisory" code="probe">\n' +
        "Heads up.\n" +
        "</agent-warning>",
    );
  });
});
