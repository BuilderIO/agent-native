import { describe, expect, it } from "vitest";

import { failureThreadUrl } from "./failure-thread-url";

describe("failureThreadUrl", () => {
  it("returns the thread link a capture named", () => {
    expect(
      failureThreadUrl({
        failureContext: {
          threadUrl: "https://calendar.agent-native.com/?thread=thr_1",
        },
      }),
    ).toBe("https://calendar.agent-native.com/?thread=thr_1");
  });

  it("returns nothing for a capture with no thread", () => {
    expect(failureThreadUrl(undefined)).toBeUndefined();
    expect(failureThreadUrl({})).toBeUndefined();
    expect(failureThreadUrl({ failureContext: { runId: "run_1" } })).toBe(
      undefined,
    );
  });

  it("never links a non-http address or a non-string value", () => {
    for (const threadUrl of [
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "not a url",
      42,
      { href: "https://example.com" },
    ]) {
      expect(failureThreadUrl({ failureContext: { threadUrl } })).toBe(
        undefined,
      );
    }
  });
});
