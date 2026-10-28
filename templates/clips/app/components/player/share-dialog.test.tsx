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
const tabs = () =>
  Array.from(document.querySelectorAll('[role="tab"]')).map(
    (tab) => tab.textContent,
  );

describe("recording sharing adoption", () => {
  const harness = shareTestHarness();
  const render = (
    extra: Partial<React.ComponentProps<typeof ShareRecordingDialog>> = {},
  ) => harness.render(<ShareRecordingDialog {...props} {...extra} />);

  it("orders the owner's tabs People, Agents, Embed, Social", async () => {
    await render();
    expect(tabs()).toEqual([
      "shareDialog.people",
      "shareDialog.agents",
      "shareDialog.embed",
      "shareDialog.social",
    ]);
  });

  it("summarizes password and expiry beside Advanced", async () => {
    await render({ hasPassword: true, expiresAt: "2030-01-02T12:30:00.000Z" });
    expect(button("shareDialog.advanced").disabled).toBe(false);
    const summary = button("shareDialog.advanced").parentElement!.textContent;
    expect(summary).toContain("shareDialog.passwordSet");
    expect(summary).toContain("shareDialog.expiresOn");
  });

  it("holds private to organization, cancels, then retries a failed confirmation", async () => {
    await render();
    await select(button("General access"), "Organization");
    expect(mocks.visibility).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await click(button("Cancel"));
    expect(mocks.visibility).not.toHaveBeenCalled();
    await select(button("General access"), "Organization");
    mocks.visibility.mockRejectedValueOnce(new Error("save unavailable"));
    await click(button("Share with organization"));
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain("save unavailable");
    await click(button("Retry"));
    expect(mocks.visibility).toHaveBeenCalledTimes(2);
    expect(mocks.visibility).toHaveBeenLastCalledWith({
      resourceType: "recording",
      resourceId: "clip-test",
      visibility: "org",
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("narrows public to organization immediately", async () => {
    mocks.data!.visibility = "public";
    await render({ initialVisibility: "public" });
    await select(button("General access"), "Organization");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.visibility).toHaveBeenCalledWith({
      resourceType: "recording",
      resourceId: "clip-test",
      visibility: "org",
    });
  });

  it("invites as Viewer with notifications and the recording notification link", async () => {
    await render();
    await input(
      document.querySelector<HTMLInputElement>('input[role="combobox"]')!,
      "new@example.test",
    );
    expect(
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked,
    ).toBe(true);
    await click(button("Add"));
    expect(mocks.share).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "recording",
        resourceId: "clip-test",
        principalType: "user",
        principalId: "new@example.test",
        role: "viewer",
        notify: true,
        resourceUrl: expect.stringContaining("/r/clip-test"),
      }),
      expect.any(Object),
    );
  });

  it("changes roles without notifying and restores a failed removal", async () => {
    await render();
    const row = Array.from(document.querySelectorAll("li")).find((el) =>
      el.textContent?.includes("viewer@example.test"),
    )!;
    await select(button("Role", row), "Editor");
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
    expect(row.textContent).toContain("Viewer");
    await click(button("Remove", row));
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

  it("preserves password and expiry writes independently of sharing", async () => {
    await render();
    await click(document.getElementById("share-password-required")!);
    await input(
      document.querySelector<HTMLInputElement>(
        'input[aria-label="playerSettings.passwordProtection"]',
      )!,
      "fake-test-password",
    );
    await click(button("common.save"));
    expect(mocks.update).toHaveBeenCalledWith(
      { id: "clip-test", password: "fake-test-password" },
      expect.any(Object),
    );
    const expiry = document.getElementById("share-expiry") as HTMLInputElement;
    await input(expiry, "2030-01-02T12:30");
    const saveButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((el) => el.textContent === "common.save");
    await click(saveButtons[saveButtons.length - 1]!);
    expect(
      mocks.update.mock.calls[mocks.update.mock.calls.length - 1]?.[0],
    ).toEqual({
      id: "clip-test",
      expiresAt: new Date("2030-01-02T12:30").toISOString(),
    });
    expect(mocks.visibility).not.toHaveBeenCalled();
  });

  it("points a private clip's embed back to General access", async () => {
    await render();
    await click(button("shareDialog.embed"));
    expect(button("shareDialog.copyEmbedCode").disabled).toBe(true);
    await click(button("shareDialog.changeGeneralAccess"));
    expect(
      document.querySelector('[role="tab"][data-state="active"]')?.textContent,
    ).toBe("shareDialog.people");
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    expect(mocks.visibility).not.toHaveBeenCalled();
  });

  it("asks an editor to have the owner open access instead", async () => {
    mocks.data!.role = "editor";
    await render({ initialRole: "editor" });
    await click(button("shareDialog.embed"));
    expect(document.body.textContent).toContain("shareDialog.askOwnerPublic");
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (el) => el.textContent === "shareDialog.changeGeneralAccess",
      ),
    ).toBe(false);
  });

  it("copies a public clip's embed code with its timestamp and autoplay", async () => {
    mocks.data!.visibility = "public";
    await render({ initialVisibility: "public" });
    await click(button("shareDialog.embed"));
    await click(button("shareDialog.customizeEmbed"));
    await click(document.querySelector<HTMLElement>('[role="switch"]')!);
    await input(
      document.querySelector<HTMLInputElement>('input[type="number"]')!,
      "42",
    );
    await click(button("shareDialog.copyEmbedCode"));
    expect(
      mocks.clipboard.mock.calls[mocks.clipboard.mock.calls.length - 1]?.[0],
    ).toContain("?autoplay=1&t=42");
  });

  it("shows known recording access while share details load without granting manage rights", async () => {
    mocks.data = undefined;
    await render({ initialVisibility: "public" });
    expect(button("General access").textContent).toContain(
      "Anyone with the link can view",
    );
    expect(button("General access").disabled).toBe(true);
    expect(document.querySelector('input[role="combobox"]')).toBeNull();
  });

  it("keeps protected viewer reshares out of the Agents tab", async () => {
    mocks.data = undefined;
    await render({
      viewerReshareOnly: true,
      initialRole: "viewer",
      initialVisibility: "public",
      hasPassword: true,
    });
    expect(tabs()).toEqual(["shareDialog.embed", "shareDialog.social"]);
    expect(mocks.createLink).not.toHaveBeenCalled();
    expect(mocks.visibility).not.toHaveBeenCalled();
  });

  it("keeps editor access options while disallowing invite and visibility writes", async () => {
    mocks.data!.role = "editor";
    await render({ initialRole: "editor" });
    expect(document.querySelector('input[role="combobox"]')).toBeNull();
    expect(button("General access").disabled).toBe(true);
    expect(
      (document.getElementById("share-password-required") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(document.querySelector('button[aria-label="Remove"]')).toBeNull();
  });

  it("does not fetch share details for viewer reshares and keeps unprotected agent handoff", async () => {
    mocks.data = undefined;
    await render({
      viewerReshareOnly: true,
      initialRole: "viewer",
      initialVisibility: "public",
    });
    expect(
      mocks.query.mock.calls
        .filter(([name]) => name === "list-resource-shares")
        .every(([, , options]) => options.enabled === false),
    ).toBe(true);
    expect(document.querySelector('input[role="combobox"]')).toBeNull();
    await click(button("shareDialog.agents"));
    await click(button("shareDialog.copyAgentPrompt"));
    expect(mocks.clipboard).toHaveBeenCalled();
    expect(mocks.createLink).not.toHaveBeenCalled();
    expect(mocks.visibility).not.toHaveBeenCalled();
  });

  it("hides all share controls and blocks quick copy while redactions are pending", async () => {
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
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
