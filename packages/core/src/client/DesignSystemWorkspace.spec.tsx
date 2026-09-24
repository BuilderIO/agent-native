import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  designSystemWorkspaceSchema,
  type DesignSystemWorkspaceSnapshot,
} from "../shared/design-system-authoring.js";
import { sendToAgentChatAndConfirm } from "./agent-chat.js";
import { deleteClientAppState } from "./application-state.js";
import {
  DesignSystemWorkspace,
  DesignSystemWorkspaceProvider,
  useDesignSystemWorkspace,
} from "./DesignSystemWorkspace.js";
import {
  designSystemWorkspaceLabels,
  designSystemWorkspaceStatus,
} from "./DesignSystemWorkspaceView.js";
import { callAction } from "./use-action.js";

const native = vi.hoisted(() => ({ props: {} as any, mounts: 0 }));
const identity = vi.hoisted(() => ({
  email: "qa@example.test",
  orgId: "qa-org",
}));
let snapshot: DesignSystemWorkspaceSnapshot;
let artifactBody: { html?: string; text?: string };
let artifactError: Error | undefined;
const refetchArtifact = vi.fn();
let mediaMatches = false;
let mediaChange: (() => void) | undefined;
const labels = designSystemWorkspaceLabels((key) =>
  key.replace("systemWorkspace.", ""),
);
vi.mock("./AgentPanel.js", () => ({
  AgentChatSurface: (props: any) => {
    native.props = props;
    useEffect(() => {
      native.mounts++;
    }, []);
    return (
      <div data-native-chat>
        <textarea aria-label="Native composer" defaultValue="Unsent draft" />
      </div>
    );
  },
}));
vi.mock("./use-session.js", () => ({
  useSession: () => ({
    session: identity,
  }),
}));
vi.mock("./BuilderDsiGate.js", () => ({
  BuilderDsiGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./browser-tab-id.js", () => ({ getBrowserTabId: () => "qa-tab" }));
vi.mock("./application-state.js", () => ({
  writeClientAppState: vi.fn().mockResolvedValue(undefined),
  deleteClientAppState: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./agent-chat.js", () => ({ sendToAgentChatAndConfirm: vi.fn() }));
vi.mock("./use-action.js", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
  callAction: vi.fn(),
  useActionQuery: (name: string) => ({
    data: name === "get-design-system-workspace" ? snapshot : artifactBody,
    error: name === "get-design-system-workspace" ? undefined : artifactError,
    isLoading: false,
    refetch: refetchArtifact,
  }),
}));
let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;
const onUse = vi.fn();
const onUsed = vi.fn();
const onBack = vi.fn();
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <DesignSystemWorkspaceProvider
          labels={labels}
          ownerApp="design"
          renderSources={() => null}
        >
          <DesignSystemWorkspace
            systemId="qa-system"
            onBack={onBack}
            onUse={onUse}
            onUsed={onUsed}
          />
        </DesignSystemWorkspaceProvider>
      </QueryClientProvider>,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  artifactBody = {
    html: "<!doctype html><button>Actual saved avatar</button>",
  };
  artifactError = undefined;
  mediaMatches = false;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return mediaMatches;
    },
    addEventListener: (_name: string, callback: () => void) => {
      mediaChange = callback;
    },
    removeEventListener: () => {},
  }));
  sessionStorage.clear();
  identity.email = "qa@example.test";
  native.mounts = 0;
  queryClient = new QueryClient();
  snapshot = {
    id: "qa-system",
    title: "QA system",
    canEdit: true,
    workspace: designSystemWorkspaceSchema.parse({
      schemaVersion: 1,
      ownerApp: "design",
      systemId: "qa-system",
      revision: 10,
      contentRevision: 4,
      conversationId: "qa-conversation",
      conversationScope: "design-system:qa-system",
      intent: "fresh",
      sources: [],
      artifacts: [
        {
          id: "avatar",
          kind: "component",
          name: "Avatar",
          revision: 3,
          provenance: "generated",
          sourceIds: [],
          content: null,
          contentType: "text/html",
          contentHash: "test",
          updatedAt: "now",
          history: [],
        },
      ],
      run: null,
      selectedTargetId: null,
      originDraft: null,
      updatedAt: "now",
      creationHash: "test",
      operations: [],
    }),
  };
  vi.mocked(callAction).mockImplementation(async (name) =>
    name === "get-design-system-workspace" ? snapshot : {},
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
});

it("mounts one fixed native conversation and preserves it through idle artifact updates", async () => {
  await render();
  expect(native.props).toMatchObject({
    fixedThreadId: "qa-conversation",
    storageKey: "design-system:design:qa-system",
    scope: { id: "design-system:qa-system" },
    composerContextThreadId: "qa-conversation",
  });
  snapshot = {
    ...snapshot,
    workspace: { ...snapshot.workspace!, revision: 11 },
  };
  await render();
  expect(native.mounts).toBe(1);
});
it("closes an identity-bound authoring overlay when the new identity has no return receipt", async () => {
  let host!: ReturnType<typeof useDesignSystemWorkspace>;
  function Origin() {
    host = useDesignSystemWorkspace();
    return <span>{String(host.active)}</span>;
  }
  const renderOrigin = () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <DesignSystemWorkspaceProvider
            labels={labels}
            ownerApp="design"
            renderSources={() => null}
          >
            <Origin />
          </DesignSystemWorkspaceProvider>
        </QueryClientProvider>,
      ),
    );
  await renderOrigin();
  await act(async () =>
    host.open({ systemId: "qa-system", originId: "qa-origin" }),
  );
  expect(host.active).toBe(true);
  identity.email = "other@example.test";
  await renderOrigin();
  expect(host.active).toBe(false);
  expect(
    sessionStorage.getItem(
      "design-system-return:design:other@example.test:qa-org",
    ),
  ).toBeNull();
});
it("selects the rendered iframe surface and attaches exact target revision", async () => {
  await render();
  const iframe = container.querySelector("iframe")!;
  expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  expect(iframe.className).toContain("pointer-events-none");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[data-artifact-preview="avatar"]')!
      .click(),
  );
  expect(native.props.composerContextItems[0]).toMatchObject({
    title: "Avatar",
    key: "system-target:qa-system",
  });
  expect(native.props.composerContextItems[0].context).toContain(
    '"expectedRevision":3',
  );
  expect(callAction).toHaveBeenCalledWith(
    "get-design-system-workspace",
    { id: "qa-system" },
    { method: "GET" },
  );
  expect(callAction).toHaveBeenCalledWith(
    "update-design-system-workspace",
    expect.objectContaining({
      expectedRevision: 10,
      selectedTargetId: "avatar",
    }),
  );
});
it("uses a fresh content revision once even with duplicate clicks", async () => {
  await render();
  vi.mocked(callAction).mockResolvedValue({
    ...snapshot,
    workspace: { ...snapshot.workspace!, revision: 80, contentRevision: 5 },
  });
  const useButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "use",
  )!;
  await act(async () => {
    useButton.click();
    useButton.click();
  });
  expect(onUse).toHaveBeenCalledExactlyOnceWith({
    id: "qa-system",
    ownerApp: "design",
    revision: 5,
  });
  expect(onUsed).toHaveBeenCalledTimes(1);
});

function useBuilderWorkspace() {
  snapshot.workspace!.runtime = "builder";
  snapshot.workspace!.builder = {
    sessionId: "builder-session",
    revision: "builder-revision",
    status: "ready",
    workspaceStatus: "idle",
    sourceIds: [],
    sourceOutcomes: [],
    operations: [],
    publication: null,
  };
  snapshot.canUse = false;
  snapshot.canPublish = true;
}

it("keeps Builder generation in the same native composer without local artifact writing", async () => {
  useBuilderWorkspace();
  await render();
  expect(native.props.scope.context).toContain("run-design-system-agent");
  await act(async () =>
    native.props.onRunStateChange({
      runId: "native-turn",
      status: "completed",
    }),
  );
  expect(callAction).not.toHaveBeenCalledWith(
    "bind-design-system-run",
    expect.anything(),
  );
  expect(native.props.fixedThreadId).toBe("qa-conversation");
});

it("publishes the reviewed Builder revision before attaching the system", async () => {
  useBuilderWorkspace();
  vi.mocked(callAction).mockImplementation(async (name) => {
    if (name === "publish-design-system") {
      expect(onUse).not.toHaveBeenCalled();
      return {
        ...snapshot,
        workspace: {
          ...snapshot.workspace!,
          builder: {
            ...snapshot.workspace!.builder!,
            publication: {
              sessionId: "builder-session",
              revision: "builder-revision",
              published: 3,
              requestId: "publication",
              contentRevision: 4,
            },
          },
        },
      };
    }
    return snapshot;
  });
  await render();
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "use")!
      .click(),
  );
  expect(callAction).toHaveBeenCalledWith("publish-design-system", {
    id: "qa-system",
    requestId: expect.any(String),
    expectedRevision: "builder-revision",
  });
  expect(onUse).toHaveBeenCalledExactlyOnceWith({
    id: "qa-system",
    ownerApp: "design",
    revision: 4,
  });
});

it("never attaches after an unknown publication and retains its request ID for recovery", async () => {
  useBuilderWorkspace();
  vi.mocked(callAction).mockImplementation(async (name) => {
    if (name === "publish-design-system")
      throw new Error("Publication outcome unknown");
    return snapshot;
  });
  await render();
  const useButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "use",
  )!;
  await act(async () => useButton.click());
  await act(async () => useButton.click());
  const requests = vi
    .mocked(callAction)
    .mock.calls.filter(([name]) => name === "publish-design-system");
  expect(requests).toHaveLength(2);
  expect(requests[0][1]).toEqual(requests[1][1]);
  expect(onUse).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Publication outcome unknown");
});

it("disables using Builder output until the provider confirms it is usable", async () => {
  useBuilderWorkspace();
  snapshot.canUse = false;
  snapshot.canPublish = false;
  await render();
  expect(
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "use",
    )!.disabled,
  ).toBe(true);
});

it("renders a provider foundation from its real HTML instead of an empty token sample", async () => {
  useBuilderWorkspace();
  snapshot.workspace!.artifacts[0].kind = "foundation";
  snapshot.workspace!.artifacts[0].provider = {
    id: "tokens/typography.html",
    kind: "html",
  };
  await render();
  expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toBe(
    artifactBody.html,
  );
  expect(container.querySelector("details")).toBeNull();
});
it("keeps the native draft and saved canvas mounted through tabs, selection, and desktop layout", async () => {
  await render();
  const composer = container.querySelector("textarea")!;
  const iframe = container.querySelector("iframe");
  const canvasTab =
    container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
  await act(async () =>
    canvasTab.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    ),
  );
  expect(canvasTab.getAttribute("aria-selected")).toBe("true");
  expect(composer.closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(true);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[data-artifact-preview="avatar"]')!
      .click(),
  );
  expect(composer.closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(
    false,
  );
  expect(native.props.composerContextItems[0].title).toBe("Avatar");
  expect(container.querySelector("iframe")).toBe(iframe);
  expect(composer.value).toBe("Unsent draft");
  mediaMatches = true;
  await act(async () => mediaChange?.());
  const regions = [
    ...container.querySelectorAll<HTMLElement>('[role="region"]'),
  ];
  expect(regions).toHaveLength(2);
  expect(
    regions.every(
      (region) =>
        !region.hidden &&
        !region.hasAttribute("aria-hidden") &&
        !region.hasAttribute("inert"),
    ),
  ).toBe(true);
  expect(container.querySelector("textarea")).toBe(composer);
  expect(native.mounts).toBe(1);
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "back")!
      .click(),
  );
  expect(onBack).toHaveBeenCalledOnce();
});
it("renders persisted foundation specimens with independent raw-token disclosure and selection", async () => {
  snapshot.workspace!.artifacts = [
    {
      ...snapshot.workspace!.artifacts[0],
      id: "typography",
      kind: "foundation",
      name: "User typography name",
      values: {
        headingFont: "Nunito Sans",
        bodyFont: "Arial",
        "headingSizes.h1": "48px",
        "headingSizes.h2": "32px",
        "headingSizes.h3": "24px",
        "customer.custom-key": "kept exactly",
      },
    },
  ];
  const before = JSON.stringify(snapshot.workspace!.artifacts);
  await render();
  const article = container.querySelector('[data-artifact="typography"]')!;
  expect(article.querySelector("h3")?.textContent).toBe("typography");
  const fontSpecimens = [
    ...article.querySelectorAll<HTMLElement>("[style]"),
  ].filter((node) => node.style.fontFamily && node.textContent === "Aa");
  expect(fontSpecimens).toHaveLength(5);
  expect(
    fontSpecimens.every((node) =>
      node.style.fontFamily.endsWith(", sans-serif"),
    ),
  ).toBe(true);
  expect(fontSpecimens[0].style.fontFamily).toBe('"Nunito Sans", sans-serif');
  expect(article.querySelector('[title="Nunito Sans"]')?.textContent).toBe(
    "Nunito Sans",
  );
  for (const size of ["48px", "32px", "24px"]) {
    expect(
      [...article.querySelectorAll<HTMLElement>("[style]")].some(
        (node) => node.style.fontSize === size && node.textContent === "Aa",
      ),
    ).toBe(true);
  }
  const summary = article.querySelector("summary")!;
  expect(summary.closest("button")).toBeNull();
  expect(
    article.querySelectorAll('[data-artifact-preview="typography"]'),
  ).toHaveLength(1);
  expect(article.querySelector("details")?.textContent).toContain(
    "customer.custom-key",
  );
  expect(article.querySelector("details")?.textContent).toContain(
    "kept exactly",
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[data-artifact-preview="typography"]')!
      .click(),
  );
  expect(native.props.composerContextItems[0].title).toBe(
    "User typography name",
  );
  expect(JSON.stringify(snapshot.workspace!.artifacts)).toBe(before);
});
it("renders actual block markdown and leaves artifact retry independent of selection", async () => {
  snapshot.workspace!.artifacts = [
    {
      ...snapshot.workspace!.artifacts[0],
      id: "rules",
      name: "Usage",
      kind: "usage-rule",
    },
  ];
  artifactBody = {
    text: "## Readable rules\n\nUse **contrast**.\n\n- Label every input\n\n<script>bad()</script>",
  };
  await render();
  const article = container.querySelector('[data-artifact="rules"]')!;
  expect(article.querySelector("h2")?.textContent).toBe("Readable rules");
  expect(article.querySelector("li")?.textContent).toBe("Label every input");
  expect(article.querySelector("strong")?.textContent).toBe("contrast");
  expect(article.querySelector("script")).toBeNull();
  artifactError = new Error("Preview read failed");
  await render();
  const retry = [...article.querySelectorAll("button")].find(
    (button) => button.textContent === "retry",
  )!;
  expect(retry.closest("[data-artifact-preview]")).toBeNull();
  await act(async () => retry.click());
  expect(refetchArtifact).toHaveBeenCalledOnce();
  expect(article.querySelector("h2")?.textContent).toBe("Readable rules");
});
it("opens the immutable HTML in a reachable dialog without selecting or writing", async () => {
  await render();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="openPreview"]')!
      .click(),
  );
  const dialog = document.querySelector('[role="dialog"]')!;
  const iframe = dialog.querySelector("iframe")!;
  expect(iframe.getAttribute("srcdoc")).toBe(artifactBody.html);
  expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  expect(iframe.getAttribute("tabindex")).toBeNull();
  expect(iframe.className).not.toContain("pointer-events-none");
  expect(callAction).not.toHaveBeenCalled();
});
it("shows one initial canvas state rather than repeated empty sections", async () => {
  snapshot.workspace!.artifacts = [];
  await render();
  expect(
    container.querySelectorAll(
      'section[aria-label="foundations"], section[aria-label="components"], section[aria-label="rules"]',
    ),
  ).toHaveLength(0);
  expect(container.textContent?.match(/empty/g)).toHaveLength(1);
  expect(container.textContent).not.toContain("emptySection");
});
it.each([
  ["native", "fresh"],
  ["builder", "fresh"],
  ["builder", "references"],
] as const)(
  "dispatches %s %s kickoff only when the native composer is ready",
  async (runtime, intent) => {
    if (runtime === "builder") useBuilderWorkspace();
    snapshot.workspace!.intent = intent;
    snapshot.workspace!.kickoff = {
      status: "pending",
      requestId: "durable-request",
      claimId: null,
      leaseUntil: null,
      error: null,
    };
    vi.mocked(callAction).mockImplementation(async (name) =>
      name === "claim-design-system-kickoff"
        ? {
            shouldDispatch: true,
            claimId: "lease",
            requestId: "durable-request",
            conversationId: "qa-conversation",
          }
        : {},
    );
    vi.mocked(sendToAgentChatAndConfirm).mockResolvedValue({
      delivered: true,
      submitMessageId: "durable-request",
    });
    await render();
    expect(sendToAgentChatAndConfirm).not.toHaveBeenCalled();
    await act(async () => native.props.onThreadReady("qa-conversation"));
    expect(sendToAgentChatAndConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "qa-conversation",
        turnId: "durable-request",
        submitMessageId: "durable-request",
        openSidebar: false,
      }),
    );
    expect(snapshot.workspace!.run).toBeNull();
    const kickoff = vi.mocked(sendToAgentChatAndConfirm).mock.calls[0][0];
    if (runtime === "builder" && intent === "references") {
      expect(kickoff.context).toContain("Call run-design-system-agent");
      expect(kickoff.context).toContain('requestId "durable-request"');
      expect(kickoff.context).toContain("complete staged reference batch");
    } else {
      expect(kickoff.context).toContain("Ask one concise question");
    }
  },
);
it("binds real running and terminal native callbacks before refreshing", async () => {
  await render();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  await act(async () =>
    native.props.onRunStateChange({ runId: "real-run", status: "running" }),
  );
  await act(async () =>
    native.props.onRunStateChange({ runId: "real-run", status: "completed" }),
  );
  expect(callAction).toHaveBeenNthCalledWith(1, "bind-design-system-run", {
    id: "qa-system",
    runId: "real-run",
  });
  expect(callAction).toHaveBeenNthCalledWith(2, "bind-design-system-run", {
    id: "qa-system",
    runId: "real-run",
  });
  expect(invalidate).toHaveBeenCalledTimes(2);
});
it("clears transient target app-state when authoring closes", async () => {
  await render();
  await act(async () => root.render(null));
  expect(deleteClientAppState).toHaveBeenCalledWith("design-system-selection", {
    requestSource: "qa-tab",
    keepalive: true,
  });
});
it("does not describe a queued run as processing or a clarification as completed output", () => {
  snapshot.workspace!.run = {
    id: "real",
    status: "queued",
    stage: "reading-sources",
    error: null,
  };
  expect(designSystemWorkspaceStatus(snapshot, labels)).toBe("preparing");
  snapshot.workspace!.run = {
    id: "real",
    status: "completed",
    stage: "awaiting-input",
    error: null,
  };
  expect(designSystemWorkspaceStatus(snapshot, labels)).toBe(
    "awaitingDirection",
  );
});
