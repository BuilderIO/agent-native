// @vitest-environment happy-dom

import type { RecorderReport } from "@agent-native/core/client/recorder";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  report: vi.fn(),
  uploadProblemReport: vi.fn(),
  sendToAgentChat: vi.fn(),
  writeClipboardText: vi.fn(),
}));

vi.mock("@agent-native/core/client/recorder", () => ({
  recorder: { report: mocks.report },
}));
vi.mock("@agent-native/core/client/problem-report", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/problem-report")
  >()),
  uploadProblemReport: mocks.uploadProblemReport,
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: mocks.sendToAgentChat,
}));
vi.mock("@agent-native/toolkit/clipboard", () => ({
  writeClipboardText: mocks.writeClipboardText,
}));

import { useRegisterAgentChatSurface } from "../chat/agent-chat-presence.js";
import { ReportProblemDialog } from "./ReportProblemDialog.js";

const REF = "attachment:v1:report-ref";

function fixture(reason: RecorderReport["reason"]): RecorderReport {
  return {
    app: "mail",
    build: "abc123",
    url: "/inbox",
    at: "2026-10-14T16:20:05.120Z",
    reason,
    windowSeconds: 120,
    events: [
      { t: -3, at: 1, type: "action", name: "list-labels", ok: true },
      {
        t: -0.8,
        at: 2,
        type: "action",
        name: "list-folders",
        ok: false,
        status: 403,
      },
      { t: -0.5, at: 3, type: "error", name: "TypeError" },
    ],
    watched: {},
    pending: [],
    dropped: 0,
  };
}

function AgentChatStandIn() {
  useRegisterAgentChatSurface(true);
  return null;
}

let container: HTMLDivElement;
let root: Root;
const onOpenChange = vi.fn();

function render({ withAgentChat }: { withAgentChat: boolean }) {
  act(() => {
    root.render(
      <>
        {withAgentChat ? <AgentChatStandIn /> : null}
        <ReportProblemDialog open onOpenChange={onOpenChange} />
      </>,
    );
  });
}

function button(name: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!match) throw new Error(`No button named ${name}`);
  return match;
}

async function click(name: string) {
  await act(async () => {
    button(name).click();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.report.mockReset();
  mocks.report.mockImplementation((options?: { reason?: string }) =>
    fixture(options?.reason === "user" ? "user" : "manual"),
  );
  mocks.uploadProblemReport.mockReset();
  mocks.sendToAgentChat.mockReset();
  mocks.writeClipboardText.mockReset();
  onOpenChange.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("ReportProblemDialog", () => {
  it("previews counts, failures and first events without building a user report", () => {
    render({ withAgentChat: true });

    const text = document.body.textContent ?? "";
    expect(text).toContain("Attach what the app did in the last 120 seconds?");
    expect(text).toContain("action 2 · error 1");
    expect(text).toContain("-0.8s  action  list-folders  failed  403");
    expect(text).toContain("-3.0s  action  list-labels  ok");
    expect(mocks.report).toHaveBeenCalledWith();
    expect(mocks.report).not.toHaveBeenCalledWith({ reason: "user" });
  });

  it("attaches the user report and sends the bounded summary to the agent", async () => {
    mocks.uploadProblemReport.mockResolvedValue({ status: "ok", ref: REF });
    render({ withAgentChat: true });

    await click("Send to agent");

    expect(mocks.uploadProblemReport).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "user" }),
    );
    expect(mocks.sendToAgentChat).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.stringContaining(REF),
        submit: true,
        openSidebar: true,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says the report was not attached and retries the same report", async () => {
    mocks.uploadProblemReport.mockResolvedValue({
      status: "failed",
      errorCode: "attachment_storage_unavailable",
      message: "No object storage is connected.",
    });
    render({ withAgentChat: true });

    await click("Send to agent");

    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "The report was not attached. No object storage is connected.",
    );
    expect(mocks.sendToAgentChat).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    mocks.uploadProblemReport.mockResolvedValue({ status: "ok", ref: REF });
    await click("Retry");

    const [first, second] = mocks.uploadProblemReport.mock.calls;
    expect(second[0]).toBe(first[0]);
    expect(
      mocks.report.mock.calls.filter(([options]) => options?.reason === "user"),
    ).toHaveLength(1);
    expect(mocks.sendToAgentChat).toHaveBeenCalledTimes(1);
  });

  it("copies the summary with its ref when the app has no agent chat", async () => {
    mocks.uploadProblemReport.mockResolvedValue({ status: "ok", ref: REF });
    mocks.writeClipboardText.mockResolvedValue(true);
    render({ withAgentChat: false });

    await click("Copy problem report");

    expect(mocks.writeClipboardText).toHaveBeenCalledWith(
      expect.stringContaining(REF),
    );
    expect(mocks.sendToAgentChat).not.toHaveBeenCalled();
    expect(button("Copied")).toBeTruthy();
  });
});
