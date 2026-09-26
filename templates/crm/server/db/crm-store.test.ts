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

    expect(values).toEqual({ present: true, values: { dealname: "Renewal" } });
  });

  it("reports revision metadata as carrying no field map at all", () => {
    expect(safeProposalValues(JSON.stringify({ remoteRevision: "3" }))).toEqual(
      {
        present: false,
      },
    );
    expect(safeProposalValues("{}")).toEqual({ present: false });
    expect(safeProposalValues("not json")).toEqual({ present: false });
  });

  it("keeps a recorded empty field map distinct from an absent one", () => {
    expect(safeProposalValues(JSON.stringify({ fields: {} }))).toEqual({
      present: true,
      values: {},
    });
  });
});
