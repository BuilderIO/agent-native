import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";

import { renderPromptPopovers } from "./prompt-popovers";

const noop = vi.fn();

describe("Design editor prompt readiness", () => {
  it("requires AI readiness for both generation and tweak prompts", () => {
    const tree = renderPromptPopovers({
      editorCore: {
        isSignedIn: true,
        t: (key: string) => key,
        queryClient: { invalidateQueries: vi.fn() },
      },
      editorHistory: {
        isBuilderDesignEmbed: false,
        parentOriginRef: { current: null },
      },
      editorGenerationAndAccess: {
        canEditDesign: true,
        creativeContextLab: { isSuccess: true },
        setGenerationIssue: noop,
        persistPromptDesignSystem: noop,
        clearGenerationCompleteTimer: noop,
        generationModelRef: { current: {} },
        setHasPendingGeneration: noop,
        agentSubmit: vi.fn(),
        setGenerationChatTabId: noop,
        generating: false,
        promptAnchorRef: { current: null },
        tweaksEnabled: true,
        migrateMutation: { isPending: false },
        saveDesignAsTemplateMutation: {
          isPending: false,
          mutateAsync: vi.fn(),
        },
      },
      editorFilesAndSaving: {
        showPrompt: true,
        handlePromptOpenChange: noop,
        files: [],
        selectedPromptDesignSystemId: null,
        creativeContextEnabled: false,
        creativeContextPersistRef: { current: null },
        designSystemsLoading: false,
        promptDesignSystemId: null,
        designSystemOptions: [],
        setPromptDesignSystemId: noop,
        creativeContextOptions: [],
        creativeContextsQuery: { isLoading: false },
        creativeContextState: {
          state: { selectedContextId: null },
        },
        handleCreativeContextChange: noop,
        navigate: noop,
        showTweakPrompt: true,
        handleTweakPromptOpenChange: noop,
        tweakPromptAnchorRef: { current: null },
      },
      editorActiveScreenAndGeometry: {
        makeRealDialogOpen: false,
        setMakeRealDialogOpen: noop,
        migrationResult: null,
        handleConfirmMakeReal: noop,
      },
      editorLiveEditsAndPresence: {
        saveTemplateOpen: false,
        setSaveTemplateOpen: noop,
        durableLockedLayerCount: 0,
      },
      editorToolsAndVectors: { handleTweakPromptSubmit: noop },
      editorLayoutAndStructure: {
        historyOpen: false,
        setHistoryOpen: noop,
      },
      id: "design-1",
      design: { title: "Test design", description: "" },
    } as unknown as Parameters<typeof renderPromptPopovers>[0]);

    const children = Children.toArray(
      (tree as ReactElement<{ children: ReactNode }>).props.children,
    );
    const promptProps = children.flatMap((child) => {
      if (!isValidElement<Record<string, unknown>>(child)) return [];
      const title = child.props.title;
      if (
        title !== "designEditor.generateDesign" &&
        title !== "designEditor.tweaksPromptTitle"
      ) {
        return [];
      }
      return [child.props];
    });

    expect(promptProps).toHaveLength(2);
    expect(promptProps.map((props) => props.requireAgentEngine)).toEqual([
      true,
      true,
    ]);
  });
});
