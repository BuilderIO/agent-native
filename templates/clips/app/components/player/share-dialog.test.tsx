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
import { ShareRecordingDialog, ShareRecordingPopover } from "./share-dialog";

const props = {
  recordingId: "clip-test",
  open: true,
  onOpenChange: () => undefined,
  initialVisibility: "private" as const,
  initialRole: "owner" as const,
  hasPassword: false,
};
describe("recording sharing adoption", () => {
  const harness = shareTestHarness();
  const render = (
    extra: Partial<React.ComponentProps<typeof ShareRecordingDialog>> = {},
  ) => harness.render(<ShareRecordingDialog {...props} {...extra} />);

  // oracle-change: the shared single-panel dialog replaces the People, Agents, Embed and Social tabs.
  it("shows the standard sharing controls without the old tabs", async () => {
    await render();
    expect(document.querySelector('input[role="combobox"]')).not.toBeNull();
    expect(button("General access")).toBeDefined();
    expect(button("Copy link")).toBeDefined();
    expect(button("Send to")).toBeDefined();
    expect(document.querySelector('[role="tab"]')).toBeNull();
  });

  it("summarizes password and expiry beside Advanced", async () => {
    await render({ hasPassword: true, expiresAt: "2030-01-02T12:30:00.000Z" });
    expect(button("shareDialog.advanced").disabled).toBe(false);
    const summary = button("shareDialog.advanced").parentElement!.textContent;
    expect(summary).toContain("shareDialog.passwordSet");
    expect(summary).toContain("shareDialog.expiresOn");
  });

  it("lets editors manage existing protection while viewers cannot", async () => {
    if (!mocks.data) throw new Error("Missing share data");
    mocks.data.role = "editor";
    await render({ hasPassword: true, initialRole: "editor" });
    expect(button("shareDialog.advanced").disabled).toBe(false);
    mocks.data.role = "viewer";
    await render({ hasPassword: true, initialRole: "viewer" });
    expect(button("shareDialog.advanced").disabled).toBe(true);
  });

  it("shares private with the organization at once", async () => {
    await render();
    await select(button("General access"), "Anyone in your organization");
    // oracle-change: recordings no longer ask before opening to the organization; only resource types that set confirmOrgVisibility (chats) show the confirm, cancel and retry dialog
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.visibility).toHaveBeenCalledWith({
      resourceType: "recording",
      resourceId: "clip-test",
      visibility: "org",
    });
  });

  it("narrows public to organization immediately", async () => {
    mocks.data!.visibility = "public";
    await render({ initialVisibility: "public" });
    await select(button("General access"), "Anyone in your organization");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.visibility).toHaveBeenCalledWith({
      resourceType: "recording",
      resourceId: "clip-test",
      visibility: "org",
    });
  });

  it("invites as Viewer with notifications and the recording notification link", async () => {
    await render({ initialRole: undefined, ownerEmail: "OWNER@example.test" });
    await input(
      document.querySelector<HTMLInputElement>('input[role="combobox"]')!,
      "new@example.test",
    );
    expect(
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked,
    ).toBe(true);
    await click(button("Invite"));
    expect(mocks.share).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "recording",
        resourceId: "clip-test",
        principalType: "user",
        principalId: "new@example.test",
        role: "viewer",
        notify: true,
        resourceUrl: expect.stringMatching(
          /\/share\/clip-test\?ref=clip_share&via=test-owner/,
        ),
      }),
      expect.any(Object),
    );
  });

  it("changes roles without notifying and restores a failed removal", async () => {
    await render();
    const row = Array.from(document.querySelectorAll("li")).find((el) =>
      el.textContent?.includes("viewer@example.test"),
    )!;
    await select(button("Role", row), "Can edit");
    expect(mocks.share).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: "viewer@example.test",
        role: "editor",
        notify: false,
      }),
      expect.any(Object),
    );
    await act(async () =>
      mocks.share.mock.calls[0][1].onError(new Error("role denied")),
    );
    expect(row.textContent).toContain("Can view");
    await select(button("Role", row), "Remove access");
    expect(mocks.unshare).toHaveBeenCalledWith(
      {
        resourceType: "recording",
        resourceId: "clip-test",
        principalType: "user",
        principalId: "viewer@example.test",
      },
      expect.any(Object),
    );
    await act(async () =>
      mocks.unshare.mock.calls[0][1].onError(new Error("remove denied")),
    );
    expect(document.body.textContent).toContain("viewer@example.test");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "remove denied",
    );
  });

  it("allows an existing password and expiry to be removed", async () => {
    await render({ hasPassword: true, expiresAt: "2030-01-02T12:30:00.000Z" });
    await click(button("shareDialog.advanced"));
    await click(document.getElementById("share-password-required")!);
    expect(mocks.update).toHaveBeenCalledWith(
      { id: "clip-test", password: null },
      expect.any(Object),
    );
    await input(
      document.getElementById("share-expiry") as HTMLInputElement,
      "",
    );
    const saves = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((el) => el.textContent === "common.save");
    const save = saves.at(-1);
    if (!save) throw new Error("Missing expiry save button");
    await click(save);
    expect(mocks.update).toHaveBeenCalledWith(
      { id: "clip-test", expiresAt: null },
      expect.any(Object),
    );
  });

  it("does not offer password setup for an unprotected recording", async () => {
    await render();
    expect(document.getElementById("share-password-required")).toBeNull();
  });

  it("does not offer agent handoffs to a password-protected viewer", async () => {
    await render({
      viewerReshareOnly: true,
      initialRole: "viewer",
      initialVisibility: "public",
      hasPassword: true,
    });
    expect(
      Array.from(document.querySelectorAll("button")).some((el) =>
        el.textContent.includes("Send to"),
      ),
    ).toBe(false);
    expect(mocks.createLink).not.toHaveBeenCalled();
    expect(
      mocks.query.mock.calls
        .filter(([name]) => name === "list-resource-shares")
        .every(([, , options]) => options.enabled === false),
    ).toBe(true);
    expect(document.querySelector('input[role="combobox"]')).toBeNull();
    expect(button("Copy link")).toBeDefined();
  });

  it("keeps public viewer handoffs without loading permissions", async () => {
    await render({
      viewerReshareOnly: true,
      initialRole: "viewer",
      initialVisibility: "public",
      hasPassword: false,
    });
    expect(
      mocks.query.mock.calls
        .filter(([name]) => name === "list-resource-shares")
        .every(([, , options]) => options.enabled === false),
    ).toBe(true);
    expect(button("Send to")).toBeDefined();
    expect(document.querySelector('input[role="combobox"]')).toBeNull();
  });

  it("copies an agent prompt using a scoped link", async () => {
    await render();
    await act(async () => {
      button("Send to").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((el) => el.textContent.includes("Copy agent prompt"));
    if (!item) throw new Error("Missing agent prompt action");
    await click(item);
    expect(mocks.createLink).toHaveBeenCalledWith({ recordingId: "clip-test" });
    expect(mocks.clipboard).toHaveBeenCalledWith("shareDialog.agentPrompt");
  });

  it("quick copies the attributed human link and records its scope", async () => {
    await harness.render(
      <ShareRecordingPopover {...props}>
        <button>Open sharing</button>
      </ShareRecordingPopover>,
    );
    await click(button("recordRoute.copyLinkAction"));
    expect(mocks.clipboard).toHaveBeenCalledWith(
      "http://localhost:3000/share/clip-test?ref=clip_share&via=test-owner",
    );
    expect(mocks.track).toHaveBeenCalledWith(
      "share_link_copied",
      expect.objectContaining({
        resource_id: "clip-test",
        link_type: "share",
        link_scope: "private",
      }),
    );
  });

  it("blocks sharing while redactions are pending", async () => {
    await harness.render(
      <ShareRecordingPopover {...props} pendingRedactions={2}>
        <button>Open sharing</button>
      </ShareRecordingPopover>,
    );
    expect(document.body.textContent).toContain(
      "shareDialog.redactionsPendingTitle",
    );
    expect(document.querySelector('input[role="combobox"]')).toBeNull();
    await click(button("recordRoute.copyLinkAction"));
    expect(mocks.clipboard).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
