import { describe, expect, it } from "vitest";

import { buildDeleteEventMutationInput } from "./event-mutation-inputs";

describe("buildDeleteEventMutationInput", () => {
  it("preserves the connected account when deleting one working-location day", () => {
    expect(
      buildDeleteEventMutationInput(
        {
          id: "google-working-location-20260708",
          accountEmail: "owner@example.com",
        },
        { scope: "single", sendUpdates: "none" },
      ),
    ).toEqual({
      id: "google-working-location-20260708",
      accountEmail: "owner@example.com",
      scope: "single",
      sendUpdates: "none",
    });
  });

  it("preserves the connected account through recurring and guest options", () => {
    expect(
      buildDeleteEventMutationInput(
        { id: "google-event-1", accountEmail: "secondary@example.com" },
        {
          scope: "thisAndFollowing",
          sendUpdates: "all",
          notificationMessage: "The meeting is cancelled.",
          removeOnly: false,
        },
      ),
    ).toEqual({
      id: "google-event-1",
      accountEmail: "secondary@example.com",
      scope: "thisAndFollowing",
      sendUpdates: "all",
      notificationMessage: "The meeting is cancelled.",
      removeOnly: false,
    });
  });

  it("keeps the account on quiet cleanup and undo deletes", () => {
    expect(
      buildDeleteEventMutationInput(
        { id: "google-event-2", accountEmail: "secondary@example.com" },
        { scope: "single", sendUpdates: "none" },
      ),
    ).toMatchObject({
      id: "google-event-2",
      accountEmail: "secondary@example.com",
      scope: "single",
      sendUpdates: "none",
    });
  });
});
