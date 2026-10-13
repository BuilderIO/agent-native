// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_PACK_FILE_ACCEPT,
  AGENT_PROFILE_FILE_ACCEPT,
} from "../lib/agent-pack.js";
import {
  handleAgentPackMutationSuccess,
  isPendingWorkspaceResourceApproval,
  readAgentPack,
  SimpleAgentsPanel,
  summarizeSkippedPackFiles,
} from "./simple-agents-panel";

const queryState = vi.hoisted(() => ({
  data: [],
  isError: false,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  navigateWithAgentChatViewTransition: vi.fn(),
  sendToAgentChat: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useActionQuery: () => queryState,
}));

vi.mock("@agent-native/core/resources/metadata", () => ({
  parseCustomAgentProfile: vi.fn(),
}));

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

describe("agent pack resource mutations", () => {
  it("recognizes pending workspace-resource approvals", () => {
    expect(
      isPendingWorkspaceResourceApproval({
        status: "pending",
        changeType: "workspace-resource.update",
      }),
    ).toBe(true);
    expect(
      isPendingWorkspaceResourceApproval({
        status: "pending",
        changeType: "workspace-resource.create",
      }),
    ).toBe(true);
  });

  it("does not treat applied resources or unrelated pending results as approvals", () => {
    expect(
      isPendingWorkspaceResourceApproval({
        id: "resource_1",
        status: "applied",
        changeType: "workspace-resource.update",
      }),
    ).toBe(false);
    expect(
      isPendingWorkspaceResourceApproval({
        status: "pending",
        changeType: "destination.upsert",
      }),
    ).toBe(false);
    expect(isPendingWorkspaceResourceApproval(null)).toBe(false);
  });

  it("reports queued approval without running applied-only refresh work", () => {
    const notifications: string[] = [];
    const onApplied = () => notifications.push("refreshed");

    handleAgentPackMutationSuccess(
      { status: "pending", changeType: "workspace-resource.update" },
      {
        appliedMessage: "Pack file updated",
        approvalMessage: "Pack file update queued for approval",
        onApplied,
        notify: (message) => notifications.push(message),
      },
    );

    expect(notifications).toEqual(["Pack file update queued for approval"]);
  });

  it("reports applied and runs refresh work for an applied resource", () => {
    const notifications: string[] = [];

    handleAgentPackMutationSuccess(
      { id: "resource_1" },
      {
        appliedMessage: "Pack file added",
        approvalMessage: "Pack file addition queued for approval",
        onApplied: () => notifications.push("refreshed"),
        notify: (message) => notifications.push(message),
      },
    );

    expect(notifications).toEqual(["Pack file added", "refreshed"]);
  });
});

function fileInputs(): HTMLInputElement[] {
  return Array.from(
    document.body.querySelectorAll<HTMLInputElement>('input[type="file"]'),
  );
}

function fileInputAccepts(): (string | null)[] {
  return fileInputs().map((input) => input.getAttribute("accept"));
}

function selectTab(label: string): void {
  const tab = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="tab"]'),
  ).find((candidate) => candidate.textContent?.includes(label));
  if (!tab) throw new Error(`No tab matching ${label}`);
  tab.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
  );
}

describe("readAgentPack", () => {
  const profile = { id: "a", name: "bot", path: "agents/bot.md", content: "" };

  it("reports a not-yet-loaded pack without claiming it is empty", () => {
    expect(readAgentPack(undefined)).toEqual({ ok: false, loaded: false });
  });

  it("treats a failed query as unreadable, not as an empty pack", () => {
    expect(readAgentPack(undefined, true)).toEqual({ ok: false, loaded: true });
  });

  it("treats a response with no root as unreadable", () => {
    expect(readAgentPack({ profile, files: [] } as never)).toEqual({
      ok: false,
      loaded: true,
    });
  });

  it("distinguishes an unreadable response from an empty pack", () => {
    expect(readAgentPack({ profile, root: "agents/bot" } as never)).toEqual({
      ok: false,
      loaded: true,
    });

    const empty = readAgentPack({ profile, root: "agents/bot", files: [] });
    expect(empty.ok && empty.root).toBe("agents/bot");
    expect(empty.ok).toBe(true);
    expect(empty.ok && empty.files).toHaveLength(1);
  });

  it("puts the profile ahead of the pack files", () => {
    const result = readAgentPack({
      profile,
      root: "agents/bot",
      files: [{ id: "f1", name: "notes.md", path: "x", content: "" }] as never,
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.files.map((file) => file.id)).toEqual([
      "a",
      "f1",
    ]);
    expect(result.ok && result.files[0]?.kind).toBe("agent");
  });
});

describe("summarizeSkippedPackFiles", () => {
  it("stays quiet when every file was importable", () => {
    expect(summarizeSkippedPackFiles([], 4)).toEqual([]);
  });

  it("names the skipped files without listing a whole photo folder", () => {
    expect(summarizeSkippedPackFiles(["a.pdf"], 3)).toEqual([
      "Skipped 1 non-text file: a.pdf. The rest of the folder will still be imported.",
    ]);
    expect(
      summarizeSkippedPackFiles(
        ["a.pdf", "b.png", "c.zip", "d.mov", "e.psd"],
        3,
      ),
    ).toEqual([
      "Skipped 5 non-text files: a.pdf, b.png, c.zip, and 2 more. The rest of the folder will still be imported.",
    ]);
  });

  it("explains the empty result instead of a bare disabled button", () => {
    expect(summarizeSkippedPackFiles(["a.pdf", "b.png"], 0)).toEqual([
      "No importable files in that folder. Agent folders take text files such as Markdown, JSON, and YAML.",
    ]);
  });
});

describe("SimpleAgentsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryState.data = [];
    queryState.isError = false;
    queryState.isLoading = false;
    queryState.error = null;
    queryState.refetch.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body
      .querySelectorAll("[data-radix-portal]")
      .forEach((portal) => portal.remove());
    vi.unstubAllGlobals();
  });

  it("keeps import and connect available when the workspace has no agents", async () => {
    await act(async () => {
      root.render(<SimpleAgentsPanel />);
    });

    const importButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Import or connect"),
    );
    expect(importButton).not.toBeUndefined();

    await act(async () => {
      importButton?.click();
    });

    expect(document.body.textContent).toContain("Import an agent");
    expect(document.body.textContent).toContain("Connect endpoint");
  });

  it("blocks connecting an agent with a malformed endpoint URL", async () => {
    await act(async () => {
      root.render(<SimpleAgentsPanel />);
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Import or connect"))
        ?.click();
    });
    await act(async () => {
      selectTab("Connect endpoint");
    });

    const urlInput = document.getElementById(
      "external-agent-url",
    ) as HTMLInputElement | null;
    expect(urlInput).not.toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(urlInput, "https://api.github.com](https://api.github.com");
      urlInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(document.body.textContent).toMatch(/enter a valid url/i);

    const connectButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Connect agent"));
    expect((connectButton as HTMLButtonElement | undefined)?.disabled).toBe(
      true,
    );
  });

  it("filters both import pickers to the file types the import logic parses", async () => {
    await act(async () => {
      root.render(<SimpleAgentsPanel />);
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Import or connect"))
        ?.click();
    });

    expect(fileInputAccepts()).toEqual([AGENT_PROFILE_FILE_ACCEPT]);

    await act(async () => {
      selectTab("Agent folder");
    });

    expect(fileInputAccepts()).toEqual([AGENT_PACK_FILE_ACCEPT]);
    expect(document.body.textContent).toContain("text files only");
    for (const accept of fileInputAccepts()) {
      expect(accept).not.toContain(".pdf");
    }
  });

  it("opens a folder picker rather than a plain file picker", async () => {
    await act(async () => {
      root.render(<SimpleAgentsPanel />);
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Import or connect"))
        ?.click();
    });
    await act(async () => {
      selectTab("Agent folder");
    });

    const [folderInput] = fileInputs();
    expect(folderInput?.hasAttribute("webkitdirectory")).toBe(true);
    expect(folderInput?.hasAttribute("multiple")).toBe(true);
  });

  it("shows the skipped-file notice as an informational status, not an error", async () => {
    await act(async () => {
      root.render(<SimpleAgentsPanel />);
    });

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Import or connect"))
        ?.click();
    });

    await act(async () => {
      selectTab("Agent folder");
    });

    const [folderInput] = fileInputs();
    expect(folderInput).not.toBeUndefined();

    const files = [
      new File(["# notes"], "notes.md", { type: "text/markdown" }),
      new File(["binary"], "diagram.pdf", { type: "application/pdf" }),
    ];
    Object.defineProperty(folderInput, "files", {
      value: files,
      configurable: true,
    });

    await act(async () => {
      folderInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const notice = document.body.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Skipped 1 non-text file");
    expect(notice?.textContent).toContain(
      "The rest of the folder will still be imported",
    );
    expect(notice?.className).not.toContain("destructive");
    expect(notice?.className).not.toMatch(/\bred-\d/);
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });
});
