import { isActionContractError } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

import { SourceInputError } from "../../shared/source-workspace.js";
import { failOnSourceInputError } from "./fail-on-source-input-error.js";

function thrownFrom(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected run to throw");
}

describe("failOnSourceInputError", () => {
  it("turns a source input error into a typed 400 failure that keeps its code and message", () => {
    const thrown = thrownFrom(() =>
      failOnSourceInputError(() => {
        throw new SourceInputError(
          "search_text_ambiguous",
          "Search text matched more than once. Add more surrounding context.",
        );
      }),
    );

    expect(isActionContractError(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      errorCode: "search_text_ambiguous",
      statusCode: 400,
      message:
        "Search text matched more than once. Add more surrounding context.",
    });
  });

  it("rethrows any other error as the same instance", () => {
    const original = new Error("disk unavailable");

    const thrown = thrownFrom(() =>
      failOnSourceInputError(() => {
        throw original;
      }),
    );

    expect(thrown).toBe(original);
    expect(isActionContractError(thrown)).toBe(false);
  });

  it("passes the return value through when nothing throws", () => {
    const value = { content: "<main>ok</main>", changed: false };

    expect(failOnSourceInputError(() => value)).toBe(value);
  });
});
