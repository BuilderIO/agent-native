// @vitest-environment happy-dom
import React from "react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import {
  button,
  click,
  input,
  mocks,
  select,
  shareTestHarness,
} from "../sharing/share-test-support";
import { ShareMeetingPopover } from "./share-meeting-dialog";

describe("meeting sharing adoption", () => {
  const harness = shareTestHarness();
  const render = (transcriptReady = true) =>
    harness.render(
      <ShareMeetingPopover
        meetingId="meeting-test"
        shareTranscript={false}
        transcriptReady={transcriptReady}
      >
        <button>Share meeting</button>
      </ShareMeetingPopover>,
    );
  it("confirms organization access before saving and defaults invites to notified Viewer", async () => {
    await render();
    await select(button("General access"), "Anyone in your organization");
    expect(mocks.visibility).not.toHaveBeenCalled();
    await click(button("Share with organization"));
    expect(mocks.visibility).toHaveBeenCalledWith({
      resourceType: "meeting",
      resourceId: "meeting-test",
      visibility: "org",
    });
    await input(
      document.querySelector<HTMLInputElement>('input[role="combobox"]')!,
      "invite@example.test",
    );
    await click(button("Invite"));
    expect(mocks.share).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "meeting",
        resourceId: "meeting-test",
        role: "viewer",
        notify: true,
      }),
      expect.any(Object),
    );
  });
  it("keeps People and Agents as the meeting tabs and copies the share link from the button", async () => {
    await render();
    expect(
      Array.from(document.querySelectorAll('[role="tab"]')).map(
        (tab) => tab.textContent,
      ),
    ).toEqual(["shareDialog.people", "shareDialog.agents"]);
    await click(button("recordRoute.copyLinkAction"));
    expect(mocks.clipboard).toHaveBeenCalledWith(
      expect.stringContaining("/share/meeting/meeting-test"),
    );
  });
  it("keeps transcript opt-in separate and rolls back failed saves", async () => {
    await render();
    expect(document.body.textContent).toContain(
      "shareMeeting.linkShowsNotesOnly",
    );
    const toggle = document.getElementById(
      "meeting-share-transcript-meeting-test",
    )!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await click(toggle);
    expect(mocks.update).toHaveBeenCalledWith(
      { id: "meeting-test", shareTranscript: true },
      expect.any(Object),
    );
    expect(document.body.textContent).toContain(
      "shareMeeting.linkShowsTranscript",
    );
    await act(async () =>
      mocks.update.mock.calls[0][1].onError(new Error("transcript denied")),
    );
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(mocks.visibility).not.toHaveBeenCalled();
  });
  it("disables unavailable transcripts and uses a scoped agent link for private meetings", async () => {
    await render(false);
    expect(
      (
        document.getElementById(
          "meeting-share-transcript-meeting-test",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mocks.createLink).not.toHaveBeenCalled();
    await click(button("shareDialog.agents"));
    expect(mocks.createLink).toHaveBeenCalledWith({
      resourceType: "meeting",
      resourceId: "meeting-test",
    });
    await click(button("shareMeeting.copyAgentLink"));
    expect(mocks.clipboard).toHaveBeenCalledWith(
      "https://clips.example.test/scoped-agent",
    );
  });
});
