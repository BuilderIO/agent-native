import { describe, expect, it } from "vitest";
import { emailAdapter } from "./email.js";

describe("emailAdapter formatting", () => {
  it("renders bare URLs as labelled links instead of visible raw URLs", () => {
    const outgoing = emailAdapter().formatAgentResponse(
      "Join here: https://builder-io.zoom.us/j/123?pwd=secret.",
    );

    expect(outgoing.text).toContain(
      'href="https://builder-io.zoom.us/j/123?pwd=secret"',
    );
    expect(outgoing.text).toContain(">Open builder-io.zoom.us</a>.");
    expect(outgoing.text).not.toContain(
      ">https://builder-io.zoom.us/j/123?pwd=secret</a>",
    );
  });

  it("keeps markdown link labels but collapses URL labels", () => {
    const outgoing = emailAdapter().formatAgentResponse(
      "[Manage booking](https://app.test/booking/manage/abc)\n\n[https://app.test/long/path](https://app.test/long/path)",
    );

    expect(outgoing.text).toContain(">Manage booking</a>");
    expect(outgoing.text).toContain(">Open app.test</a>");
    expect(outgoing.text).not.toContain(">https://app.test/long/path</a>");
  });
});
