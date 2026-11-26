// @vitest-environment happy-dom

import { saveRevisionOf } from "@agent-native/core/save-conflict";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resources = vi.hoisted(() => ({
  list: [] as { id: string; path: string }[],
  files: {} as Record<string, { content: string; revision?: string }>,
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({
    data: resources.list,
    isPending: false,
    isError: false,
  }),
  useResource: (id: string | null) => ({
    data: id ? resources.files[id] : undefined,
    isPending: id !== null && !(id in resources.files),
    isError: false,
  }),
  useCreateResource: () => ({ mutateAsync: resources.create }),
  useUpdateResource: () => ({ mutateAsync: resources.update }),
}));
vi.mock("@agent-native/toolkit/design-system", () => ({
  ActionButton: (props: {
    children: React.ReactNode;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button
      type="button"
      disabled={props.disabled}
      onClick={() => props.onPress?.()}
    >
      {props.children}
    </button>
  ),
  Skeleton: () => <div />,
  TextArea: (props: {
    "aria-label": string;
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label={props["aria-label"]}
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

import { AgentPersonalizationSettings } from "./AgentPersonalizationSettings.js";

const conflict = (content: string) =>
  Object.assign(new Error("changed"), {
    statusCode: 409,
    errorCode: "save_conflict",
    details: {
      current: { content },
      currentRevision: saveRevisionOf({ content }),
    },
  });

async function saveInstructions(content: string) {
  fireEvent.change(
    screen.getByLabelText("agentChat.personalization.customInstructions"),
    { target: { value: content } },
  );
  await act(async () => {
    screen.getAllByText("agentChat.common.save")[0].click();
  });
}

beforeEach(() => {
  resources.list = [];
  resources.files = {};
  resources.create.mockReset();
  resources.update.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AgentPersonalizationSettings", () => {
  it("saves an edit over the version it started from", async () => {
    resources.list = [{ id: "agents-1", path: "AGENTS.md" }];
    resources.files["agents-1"] = { content: "base", revision: "rev-1" };
    resources.update.mockResolvedValue({ content: "mine", revision: "rev-2" });
    render(<AgentPersonalizationSettings />);

    await saveInstructions("mine");

    expect(resources.update).toHaveBeenCalledExactlyOnceWith({
      id: "agents-1",
      content: "mine",
      expectedRevision: "rev-1",
    });
    expect(screen.getByRole("status").textContent).toBe(
      "agentChat.personalization.saved",
    );
  });

  it("asks which version to keep when the agent saved meanwhile", async () => {
    resources.list = [{ id: "agents-1", path: "AGENTS.md" }];
    resources.files["agents-1"] = { content: "base", revision: "rev-1" };
    resources.update
      .mockRejectedValueOnce(conflict("theirs"))
      .mockResolvedValueOnce({ content: "mine", revision: "rev-3" });
    render(<AgentPersonalizationSettings />);

    await saveInstructions("mine");
    expect(await screen.findByText("saveConflict.title")).toBeTruthy();
    await act(async () => {
      screen.getByText("saveConflict.keepMine").click();
    });

    expect(resources.update).toHaveBeenLastCalledWith({
      id: "agents-1",
      content: "mine",
      expectedRevision: saveRevisionOf({ content: "theirs" }),
    });
    expect(
      (
        screen.getByLabelText(
          "agentChat.personalization.customInstructions",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("mine");
  });

  it("creates the file only where none is, and asks when one was made meanwhile", async () => {
    resources.create.mockResolvedValue({
      id: "agents-new",
      content: "theirs",
      revision: saveRevisionOf({ content: "theirs" }),
    });
    resources.update.mockResolvedValue({ content: "mine", revision: "rev-3" });
    render(<AgentPersonalizationSettings />);

    await saveInstructions("mine");

    expect(resources.create).toHaveBeenCalledExactlyOnceWith({
      path: "AGENTS.md",
      content: "mine",
      mimeType: "text/markdown",
      ifNotExists: true,
    });
    expect(await screen.findByText("saveConflict.title")).toBeTruthy();
    await act(async () => {
      screen.getByText("saveConflict.keepMine").click();
    });
    expect(resources.update).toHaveBeenCalledExactlyOnceWith({
      id: "agents-new",
      content: "mine",
      expectedRevision: saveRevisionOf({ content: "theirs" }),
    });
  });

  it("still asks when the file shows up between the first edit and Save", async () => {
    const view = render(<AgentPersonalizationSettings />);
    fireEvent.change(
      screen.getByLabelText("agentChat.personalization.customInstructions"),
      { target: { value: "mine" } },
    );
    resources.list = [{ id: "agents-1", path: "AGENTS.md" }];
    resources.files["agents-1"] = {
      content: "theirs",
      revision: saveRevisionOf({ content: "theirs" }),
    };
    view.rerender(<AgentPersonalizationSettings />);
    resources.create.mockResolvedValue({
      id: "agents-1",
      ...resources.files["agents-1"],
    });

    await act(async () => {
      screen.getAllByText("agentChat.common.save")[0].click();
    });

    expect(resources.update).not.toHaveBeenCalled();
    expect(resources.create).toHaveBeenCalledWith(
      expect.objectContaining({ path: "AGENTS.md", ifNotExists: true }),
    );
    expect(await screen.findByText("saveConflict.title")).toBeTruthy();
  });

  it("keeps showing a draft while the file its first save made loads", () => {
    const view = render(<AgentPersonalizationSettings />);
    fireEvent.change(
      screen.getByLabelText("agentChat.personalization.customInstructions"),
      { target: { value: "mine" } },
    );
    resources.list = [{ id: "agents-1", path: "AGENTS.md" }];
    view.rerender(<AgentPersonalizationSettings />);

    expect(
      (
        screen.getByLabelText(
          "agentChat.personalization.customInstructions",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("mine");
  });

  it("gets the other version back only after a save that's out comes back", async () => {
    resources.list = [{ id: "agents-1", path: "AGENTS.md" }];
    resources.files["agents-1"] = { content: "base", revision: "rev-1" };
    type Saved = { content: string; revision: string };
    let finishSave: (saved: Saved) => void = () => {};
    resources.update
      .mockRejectedValueOnce(conflict("theirs"))
      .mockResolvedValueOnce({ content: "mine", revision: "rev-mine" })
      .mockReturnValueOnce(
        new Promise<Saved>((resolve) => {
          finishSave = resolve;
        }),
      )
      .mockResolvedValue({ content: "restored", revision: "rev-restored" });
    render(<AgentPersonalizationSettings />);
    await saveInstructions("mine");
    await act(async () => {
      screen.getByText("saveConflict.keepMine").click();
    });
    await screen.findByText("saveConflict.getOtherBack");

    await saveInstructions("mine, again");
    await act(async () => {
      screen.getByText("saveConflict.getOtherBack").click();
    });
    expect(resources.update).toHaveBeenCalledTimes(3);

    await act(async () => {
      finishSave({ content: "mine, again", revision: "rev-again" });
    });
    await waitFor(() => expect(resources.update).toHaveBeenCalledTimes(4));
    expect(resources.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "agents-1",
        expectedRevision: "rev-again",
      }),
    );
  });
});
