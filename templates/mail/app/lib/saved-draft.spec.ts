import { describe, expect, it } from "vitest";

import { savedEmailDraftMetadata } from "./saved-draft";

describe("savedEmailDraftMetadata", () => {
  it("preserves the Gmail account as both sender and saved-draft owner", () => {
    expect(
      savedEmailDraftMetadata({
        id: "gmail-draft-1",
        accountEmail: "secondary@example.com",
      }),
    ).toEqual({
      accountEmail: "secondary@example.com",
      savedDraftId: "gmail-draft-1",
      savedDraftBackend: "gmail",
      savedDraftAccountEmail: "secondary@example.com",
    });
  });

  it("marks a local saved draft without a Gmail account as local", () => {
    expect(savedEmailDraftMetadata({ id: "local-draft-1" })).toMatchObject({
      savedDraftId: "local-draft-1",
      savedDraftBackend: "local",
    });
  });
});
