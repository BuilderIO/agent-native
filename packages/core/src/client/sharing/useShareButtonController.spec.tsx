// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createShareQueryKey } from "./share-controller-helpers.js";
import {
  useShareButtonController,
  type ShareButtonController,
  type ShareButtonSharesResponse,
} from "./useShareButtonController.js";

interface PendingShare {
  args: ShareCall;
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
}

const mocks = vi.hoisted(() => ({
  query: {
    data: undefined as ShareButtonSharesResponse | undefined,
    refetch: vi.fn(async () => undefined),
  },
  shareCalls: [] as PendingShare[],
}));

// A real mutation hook, so overlapping saves behave as they do in the app:
// a second call on the same hook replaces the observer of the first.
vi.mock("../use-action.js", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useActionQuery: vi.fn(() => mocks.query),
    useActionMutation: (name: string) =>
      useMutation({
        mutationFn: (args: ShareCall) =>
          new Promise((resolve, reject) => {
            if (name === "share-resource") {
              mocks.shareCalls.push({ args, resolve, reject });
            }
          }),
      }),
  };
});

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

  function Harness({ resourceId }: { resourceId: string }) {
    controller = useShareButtonController({
      resourceType: "deck",
      resourceId,
    });
    return null;
  }

  function current(): ShareButtonController {
    if (!controller) throw new Error("The controller did not render");
    return controller;
  }

  async function render(resourceId = "deck-1") {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness resourceId={resourceId} />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    act(() => current().handleOpenChange(true));
  }

  function lastShareCall(): PendingShare {
    const call = mocks.shareCalls.at(-1);
    if (!call) throw new Error("share-resource was not called");
    return call;
  }

  async function settle(run: () => void) {
    await act(async () => {
      run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
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
    mocks.shareCalls = [];
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
    await settle(() => current().handleAdd());

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
    await settle(() => current().handleAdd());

    const failed = lastShareCall();
    await settle(() => failed.reject(new Error("refused")));

    expect(current().selectedAgent).toEqual(writer);
    expect(current().inviteEmail).toBe("writer");
    expect(current().shares.map((share) => share.principalId)).not.toContain(
      writer.email,
    );
  });

  it("leaves a failed invite behind when the panel has moved to another resource", async () => {
    await render("deck-1");
    act(() => current().selectAgent(writer));
    await settle(() => current().handleAdd());
    const failed = lastShareCall();

    await render("deck-2");
    await settle(() => failed.reject(new Error("refused")));

    expect(current().selectedAgent).toBeNull();
    expect(current().inviteEmail).toBe("");
    expect(current().shareError).toBeNull();
  });

  it("ignores a save from an earlier visit after switching away and back", async () => {
    await render("deck-1");
    act(() => current().selectAgent(writer));
    await settle(() => current().handleAdd());
    const staleInvite = lastShareCall();

    await render("deck-2");
    await render("deck-1");
    act(() => current().selectAgent(reviewer));
    await settle(() => current().handleAdd());

    await settle(() => staleInvite.reject(new Error("refused")));

    expect(current().selectedAgent).toBeNull();
    expect(current().inviteEmail).toBe("");
    expect(current().shareError).toBeNull();
    expect(current().inFlight.size).toBe(1);
    expect(current().shares.map((share) => share.principalId)).toContain(
      reviewer.email,
    );
  });

  it("keeps a pending invite on its own resource when the panel moves on", async () => {
    await render("deck-1");
    act(() => current().selectAgent(writer));
    await settle(() => current().handleAdd());
    expect(current().shares.map((share) => share.principalId)).toContain(
      writer.email,
    );
    const firstInvite = lastShareCall();

    await render("deck-2");
    expect(current().shares.map((share) => share.principalId)).not.toContain(
      writer.email,
    );
    expect(current().inFlight.size).toBe(0);

    act(() => current().selectAgent(writer));
    await settle(() => current().handleAdd());
    expect(mocks.shareCalls).toHaveLength(2);
    const secondInvite = lastShareCall();

    await settle(() => firstInvite.reject(new Error("refused")));
    expect(current().shares.map((share) => share.principalId)).toContain(
      writer.email,
    );
    expect(secondInvite.args.principalId).toBe(writer.email);
  });

  it("settles an earlier invite after a later one has started", async () => {
    await render();
    act(() => current().selectAgent(reviewer));
    await settle(() => current().handleAdd());
    const first = lastShareCall();
    act(() => current().selectAgent(writer));
    await settle(() => current().handleAdd());
    const second = lastShareCall();
    expect(current().inFlight.size).toBe(2);

    await settle(() => first.reject(new Error("refused")));

    expect(current().selectedAgent).toEqual(reviewer);
    expect(current().shareError).not.toBeNull();
    expect(current().shares.map((share) => share.principalId)).not.toContain(
      reviewer.email,
    );
    expect(current().inFlight.size).toBe(1);

    await settle(() => second.resolve({ ok: true }));
    expect(current().inFlight.size).toBe(0);
  });

  it("keeps another save's refreshed list when a failed invite rolls back", async () => {
    const key = createShareQueryKey({
      resourceType: "deck",
      resourceId: "deck-1",
    });
    queryClient.setQueryData(key, mocks.query.data);
    await render();
    await settle(() => current().selectAgent(writer));
    await settle(() => current().handleAdd());
    const failed = lastShareCall();
    // Another save succeeded meanwhile and its refetch dropped the shared agent.
    queryClient.setQueryData<ShareButtonSharesResponse>(key, (cached) =>
      cached ? { ...cached, shares: cached.shares.slice(1) } : cached,
    );

    await settle(() => failed.reject(new Error("refused")));

    const cached = queryClient.getQueryData<ShareButtonSharesResponse>(key);
    expect(cached?.shares.map((share) => share.principalId)).toEqual([]);
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
    await settle(() => current().handleAdd());

    expect(lastShareCall().args).toMatchObject({
      principalType: "user",
      principalId: "person@example.test",
      notify: true,
      message: "hello",
    });
  });
});
