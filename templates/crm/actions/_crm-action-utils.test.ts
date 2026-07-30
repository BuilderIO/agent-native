import { describe, expect, it } from "vitest";

import {
  isBoundedCrmValue,
  isSafeCrmMutationFields,
  scopedCrmIdempotencyKey,
} from "./_crm-action-utils.js";

describe("CRM mutation firewall", () => {
  it("rejects transcript/media fields and binary-shaped values", () => {
    expect(
      isSafeCrmMutationFields({ meeting_transcript: "short excerpt" }),
    ).toBe(false);
    expect(isSafeCrmMutationFields({ note: "A".repeat(400) })).toBe(false);
    expect(isBoundedCrmValue("data:audio/wav;base64,AAAA")).toBe(false);
    expect(isSafeCrmMutationFields({ dealname: "Renewal" })).toBe(true);
  });

  it("derives a stable idempotency key scoped to the CRM tenant and record", async () => {
    const input = {
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      recordId: "record-1",
      key: "retry-1",
    };
    await expect(scopedCrmIdempotencyKey(input)).resolves.toBe(
      await scopedCrmIdempotencyKey(input),
    );
    await expect(
      scopedCrmIdempotencyKey({ ...input, recordId: "record-2" }),
    ).resolves.not.toBe(await scopedCrmIdempotencyKey(input));
  });
});
