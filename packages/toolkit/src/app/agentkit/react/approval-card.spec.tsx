// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit";
import {
  approvalResponseFromResume,
  type AgentApprovalRequest,
  type AgentTransport,
  type ResumeRunInput,
} from "@agent-native/agentkit/protocol";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  approvalOptionDecision,
  approvalRequestKind,
} from "./approval-card.js";
import { AgentApprovalPrompt } from "./components.js";
import { AgentKitProvider } from "./context.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const deleteBranches: AgentApprovalRequest = {
  id: "approval-delete",
  title: "Delete 14 branches?",
  kind: "approval",
  options: [
    { id: "approve", label: "Delete branches", kind: "danger" },
    { id: "deny", label: "Cancel", kind: "secondary" },
  ],
};

function createClient() {
  const resumeRun = vi.fn(async (_input: ResumeRunInput) => ({
    runId: "run-resumed",
  }));
  const transport: AgentTransport = {
    capabilities: { approvals: true },
    async startRun() {
      return { runId: "run-new" };
    },
    async assertAiSetupReady() {},
    async *subscribeToRun() {},
    async cancelRun() {},
    resumeRun,
  };
  return { client: new AgentKitClient({ transport }), resumeRun };
}

async function renderPrompt(
  client: AgentKitClient,
  request: AgentApprovalRequest,
) {
  await act(async () =>
    root.render(
      <AgentKitProvider controller={client} threadId="thread-1">
        <AgentApprovalPrompt request={request} runId="run-1" />
      </AgentKitProvider>,
    ),
  );
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  expect(found).toBeDefined();
  return found!;
}

async function press(label: string) {
  await act(async () => {
    button(label).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** What the Core runtime reads when it continues the turn. */
function serverDecision(
  resumeRun: ReturnType<typeof createClient>["resumeRun"],
) {
  const input = resumeRun.mock.calls.at(-1)?.[0];
  expect(input?.resume).toHaveLength(1);
  return approvalResponseFromResume(input!.resume[0]!);
}

describe("approval decisions", () => {
  it("sends Cancel as a deny through the transport", async () => {
    const { client, resumeRun } = createClient();
    await renderPrompt(client, deleteBranches);

    expect(container.querySelector('[role="radio"]')).toBeNull();
    expect(container.textContent).not.toContain("Submit");
    expect(container.textContent).not.toContain("Other");

    await press("Cancel");

    expect(resumeRun).toHaveBeenCalledOnce();
    expect(resumeRun.mock.calls[0]![0]).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
      resume: [{ interruptId: "approval-delete", status: "resolved" }],
    });
    expect(serverDecision(resumeRun)).toEqual({
      decision: "deny",
      optionIds: ["deny"],
    });
  });

  it("sends the approving option as an approve in one click", async () => {
    const { client, resumeRun } = createClient();
    await renderPrompt(client, deleteBranches);

    await press("Delete branches");

    expect(serverDecision(resumeRun)).toEqual({
      decision: "approve",
      optionIds: ["approve"],
    });
  });

  it("renders an untyped approve and deny pair as one-click decisions", async () => {
    const { client, resumeRun } = createClient();
    await renderPrompt(client, {
      id: "approval-untyped-pair",
      title: "Run the migration?",
      options: [
        { id: "approve", label: "Run it" },
        { id: "deny", label: "Not now" },
      ],
    });

    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(container.textContent).not.toContain("Submit");
    expect(button("Run it").getAttribute("data-approval-action")).toBe(
      "approve",
    );

    await press("Not now");
    expect(serverDecision(resumeRun)).toEqual({
      decision: "deny",
      optionIds: ["deny"],
    });
  });

  it("keeps other untyped options as a choice list with Other", async () => {
    const { client, resumeRun } = createClient();
    await renderPrompt(client, {
      id: "approval-untyped",
      title: "Run the migration?",
      options: [
        { id: "allow-once", label: "Allow once" },
        { id: "reject", label: "Not now" },
      ],
    });

    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(button("Other")).toBeDefined();
    expect(button("Submit").disabled).toBe(true);

    await press("Allow once");
    await press("Submit");
    expect(serverDecision(resumeRun)).toEqual({
      decision: "approve",
      optionIds: ["allow-once"],
    });
  });

  it("honors allowMultiple on an untyped choice list", async () => {
    const { client, resumeRun } = createClient();
    await renderPrompt(client, {
      id: "approval-untyped-multi",
      title: "Which checks should run?",
      allowMultiple: true,
      allowOther: false,
      options: [
        { id: "lint", label: "Lint" },
        { id: "tests", label: "Tests" },
      ],
    });

    expect(container.querySelector('[role="group"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Other");
    await press("Lint");
    await press("Tests");
    expect(button("Lint").getAttribute("aria-pressed")).toBe("true");
    expect(button("Tests").getAttribute("aria-pressed")).toBe("true");

    await press("Submit");
    expect(serverDecision(resumeRun)).toEqual({
      decision: "approve",
      optionIds: ["lint", "tests"],
    });
  });

  it("keeps an input request with options as a choice list", async () => {
    const { client, resumeRun } = createClient();
    await renderPrompt(client, {
      id: "input-options",
      title: "Where should the report go?",
      kind: "input",
      input: { id: "note", label: "Note" },
      options: [
        { id: "email", label: "Email" },
        { id: "slack", label: "Slack" },
      ],
    });

    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3);
    await type(
      container.querySelector<HTMLInputElement>("input:not([placeholder])")!,
      "Weekly",
    );
    await press("Slack");
    await press("Submit");
    expect(serverDecision(resumeRun)).toEqual({
      decision: "approve",
      optionIds: ["slack"],
      input: { note: "Weekly" },
    });
  });

  it("keeps a required input from blocking a denial", async () => {
    const { client, resumeRun } = createClient();
    await renderPrompt(client, {
      id: "approval-input",
      title: "Publish the release?",
      kind: "approval",
      input: { id: "note", label: "Release note", required: true },
      options: [
        { id: "publish", label: "Publish", kind: "primary" },
        { id: "cancel", label: "Cancel" },
      ],
    });

    expect(button("Publish").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(false);

    await type(container.querySelector("input")!, "October patch");
    expect(button("Publish").disabled).toBe(false);

    await press("Cancel");
    expect(serverDecision(resumeRun)).toEqual({
      decision: "deny",
      optionIds: ["cancel"],
      input: { note: "October patch" },
    });
  });

  it("offers Other on an approval only when the request asks for it", async () => {
    const { client, resumeRun } = createClient();
    await renderPrompt(client, { ...deleteBranches, allowOther: true });

    const other = container.querySelector<HTMLInputElement>(
      'input[placeholder="Type your answer"]',
    );
    expect(other).not.toBeNull();
    await type(other!, "Only the merged ones");

    await press("Delete branches");
    expect(serverDecision(resumeRun)).toEqual({
      decision: "approve",
      optionIds: ["approve"],
      other: "Only the merged ones",
    });
  });

  it("keeps the default Approve and Deny for an approval without options", async () => {
    const { client, resumeRun } = createClient();
    await renderPrompt(client, {
      id: "approval-default",
      title: "Apply the release changes?",
    });

    expect(
      [...container.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual(["Approve", "Deny"]);
    expect(container.textContent).toContain("Approval needed");

    await press("Deny");
    expect(serverDecision(resumeRun)).toEqual({
      decision: "deny",
      optionIds: ["deny"],
    });
  });

  it("keeps a choice prompt as a pick-then-submit list", async () => {
    const { client } = createClient();
    await renderPrompt(client, {
      id: "choice-1",
      title: "Which environment?",
      kind: "choice",
      options: [{ id: "staging", label: "Staging" }],
    });

    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(2);
    expect(button("Submit").disabled).toBe(true);
    expect(container.textContent).toContain("Answer needed");
  });
});

describe("approvalOptionDecision", () => {
  it.each(["deny", "Cancel", "reject", "decline", "no"])(
    "reads %s as a denial",
    (id) => expect(approvalOptionDecision({ id })).toBe("deny"),
  );

  it.each(["approve", "allow-once", "delete", "cancel-subscription"])(
    "reads %s as an approval",
    (id) => expect(approvalOptionDecision({ id })).toBe("approve"),
  );
});

describe("approvalRequestKind", () => {
  const option = (id: string) => ({ id, label: id });

  it("treats an untyped request with a field as input", () => {
    expect(approvalRequestKind({ input: { id: "name" } })).toBe("input");
    expect(approvalRequestKind({})).toBe("approval");
    expect(approvalRequestKind({ kind: "input" })).toBe("approval");
    expect(approvalRequestKind({ kind: "choice" })).toBe("choice");
  });

  it("reads only the bare approve and deny pair as an untyped approval", () => {
    expect(
      approvalRequestKind({ options: [option("deny"), option("approve")] }),
    ).toBe("approval");
    expect(
      approvalRequestKind({ options: [option("approve"), option("cancel")] }),
    ).toBe("choice");
    expect(approvalRequestKind({ options: [option("approve")] })).toBe(
      "choice",
    );
    expect(
      approvalRequestKind({
        options: [option("approve"), option("deny"), option("later")],
      }),
    ).toBe("choice");
  });

  it("keeps explicit kinds, with options turning input into a choice list", () => {
    expect(
      approvalRequestKind({ kind: "approval", options: [option("publish")] }),
    ).toBe("approval");
    expect(
      approvalRequestKind({
        kind: "input",
        input: { id: "note" },
        options: [option("approve"), option("deny")],
      }),
    ).toBe("choice");
    expect(approvalRequestKind({ kind: "input", input: { id: "name" } })).toBe(
      "input",
    );
  });
});
