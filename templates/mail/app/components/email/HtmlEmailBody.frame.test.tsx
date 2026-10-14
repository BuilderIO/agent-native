// @vitest-environment happy-dom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@/hooks/use-emails", () => ({
  useSettings: () => ({ data: { imagePolicy: "show", trustedSenders: [] } }),
  useUpdateSettings: () => ({ mutate: vi.fn() }),
}));

import { HtmlEmailBody } from "./EmailThread";

function bodyFrame(container: HTMLElement) {
  const frame = container.querySelector("iframe");
  if (!frame) throw new Error("email body frame not rendered");
  return frame;
}

function isShowing(container: HTMLElement) {
  return (
    bodyFrame(container).parentElement?.getAttribute("aria-busy") === "false"
  );
}

describe("HtmlEmailBody frame", () => {
  // A remote image that never responds keeps the frame's load event from firing.
  beforeEach(() => {
    const addEventListener = HTMLIFrameElement.prototype.addEventListener;
    vi.spyOn(
      HTMLIFrameElement.prototype,
      "addEventListener",
    ).mockImplementation(function (this: HTMLIFrameElement, ...args) {
      if (args[0] === "load") return;
      addEventListener.apply(this, args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("shows the email once it is parsed, without waiting for images", async () => {
    const { container } = render(
      <HtmlEmailBody html='<p>Statement ready</p><img src="https://tracker.example/pixel.gif">' />,
    );

    await waitFor(() => expect(isShowing(container)).toBe(true));
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(bodyFrame(container).contentDocument?.body.textContent).toContain(
      "Statement ready",
    );
  });

  it("puts changed content in a new frame instead of navigating the open one", async () => {
    const { container, rerender } = render(
      <HtmlEmailBody html="<p>First version</p>" />,
    );
    await waitFor(() => expect(isShowing(container)).toBe(true));
    const firstFrame = bodyFrame(container);

    rerender(<HtmlEmailBody html="<p>Second version</p>" />);

    const secondFrame = bodyFrame(container);
    expect(secondFrame).not.toBe(firstFrame);
    expect(firstFrame.isConnected).toBe(false);
    await waitFor(() => expect(isShowing(container)).toBe(true));
    expect(secondFrame.contentDocument?.body.textContent).toContain(
      "Second version",
    );
  });

  it("waits for the new frame when content changes back before the change shows", async () => {
    const { container, rerender } = render(
      <HtmlEmailBody html="<p>Version A</p>" />,
    );
    await waitFor(() => expect(isShowing(container)).toBe(true));
    const firstFrame = bodyFrame(container);

    rerender(<HtmlEmailBody html="<p>Version B</p>" />);
    rerender(<HtmlEmailBody html="<p>Version A</p>" />);

    const remounted = bodyFrame(container);
    expect(remounted).not.toBe(firstFrame);
    await waitFor(() => expect(isShowing(container)).toBe(true));
    expect(remounted.contentDocument?.body.textContent).toContain("Version A");
  });

  it("keeps the open frame when the content is unchanged", async () => {
    const html = "<p>Same content</p>";
    const { container, rerender } = render(<HtmlEmailBody html={html} />);
    await waitFor(() => expect(isShowing(container)).toBe(true));
    const frame = bodyFrame(container);
    const srcdocChanges: MutationRecord[] = [];
    const observer = new MutationObserver((records) =>
      srcdocChanges.push(...records),
    );
    observer.observe(frame, { attributes: true, attributeFilter: ["srcdoc"] });

    rerender(<HtmlEmailBody html={`${html}`} senderEmail="a@example.com" />);

    expect(bodyFrame(container)).toBe(frame);
    expect(isShowing(container)).toBe(true);
    observer.disconnect();
    expect(srcdocChanges).toHaveLength(0);
  });
});
