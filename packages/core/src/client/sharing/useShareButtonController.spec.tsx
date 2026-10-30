// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useShareButtonController,
  type ShareButtonController,
  type ShareButtonSharesResponse,
} from "./useShareButtonController.js";

const mocks = vi.hoisted(() => ({
  query: {
    data: undefined as ShareButtonSharesResponse | undefined,
    refetch: vi.fn(async () => undefined),
  },
  share: { mutate: vi.fn() },
  other: { mutate: vi.fn(), mutateAsync: vi.fn() },
}));

vi.mock("../use-action.js", () => ({
  useActionQuery: vi.fn(() => mocks.query),
  useActionMutation: vi.fn((name: string) =>
    name === "share-resource" ? mocks.share : mocks.other,
  ),
}));

const reviewer = { email: "svc-reviewer@service.org-1", name: "reviewer" };
const writer = { email: "svc-writer@service.org-1", name: "writer" };
const sharedAgent = { email: "svc-shared@service.org-1", name: "shared" };

interface ShareCall {
  principalType: string;
  principalId: string;
  role: string;
  notify: boolean;
  message?: string;
}

describe("useShareButtonController agents", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let controller: ShareButtonController | undefined;

  function Harness() {
    controller = useShareButtonController({
      resourceType: "deck",
      resourceId: "deck-1",
    });
    return null;
  }

  function current(): ShareButtonController {
    if (!controller) throw new Error("The controller did not render");
    return controller;
  }

  async function render() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    act(() => current().handleOpenChange(true));
  }

  function lastShareCall(): {
    args: ShareCall;
    callbacks: { onError?: (error: unknown) => void };
  } {
    const call = mocks.share.mutate.mock.calls.at(-1);
    if (!call) throw new Error("share-resource was not called");
    return { args: call[0] as ShareCall, callbacks: call[1] ?? {} };
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ members: [] }),
      }),
    );
    mocks.query.data = {
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      visibility: "private",
      role: "owner",
      shares: [
        {
          id: "share-1",
          principalType: "user",
          principalId: sharedAgent.email,
          displayName: sharedAgent.name,
          agent: true,
          role: "viewer",
        },
      ],
      agents: [reviewer, writer, sharedAgent],
    };
    mocks.share.mutate.mockReset();
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
    controller = undefined;
  });

  it("suggests the org's agents that do not have access yet, filtered by name", async () => {
    await render();
    expect(current().agentSuggestions).toEqual([reviewer, writer]);

    act(() => current().setInviteEmail("WRI"));
    expect(current().agentSuggestions).toEqual([writer]);
  });

  it("invites a picked agent by its service email without notifying it", async () => {
    await render();
    act(() => current().selectAgent(reviewer));
    expect(current().inviteEmail).toBe("reviewer");
    expect(current().selectedAgent).toEqual(reviewer);

    act(() => {
      current().setShareMessage("please review");
      current().setRole("editor");
    });
    act(() => current().handleAdd());

    expect(lastShareCall().args).toMatchObject({
      principalType: "user",
      principalId: reviewer.email,
      role: "editor",
      notify: false,
    });
    expect(lastShareCall().args.message).toBeUndefined();
    expect(current().shares).toContainEqual(
      expect.objectContaining({
        principalId: reviewer.email,
        displayName: "reviewer",
        agent: true,
      }),
    );
    expect(current().inviteEmail).toBe("");
    expect(current().selectedAgent).toBeNull();
  });

  it("puts the picked agent back when the invite fails", async () => {
    await render();
    act(() => current().selectAgent(writer));
    act(() => current().handleAdd());

    act(() => lastShareCall().callbacks.onError?.(new Error("refused")));

    expect(current().selectedAgent).toEqual(writer);
    expect(current().inviteEmail).toBe("writer");
    expect(current().shares.map((share) => share.principalId)).not.toContain(
      writer.email,
    );
  });

  it("drops the picked agent once the field is edited or a group is picked", async () => {
    await render();
    act(() => current().selectAgent(writer));
    act(() => current().setInviteEmail("person@example.test"));
    expect(current().selectedAgent).toBeNull();

    act(() => current().selectAgent(writer));
    act(() => current().selectGroup({ id: "group-1", name: "Design" }));
    expect(current().selectedAgent).toBeNull();
    expect(current().selectedGroup).toEqual({ id: "group-1", name: "Design" });

    act(() => current().selectAgent(reviewer));
    expect(current().selectedGroup).toBeNull();
  });

  it("notifies a typed person and keeps their message", async () => {
    await render();
    act(() => {
      current().setInviteEmail("person@example.test");
      current().setShareMessage("hello");
    });
    act(() => current().handleAdd());

    expect(lastShareCall().args).toMatchObject({
      principalType: "user",
      principalId: "person@example.test",
      notify: true,
      message: "hello",
    });
  });
});
