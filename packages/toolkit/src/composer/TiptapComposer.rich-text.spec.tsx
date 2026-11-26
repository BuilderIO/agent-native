// @vitest-environment happy-dom

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { Editor } from "@tiptap/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import { getComposerDraftKey } from "./draft-key.js";
import { PromptComposer } from "./PromptComposer.js";
import {
  createTiptapComposerExtensions,
  TiptapComposer,
  type TiptapComposerHandle,
  type TiptapComposerProps,
} from "./TiptapComposer.js";
import cases from "./TiptapComposer.rich-text-cases.json";

const emptyChatModelAdapter: ChatModelAdapter = { async *run() {} };
const voiceHookLifecycle = vi.hoisted(() => ({
  track: false,
  mounts: 0,
  unmounts: 0,
}));

vi.mock("./useVoiceDictation.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./useVoiceDictation.js")>();
  const ReactModule = await import("react");
  return {
    ...actual,
    useVoiceDictation: (
      options: Parameters<typeof actual.useVoiceDictation>[0],
    ) => {
      const result = actual.useVoiceDictation(options);
      ReactModule.useEffect(() => {
        if (!voiceHookLifecycle.track) return;
        voiceHookLifecycle.mounts += 1;
        return () => {
          if (voiceHookLifecycle.track) voiceHookLifecycle.unmounts += 1;
        };
      }, []);
      return result;
    },
  };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  voiceHookLifecycle.track = false;
  voiceHookLifecycle.mounts = 0;
  voiceHookLifecycle.unmounts = 0;
  localStorage.clear();
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function makePasteEvent(html: string, text = "", files: File[] = []) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      getData: (type: string) =>
        type === "text/html" ? html : type === "text/plain" ? text : "",
    },
  });
  return event;
}

async function mountComposer(
  focusRef: React.RefObject<TiptapComposerHandle | null>,
  onSubmit: NonNullable<TiptapComposerProps["onSubmit"]>,
  options: Partial<TiptapComposerProps> = {},
) {
  function Harness() {
    const runtime = useLocalRuntime(emptyChatModelAdapter);
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <TooltipProvider>
          <TiptapComposer
            {...options}
            focusRef={focusRef}
            onSubmit={onSubmit}
            attachmentsEnabled={false}
            richTextEnabled
            includeDefaultSlashSkills={false}
            plusMenuMode="hidden"
            voiceEnabled={false}
          />
        </TooltipProvider>
      </AssistantRuntimeProvider>
    );
  }

  await act(async () => {
    root.render(<Harness />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container.querySelector<HTMLElement>(".agent-composer-prosemirror")!;
}

function ModeToggleHarness({
  focusRef,
  onSubmit,
  richTextEnabled,
  attachmentsEnabled = false,
  draftScope,
  initialText,
  initialTextKey,
  initialTextOverridesSavedDraft,
  suppressInitialTextChange,
  ariaLabel,
  onTextChange,
}: {
  focusRef: React.RefObject<TiptapComposerHandle | null>;
  onSubmit: NonNullable<TiptapComposerProps["onSubmit"]>;
  richTextEnabled: boolean;
  attachmentsEnabled?: boolean;
  draftScope?: string;
  initialText?: string;
  initialTextKey?: string | number;
  initialTextOverridesSavedDraft?: boolean;
  suppressInitialTextChange?: boolean;
  ariaLabel?: string;
  onTextChange?: TiptapComposerProps["onTextChange"];
}) {
  const runtime = useLocalRuntime(emptyChatModelAdapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <TiptapComposer
          focusRef={focusRef}
          onSubmit={onSubmit}
          draftScope={draftScope}
          initialText={initialText}
          initialTextKey={initialTextKey}
          initialTextOverridesSavedDraft={initialTextOverridesSavedDraft}
          suppressInitialTextChange={suppressInitialTextChange}
          onTextChange={onTextChange}
          ariaLabel={ariaLabel}
          richTextEnabled={richTextEnabled}
          textBlockSeparator=""
          attachmentsEnabled={attachmentsEnabled}
          includeDefaultSlashSkills={false}
          plusMenuMode="hidden"
          voiceEnabled={false}
        />
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}

describe("TiptapComposer rich text", () => {
  it("keeps the generic composer schema minimal by default", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createTiptapComposerExtensions(() => "Ask the agent..."),
    });

    expect(Object.keys(editor.schema.marks)).toEqual([]);
    expect(Object.keys(editor.schema.nodes).sort()).toEqual([
      "doc",
      "fileReference",
      "hardBreak",
      "mentionReference",
      "paragraph",
      "skillReference",
      "text",
    ]);
    editor.destroy();
  });

  it("supports inline formatting shortcuts and disables link navigation while editing", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createTiptapComposerExtensions(
        () => "Ask the agent...",
        true,
      ),
      enableInputRules: ["bold", "italic", "link", "strike"],
    });
    const modKey = /mac/i.test(navigator.platform) ? "metaKey" : "ctrlKey";

    try {
      editor.commands.setContent("<p>format me</p>");
      editor.commands.setTextSelection({ from: 1, to: 10 });
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          [modKey]: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(editor.getHTML()).toContain("<strong>format me</strong>");
      expect(
        editor.extensionManager.extensions.find(
          (extension) => extension.name === "link",
        )?.options.openOnClick,
      ).toBe(false);
      expect(Object.keys(editor.schema.marks).sort()).toEqual([
        "bold",
        "code",
        "italic",
        "link",
        "strike",
        "underline",
      ]);
      expect(Object.keys(editor.schema.nodes)).toEqual(
        expect.arrayContaining([
          "heading",
          "bulletList",
          "orderedList",
          "listItem",
          "blockquote",
        ]),
      );
      expect(editor.schema.nodes.codeBlock).toBeUndefined();
      expect(editor.schema.marks.code).toBeDefined();
      const modKeyName = /mac/i.test(navigator.platform)
        ? "metaKey"
        : "ctrlKey";
      editor.commands.setContent("<p>inline code</p>");
      editor.commands.setTextSelection({ from: 1, to: 11 });
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "e",
          [modKeyName]: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(editor.getHTML()).not.toContain("<code>");
    } finally {
      editor.destroy();
    }
  });

  it("forwards rich-text settings through PromptComposer", async () => {
    const focusRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn();

    await act(async () => {
      root.render(
        <PromptComposer
          composerRef={focusRef}
          onSubmit={onSubmit}
          richTextEnabled
          textBlockSeparator=""
          showModelSelector={false}
          modelStatusChecksEnabled={false}
          includeDefaultMentionSearch={false}
          includeDefaultSlashSkills={false}
          voiceEnabled={false}
          attachmentsEnabled={false}
          plusMenuMode="hidden"
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const editor = container.querySelector<HTMLElement>(
      ".agent-composer-prosemirror",
    )!;
    await act(async () => {
      editor.dispatchEvent(
        makePasteEvent("<p><strong>First</strong></p><p>Second</p>"),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(editor.querySelector("strong")?.textContent).toBe("First");
    await act(async () => {
      await focusRef.current?.submit?.();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toBe("FirstSecond");
  });

  it("separates every rich text block with the default newline", async () => {
    const focusRef = React.createRef<TiptapComposerHandle>();
    const editor = await mountComposer(focusRef, vi.fn());

    await act(async () => {
      editor.dispatchEvent(makePasteEvent("<p>A</p><h2>B</h2>"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(focusRef.current?.getDraftSnapshot?.().text).toBe("A\nB");
  });

  it("allows hosts to concatenate rich text blocks explicitly", async () => {
    const focusRef = React.createRef<TiptapComposerHandle>();
    const editor = await mountComposer(focusRef, vi.fn(), {
      textBlockSeparator: "",
    });

    await act(async () => {
      editor.dispatchEvent(makePasteEvent("<p>A</p><h2>B</h2>"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(focusRef.current?.getDraftSnapshot?.().text).toBe("AB");
  });

  it("keeps pasted markdown syntax literal while preserving HTML marks", async () => {
    const focusRef = React.createRef<TiptapComposerHandle>();
    const editor = await mountComposer(focusRef, vi.fn());

    await act(async () => {
      editor.dispatchEvent(makePasteEvent("", "`inline` **bold**"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(editor.textContent).toBe("`inline` **bold**");
    expect(editor.querySelector("code, strong, em, s")).toBeNull();
  });

  it("keeps an unscoped initial draft and inline references across profile changes", async () => {
    const focusRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn();
    voiceHookLifecycle.track = true;

    await act(async () => {
      root.render(
        <ModeToggleHarness
          focusRef={focusRef}
          onSubmit={onSubmit}
          richTextEnabled
          initialText="Initial prompt"
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => {
      focusRef.current?.setText("Edited in memory");
      focusRef.current?.insertReference({
        label: "Unscoped reference",
        refType: "file",
        refPath: "/tmp/unscoped-reference.txt",
      });
    });
    const before = focusRef.current?.getDraftSnapshot?.();

    await act(async () => {
      root.render(
        <ModeToggleHarness
          focusRef={focusRef}
          onSubmit={onSubmit}
          richTextEnabled={false}
          initialText="Initial prompt"
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(focusRef.current?.getDraftSnapshot?.()).toEqual(before);
    expect(focusRef.current?.getDraftSnapshot?.().text).toContain(
      "Edited in memory",
    );
    expect(focusRef.current?.getDraftSnapshot?.().referenceKeys[0]).toContain(
      "Unscoped reference",
    );
    expect(voiceHookLifecycle.mounts).toBe(1);
    expect(voiceHookLifecycle.unmounts).toBe(0);
    voiceHookLifecycle.track = false;
  });

  it("keeps profile-toggle drafts in memory when local storage is unavailable", async () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("storage unavailable");
      },
      setItem() {
        throw new Error("storage unavailable");
      },
      removeItem() {
        throw new Error("storage unavailable");
      },
    });
    const focusRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn();

    await act(async () => {
      root.render(
        <ModeToggleHarness
          focusRef={focusRef}
          onSubmit={onSubmit}
          richTextEnabled
          draftScope="unavailable-storage-profile-toggle"
          initialText="Initial prompt"
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => {
      focusRef.current?.setText("Stored nowhere");
      focusRef.current?.insertReference({
        label: "Memory-only reference",
        refType: "file",
        refPath: "/tmp/memory-only-reference.txt",
      });
    });
    const before = focusRef.current?.getDraftSnapshot?.();

    await act(async () => {
      root.render(
        <ModeToggleHarness
          focusRef={focusRef}
          onSubmit={onSubmit}
          richTextEnabled={false}
          draftScope="unavailable-storage-profile-toggle"
          initialText="Initial prompt"
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(focusRef.current?.getDraftSnapshot?.()).toEqual(before);
    expect(focusRef.current?.getDraftSnapshot?.().text).toContain(
      "Stored nowhere",
    );
    expect(focusRef.current?.getDraftSnapshot?.().referenceKeys[0]).toContain(
      "Memory-only reference",
    );
  });

  it("refreshes attachment behavior and editor attributes without recreating the profile", async () => {
    const focusRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn();
    const props = (attachmentsEnabled: boolean, ariaLabel: string) => (
      <ModeToggleHarness
        focusRef={focusRef}
        onSubmit={onSubmit}
        richTextEnabled
        attachmentsEnabled={attachmentsEnabled}
        ariaLabel={ariaLabel}
      />
    );

    await act(async () => {
      root.render(props(true, "Attachments initially enabled"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    let editor = container.querySelector<HTMLElement>(
      ".agent-composer-prosemirror",
    )!;
    expect(editor.getAttribute("aria-label")).toBe(
      "Attachments initially enabled",
    );

    await act(async () => {
      root.render(props(false, "Attachments disabled"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    editor = container.querySelector<HTMLElement>(
      ".agent-composer-prosemirror",
    )!;
    expect(editor.getAttribute("aria-label")).toBe("Attachments disabled");
    await act(async () => {
      editor.dispatchEvent(
        makePasteEvent(
          "<p><strong>Paste while disabled</strong></p>",
          "Paste while disabled",
          [new File(["image"], "paste.png", { type: "image/png" })],
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(editor.querySelector("strong")?.textContent).toBe(
      "Paste while disabled",
    );

    act(() => focusRef.current?.setText(""));
    await act(async () => {
      root.render(props(true, "Attachments enabled again"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    editor = container.querySelector<HTMLElement>(
      ".agent-composer-prosemirror",
    )!;
    expect(editor.getAttribute("aria-label")).toBe("Attachments enabled again");
    await act(async () => {
      editor.dispatchEvent(
        makePasteEvent("<p>Paste while enabled</p>", "Paste while enabled", [
          new File(["image"], "paste-again.png", { type: "image/png" }),
        ]),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(editor.textContent).not.toContain("Paste while enabled");
  });

  it("does not hand a profile snapshot from one draft scope into another", async () => {
    const draftScopeB = "profile-owner-scope-b";
    const keyB = getComposerDraftKey(draftScopeB);
    localStorage.setItem(keyB, "<p>Saved draft B</p>");
    sessionStorage.setItem(`an-composer-draft-session:${keyB}`, "1");
    const focusRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn();

    await act(async () => {
      root.render(
        <ModeToggleHarness
          focusRef={focusRef}
          onSubmit={onSubmit}
          richTextEnabled
          draftScope="profile-owner-scope-a"
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => {
      focusRef.current?.setText("Private draft A");
      focusRef.current?.insertReference({
        label: "Private reference A",
        refType: "file",
        refPath: "/tmp/private-a.txt",
      });
    });
    act(() => window.dispatchEvent(new Event("pagehide")));

    await act(async () => {
      root.render(
        <ModeToggleHarness
          focusRef={focusRef}
          onSubmit={onSubmit}
          richTextEnabled={false}
          draftScope={draftScopeB}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(focusRef.current?.getDraftSnapshot?.().text).toBe("Saved draft B");
    expect(focusRef.current?.getDraftSnapshot?.().text).not.toContain(
      "Private draft A",
    );
    expect(focusRef.current?.getDraftSnapshot?.().referenceKeys).toEqual([]);
  });

  it("persists a recent draft to its original scope while switching away and back", async () => {
    const draftScopeA = "profile-recent-scope-a";
    const draftScopeB = "profile-recent-scope-b";
    const keyA = getComposerDraftKey(draftScopeA);
    const keyB = getComposerDraftKey(draftScopeB);
    localStorage.setItem(keyB, "<p>Saved draft B</p>");
    sessionStorage.setItem(`an-composer-draft-session:${keyB}`, "1");
    const focusRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn();

    const renderScope = async (
      draftScope: string,
      richTextEnabled: boolean,
    ) => {
      await act(async () => {
        root.render(
          <ModeToggleHarness
            focusRef={focusRef}
            onSubmit={onSubmit}
            richTextEnabled={richTextEnabled}
            draftScope={draftScope}
          />,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };

    await renderScope(draftScopeA, true);
    act(() => {
      focusRef.current?.setText("Recent draft A");
      focusRef.current?.insertReference({
        label: "Recent reference A",
        refType: "file",
        refPath: "/tmp/recent-a.txt",
      });
    });

    // Change scope before the 250 ms draft debounce has fired. No pagehide or
    // timer wait should be necessary to retain A in its own draft slot.
    await renderScope(draftScopeB, false);
    expect(focusRef.current?.getDraftSnapshot?.().text).toBe("Saved draft B");
    expect(focusRef.current?.getDraftSnapshot?.().referenceKeys).toEqual([]);
    expect(localStorage.getItem(keyA)).toContain("Recent draft A");
    expect(localStorage.getItem(keyA)).toContain("Recent reference A");

    await renderScope(draftScopeA, true);
    expect(focusRef.current?.getDraftSnapshot?.().text).toContain(
      "Recent draft A",
    );
    expect(focusRef.current?.getDraftSnapshot?.().referenceKeys).toHaveLength(
      1,
    );
    expect(localStorage.getItem(keyA)).toContain("Recent draft A");
    expect(localStorage.getItem(keyA)).toContain("Recent reference A");
  });

  it("does not hand an overridden initial prompt and references into the next key", async () => {
    const focusRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn();

    await act(async () => {
      root.render(
        <ModeToggleHarness
          focusRef={focusRef}
          onSubmit={onSubmit}
          richTextEnabled
          draftScope="profile-owner-initial-key"
          initialText="Prompt A"
          initialTextKey="prompt-a"
          initialTextOverridesSavedDraft
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => {
      focusRef.current?.setText("Private prompt A");
      focusRef.current?.insertReference({
        label: "Private reference A",
        refType: "file",
        refPath: "/tmp/private-initial-a.txt",
      });
    });

    await act(async () => {
      root.render(
        <ModeToggleHarness
          focusRef={focusRef}
          onSubmit={onSubmit}
          richTextEnabled={false}
          draftScope="profile-owner-initial-key"
          initialText="Prompt B"
          initialTextKey="prompt-b"
          initialTextOverridesSavedDraft
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(focusRef.current?.getDraftSnapshot?.().text).toBe("Prompt B");
    expect(focusRef.current?.getDraftSnapshot?.().text).not.toContain(
      "Private prompt A",
    );
    expect(focusRef.current?.getDraftSnapshot?.().referenceKeys).toEqual([]);
  });

  it("synchronizes restored observer text and respects suppression", async () => {
    const focusRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn();
    const onTextChange = vi.fn();

    await act(async () => {
      root.render(
        <ModeToggleHarness
          focusRef={focusRef}
          onSubmit={onSubmit}
          richTextEnabled
          draftScope="profile-observer-sync"
          initialText="Initial prompt"
          initialTextKey="observer-prompt"
          onTextChange={onTextChange}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => focusRef.current?.setText("Observer draft"));
    onTextChange.mockClear();

    await act(async () => {
      root.render(
        <ModeToggleHarness
          focusRef={focusRef}
          onSubmit={onSubmit}
          richTextEnabled={false}
          draftScope="profile-observer-sync"
          initialText="Initial prompt"
          initialTextKey="observer-prompt"
          onTextChange={onTextChange}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onTextChange).toHaveBeenLastCalledWith("Observer draft");

    act(() => focusRef.current?.setText("Suppressed observer draft"));
    onTextChange.mockClear();
    await act(async () => {
      root.render(
        <ModeToggleHarness
          focusRef={focusRef}
          onSubmit={onSubmit}
          richTextEnabled
          draftScope="profile-observer-sync"
          initialText="Initial prompt"
          initialTextKey="observer-prompt"
          suppressInitialTextChange
          onTextChange={onTextChange}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    onTextChange.mockClear();
    await act(async () => {
      root.render(
        <ModeToggleHarness
          focusRef={focusRef}
          onSubmit={onSubmit}
          richTextEnabled={false}
          draftScope="profile-observer-sync"
          initialText="Initial prompt"
          initialTextKey="observer-prompt"
          suppressInitialTextChange
          onTextChange={onTextChange}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onTextChange).not.toHaveBeenCalled();
    expect(focusRef.current?.getDraftSnapshot?.().text).toBe(
      "Suppressed observer draft",
    );
  });

  it.each(cases)(
    "submits pasted rich content as the source plain text for case $id",
    async ({ id, html, expectedText, expectedStepCount }) => {
      const focusRef = React.createRef<TiptapComposerHandle>();
      const onSubmit = vi.fn() as ReturnType<typeof vi.fn> &
        NonNullable<TiptapComposerProps["onSubmit"]>;
      const editor = await mountComposer(focusRef, onSubmit, {
        draftScope: `rich-text-source-case-${id}`,
        textBlockSeparator: "",
      });

      await act(async () => {
        editor.dispatchEvent(makePasteEvent(html));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(focusRef.current?.getDraftSnapshot?.().text).toBe(expectedText);
      if (id === 12) {
        expect(editor.querySelector("code")?.textContent).toBe("Inline code");
      }
      if (expectedStepCount === 0) {
        expect(await focusRef.current?.submit?.()).toBe(false);
        expect(onSubmit).not.toHaveBeenCalled();
      } else {
        await act(async () => {
          expect(await focusRef.current?.submit?.()).toBe(true);
        });
        expect(onSubmit).toHaveBeenCalledOnce();
        expect(onSubmit.mock.calls[0]?.[0]).toBe(expectedText);
      }
    },
  );

  it("preserves rich HTML from a mixed file paste without enabling uploads", async () => {
    const focusRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn() as ReturnType<typeof vi.fn> &
      NonNullable<TiptapComposerProps["onSubmit"]>;
    const editor = await mountComposer(focusRef, onSubmit, {
      textBlockSeparator: "",
    });
    const image = new File(["image"], "image.png", { type: "image/png" });

    await act(async () => {
      editor.dispatchEvent(
        makePasteEvent(
          "<p><strong>Keep emphasis</strong> <a href='mailto:team@example.test'>mail</a></p>",
          "Keep emphasis mail",
          [image],
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(editor.querySelector("strong")?.textContent).toBe("Keep emphasis");
    expect(editor.querySelector("a")?.textContent).toBe("mail");
    expect(editor.querySelector("img")).toBeNull();
    expect(focusRef.current?.getDraftSnapshot?.().text).toBe(
      "Keep emphasis mail",
    );
    await act(async () => {
      await focusRef.current?.submit?.();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toBe("Keep emphasis mail");
  });

  it("keeps marked draft text and references when the host changes rich-text mode", async () => {
    const focusRef = React.createRef<TiptapComposerHandle>();
    const onSubmit = vi.fn() as ReturnType<typeof vi.fn> &
      NonNullable<TiptapComposerProps["onSubmit"]>;
    const draftScope = "rich-text-mode-toggle";

    function Harness({ richTextEnabled }: { richTextEnabled: boolean }) {
      const runtime = useLocalRuntime(emptyChatModelAdapter);
      return (
        <AssistantRuntimeProvider runtime={runtime}>
          <TooltipProvider>
            <TiptapComposer
              focusRef={focusRef}
              onSubmit={onSubmit}
              draftScope={draftScope}
              richTextEnabled={richTextEnabled}
              textBlockSeparator=""
              attachmentsEnabled={false}
              includeDefaultSlashSkills={false}
              plusMenuMode="hidden"
              voiceEnabled={false}
            />
          </TooltipProvider>
        </AssistantRuntimeProvider>
      );
    }

    await act(async () => {
      root.render(<Harness richTextEnabled />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    let editor = container.querySelector<HTMLElement>(
      ".agent-composer-prosemirror",
    )!;
    await act(async () => {
      editor.dispatchEvent(
        makePasteEvent("<p><strong>Marked draft</strong></p>"),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => {
      focusRef.current?.insertReference({
        label: "Saved reference",
        refType: "file",
        refPath: "/tmp/saved-reference.txt",
      });
    });
    act(() => window.dispatchEvent(new Event("pagehide")));

    const key = getComposerDraftKey(draftScope);
    const rawSaved = localStorage.getItem(key) ?? "";
    const saved = rawSaved.startsWith('{"format":"agent-composer-draft-v1"')
      ? (JSON.parse(rawSaved) as { html: string })
      : { html: rawSaved };
    expect(saved.html).toContain("<strong>Marked draft</strong>");
    expect(saved.html).toContain("Saved reference");

    await act(async () => {
      root.render(<Harness richTextEnabled={false} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    editor = container.querySelector<HTMLElement>(
      ".agent-composer-prosemirror",
    )!;
    expect(editor.textContent).toContain("Marked draft");
    expect(editor.textContent).toContain("Saved reference");
    expect(focusRef.current?.getDraftSnapshot?.().referenceKeys).toHaveLength(
      1,
    );
    expect(focusRef.current?.getDraftSnapshot?.().referenceKeys[0]).toContain(
      "Saved reference",
    );
  });
});
