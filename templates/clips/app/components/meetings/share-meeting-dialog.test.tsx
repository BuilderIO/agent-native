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
  it("shares with the organization at once and defaults invites to notified Viewer", async () => {
    await render();
    await click(button("Share"));
    await select(button("General access"), "Anyone in your organization");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
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
  it("uses the shared panel and copies the meeting link from the button", async () => {
    await render();
    await click(button("recordRoute.copyLinkAction"));
    expect(mocks.clipboard).toHaveBeenCalledWith(
      expect.stringContaining("/share/meeting/meeting-test"),
    );
    expect(mocks.track).toHaveBeenCalledWith(
      "share_link_copied",
      expect.objectContaining({
        resource_type: "meeting",
        resource_id: "meeting-test",
      }),
    );
    await click(button("Share"));
    expect(document.body.textContent).toContain("People with access");
    expect(document.body.textContent).toContain("General access");
  });
  it("keeps transcript opt-in separate and rolls back failed saves", async () => {
    await render();
    await click(button("Share"));
    expect(document.body.textContent).toContain(
      "shareMeeting.linkShowsNotesOnly",
    );
    await click(button("shareDialog.advanced"));
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
    if (!mocks.data) throw new Error("Missing share data");
    mocks.data = { ...mocks.data, agentReadable: true };
    await render(false);
    await click(button("Share"));
    await click(button("shareDialog.advanced"));
    expect(
      (
        document.getElementById(
          "meeting-share-transcript-meeting-test",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mocks.createLink).not.toHaveBeenCalled();
    await act(async () =>
      button("Send to").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(mocks.createLink).toHaveBeenCalledWith({
      resourceType: "meeting",
      resourceId: "meeting-test",
    });
    const agentLink = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent.includes("shareMeeting.copyAgentLink"));
    if (!agentLink) throw new Error("Missing agent link action");
    await click(agentLink);
    expect(mocks.clipboard).toHaveBeenCalledWith(
      "https://clips.example.test/scoped-agent",
    );
  });
});
