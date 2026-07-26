import { describe, expect, it } from "vitest";

import { safeProposalValues } from "./crm-store.js";

describe("CRM proposal previews", () => {
  it("omits transcript, media, binary, data-url, and oversized values", () => {
    const values = safeProposalValues(
      JSON.stringify({
        fields: {
          dealname: "Renewal",
          meeting_transcript: "do not display",
          recording_url: "https://example.test/recording",
          data: "data:audio/wav;base64,AAAA",
          encoded: "A".repeat(400),
          oversized: "x".repeat(2_001),
        },
      }),
    );

    expect(values).toEqual({ dealname: "Renewal" });
  });
});
