// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => false,
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => ({ isSuccess: true, data: { configured: true } }),
}));

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    NodeViewWrapper: ({ children, ...props }: Record<string, unknown>) =>
      createElement("div", props, children as React.ReactNode),
  };
});

import { AudioNode } from "./AudioNode";
import { ImageNode } from "./ImageNode";
import { VideoBlock } from "./VideoBlock";
import { VideoNode } from "./VideoNode";

describe("media node suggestion policy", () => {
  it("keeps a live mutation policy on every media node", () => {
    let allowed = true;
    const canMutateMedia = () => allowed;
    const nodes = [ImageNode, VideoNode, AudioNode].map((node) =>
      node.configure({ canMutateMedia }),
    );

    expect(nodes.every((node) => node.options.canMutateMedia?.())).toBe(true);
    allowed = false;
    expect(nodes.every((node) => node.options.canMutateMedia?.())).toBe(false);
  });

  it("uses the policy for mutation controls while retaining comments", () => {
    const cases = [
      ["ImageBlock.tsx", "onImageComment"],
      ["AudioBlock.tsx", "onAudioComment"],
    ] as const;

    for (const [file, commentOption] of cases) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).toContain("options.canMutateMedia?.() ?? true");
      expect(source).toContain(`editor.isEditable && options.${commentOption}`);
      expect(source).toContain("if (canMutateMediaNow()) deleteNode()");
      if (file !== "ImageBlock.tsx") {
        expect(source).toContain("editor.isDestroyed || !canMutateMediaNow()");
      }
    }
  });

  describe("a video's controls", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    });

    afterEach(() => {
      act(() => root.unmount());
      document.body.replaceChildren();
      vi.unstubAllGlobals();
    });

    function controlsFor(
      isEditable: boolean,
      canMutateMedia: boolean,
      video: "has an id" | "goes by no id" | "can't be commented on",
    ) {
      const props = {
        node: {
          attrs: { src: "https://example.com/demo.mp4" },
          type: { name: "video" },
        },
        editor: { isEditable, isDestroyed: false, view: {} },
        selected: true,
        updateAttributes: vi.fn(),
        extension: {
          options: {
            canMutateMedia: () => canMutateMedia,
            ...(video === "can't be commented on"
              ? {}
              : {
                  onVideoComment: vi.fn(),
                  canCommentOnVideo: () => video === "has an id",
                }),
          },
        },
        getPos: () => 1,
      } as never;
      act(() =>
        root.render(
          createElement(
            QueryClientProvider,
            { client: new QueryClient() },
            createElement(
              TooltipProvider,
              null,
              createElement(VideoBlock, props),
            ),
          ),
        ),
      );
      const has = (label: string) =>
        container.querySelector(`[aria-label="${label}"]`) !== null;
      return {
        mediaEdits: has("editor.media.resizeVideoFromLeft"),
        comment: has("editor.media.commentOnVideo"),
      };
    }

    const editor = { isEditable: true, canMutateMedia: true };
    const suggesting = { isEditable: true, canMutateMedia: false };
    const reader = { isEditable: false, canMutateMedia: true };
    it.each([
      {
        who: "an editor",
        ...editor,
        video: "has an id",
        mediaEdits: true,
        comment: true,
      },
      {
        who: "an editor",
        ...editor,
        video: "can't be commented on",
        mediaEdits: true,
        comment: false,
      },
      {
        who: "a suggesting editor",
        ...suggesting,
        video: "has an id",
        mediaEdits: false,
        comment: true,
      },
      {
        who: "a suggesting editor",
        ...suggesting,
        video: "goes by no id",
        mediaEdits: false,
        comment: false,
      },
      {
        who: "a commenter",
        ...reader,
        video: "has an id",
        mediaEdits: false,
        comment: true,
      },
      {
        who: "a commenter",
        ...reader,
        video: "goes by no id",
        mediaEdits: false,
        comment: false,
      },
      {
        who: "a viewer",
        ...reader,
        video: "can't be commented on",
        mediaEdits: false,
        comment: false,
      },
    ] as const)(
      "shows $who, on a video that $video, media edits: $mediaEdits, Comment: $comment",
      ({ isEditable, canMutateMedia, video, mediaEdits, comment }) => {
        expect(controlsFor(isEditable, canMutateMedia, video)).toEqual({
          mediaEdits,
          comment,
        });
      },
    );
  });
});
