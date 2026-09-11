import { describe, expect, it, vi } from "vitest";

import { filterGongCallsByEmail, lookupGongCallsByEmail } from "./gong.js";

describe("Gong lookup helpers", () => {
  it("filters by participant email and returns compact call summaries", () => {
    expect(
      filterGongCallsByEmail(
        [
          {
            id: "call-1",
            title: "Review",
            parties: [{ name: "Ada", emailAddress: "ADA@example.com" }],
          },
          { id: "call-2", parties: [{ emailAddress: "other@example.com" }] },
        ],
        "ada@example.com",
      ),
    ).toEqual([
      {
        id: "call-1",
        title: "Review",
        started: undefined,
        duration: undefined,
        direction: undefined,
        parties: [{ name: "Ada", email: "ADA@example.com" }],
      },
    ]);
  });

  it("tries caller-supplied credentials as bearer then basic", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            calls: [
              { id: "call-1", parties: [{ emailAddress: "ada@example.com" }] },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    await expect(
      lookupGongCallsByEmail({
        credential: "example-credential",
        email: "ada@example.com",
        now: Date.UTC(2026, 0, 1),
        fetch,
      }),
    ).resolves.toMatchObject({ ok: true, calls: [{ id: "call-1" }] });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer example-credential",
    });
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("example-credential").toString("base64")}`,
    });
  });
});
