// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit/client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { PromptComposerProps } from "../../../agentkit.js";
import { AgentKitComposer, type AgentKitComposerProps } from "./components.js";
import { AgentKitProvider } from "./context.js";

const capture = vi.hoisted(() => ({
  props: undefined as PromptComposerProps | undefined,
}));
vi.mock("../../../agentkit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../agentkit.js")>();
  return {
    ...actual,
    PromptComposer: (props: PromptComposerProps) => {
      capture.props = props;
      return null;
    },
  };
});

let root: Root;
let container: HTMLDivElement;
let client: AgentKitClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  capture.props = undefined;
  client = new AgentKitClient({
    transport: {
      async startRun() {
        return { runId: "run-example" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
    },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.dispose();
  container.remove();
  vi.unstubAllGlobals();
});

it("forwards opt-in rich text settings to PromptComposer", async () => {
  const options = {
    richTextEnabled: true,
    textBlockSeparator: "",
    autoFocus: false,
  } satisfies AgentKitComposerProps;

  await act(async () =>
    root.render(
      <AgentKitProvider controller={client} threadId="thread-example">
        <AgentKitComposer {...options} />
      </AgentKitProvider>,
    ),
  );

  expect(capture.props?.richTextEnabled).toBe(true);
  expect(capture.props?.textBlockSeparator).toBe("");
});
