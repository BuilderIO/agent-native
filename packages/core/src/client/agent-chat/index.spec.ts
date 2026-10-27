import { describe, expect, it } from "vitest";

import * as agentSidebarState from "../agent-sidebar-state.js";
import * as availableClis from "../available-clis.js";
import * as builderAgentsRun from "../builder-agents-run.js";
import * as chatCheckpoints from "../chat-checkpoints.js";
import * as chatModelGroups from "../chat-model-groups.js";
import * as frameworkRouteRequest from "../framework-route-request.js";
import * as useChatThreads from "../use-chat-threads.js";
import * as agentChat from "./index.js";

describe("client/agent-chat export surface", () => {
  it("re-exports the framework route error helpers", () => {
    expect(agentChat.FrameworkRouteError).toBe(
      frameworkRouteRequest.FrameworkRouteError,
    );
    expect(agentChat.isFrameworkRouteError).toBe(
      frameworkRouteRequest.isFrameworkRouteError,
    );
  });

  it("re-exports the CLI, checkpoint, and Builder agents run clients", () => {
    expect(agentChat.fetchAvailableClis).toBe(availableClis.fetchAvailableClis);
    expect(agentChat.listChatCheckpoints).toBe(
      chatCheckpoints.listChatCheckpoints,
    );
    expect(agentChat.restoreChatCheckpoint).toBe(
      chatCheckpoints.restoreChatCheckpoint,
    );
    expect(agentChat.BUILDER_AGENT_NOT_CONNECTED_ERROR_CODE).toBe(
      builderAgentsRun.BUILDER_AGENT_NOT_CONNECTED_ERROR_CODE,
    );
    expect(agentChat.startBuilderAgentsRun).toBe(
      builderAgentsRun.startBuilderAgentsRun,
    );
  });

  it("re-exports the model, draft thread, and sidebar state helpers", () => {
    expect(agentChat.resolveDefaultModelSelection).toBe(
      chatModelGroups.resolveDefaultModelSelection,
    );
    expect(agentChat.isClientDraftThread).toBe(
      useChatThreads.isClientDraftThread,
    );
    expect(agentChat.markClientDraftThread).toBe(
      useChatThreads.markClientDraftThread,
    );
    expect(agentChat.getAgentSidebarState).toBe(
      agentSidebarState.getAgentSidebarState,
    );
  });
});
