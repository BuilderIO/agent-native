import { describe, expect, it } from "vitest";

import { runTelemetryException } from "./error-telemetry.js";

describe("runTelemetryException", () => {
  it.each([
    ["EngineError", "EngineError"],
    ["AI_APICallError", "AI_APICallError"],
    ["DOMException", "DOMException"],
    ["JaneDoe", "Error"],
    ["QuarterlyPlanningNotes", "Error"],
    ["Jane Doe Error", "Error"],
  ])("reports the name %s as %s", (name, expected) => {
    const error = new Error("Jane Doe's notes are locked");
    error.name = name;

    expect(runTelemetryException(error, "provider_error").name).toBe(expected);
  });

  it("keeps frames but not message lines shaped like frames", () => {
    const error = new Error(
      "Jane Doe's notes are locked\n    at line 3 of Jane Doe's notes\n    at Jane Doe (/notes/quarterly.md:3:1)",
    );
    error.stack = `${String(error)}\n    at readNotes (/app/notes.ts:10:2)\n    at Array.map (<anonymous>)`;

    expect(runTelemetryException(error, "provider_error").stack).toBe(
      "Error: Internal Server Error\n    at readNotes (/app/notes.ts:10:2)\n    at Array.map (<anonymous>)",
    );
  });

  it("drops appended cause text but keeps its frames", () => {
    const error = new Error("Run failed");
    error.stack = `${String(error)}\n    at run (/app/run.ts:4:1)\nCaused by: Error: Jane Doe's private document\n    at line 3 of Jane Doe's notes\n    at readNotes (/app/notes.ts:10:2)`;

    expect(runTelemetryException(error, "provider_error").stack).toBe(
      "Error: Internal Server Error\n    at run (/app/run.ts:4:1)\n    at readNotes (/app/notes.ts:10:2)",
    );
  });

  it("drops the stack when its header no longer matches the error", () => {
    const error = new Error(
      "Jane Doe's notes\n    at Jane Doe (/notes.md:3:1)",
    );
    expect(error.stack).toContain("Jane Doe");
    error.message = "Reading notes failed";

    const exception = runTelemetryException(error, "provider_error");

    expect(exception.stack).toBeUndefined();
    expect(exception.message).toBe("Internal Server Error");
  });
});
