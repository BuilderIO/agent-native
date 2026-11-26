// @vitest-environment happy-dom

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

const upload = vi.hoisted(() => ({ audio: vi.fn() }));
vi.mock("../image-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../image-upload")>()),
  uploadAudioFile: upload.audio,
}));

import { byLabel, click, queryByLabel, renderUi } from "@/test-utils/render-ui";

import { AudioBlock } from "./AudioBlock";
import { AudioNode } from "./AudioNode";
import { ImageBlock } from "./ImageBlock";
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
        editor: { isEditable, isDestroyed: false, view: {}, on() {}, off() {} },
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

  // oracle-change: the ImageBlock.tsx/AudioBlock.tsx source greps became the rendered image and audio cases below
  describe("an image's and an audio's controls", () => {
    const blocks = {
      image: {
        Block: ImageBlock,
        src: "https://example.com/photo.png",
        resize: "editor.media.resizeImageFromLeft",
        comment: "editor.media.commentOnImage",
        more: "editor.media.moreImageActions",
        commentOption: "onImageComment",
      },
      audio: {
        Block: AudioBlock,
        src: "https://example.com/voice.mp3",
        resize: "editor.media.resizeAudioFromLeft",
        comment: "editor.media.commentOnAudio",
        more: "editor.media.moreAudioActions",
        commentOption: "onAudioComment",
      },
    } as const;

    function renderBlock(
      kind: keyof typeof blocks,
      isEditable: boolean,
      canMutateMedia: () => boolean,
    ) {
      const block = blocks[kind];
      const run = vi.fn();
      const chain = {
        command: () => chain,
        deleteRange: () => chain,
        run,
      };
      const updateAttributes = vi.fn();
      const props = {
        node: { attrs: { src: block.src, alt: "" }, type: { name: kind } },
        editor: {
          isEditable,
          isDestroyed: false,
          view: {},
          on() {},
          off() {},
          chain: () => chain,
        },
        selected: true,
        updateAttributes,
        extension: {
          options: { canMutateMedia, [block.commentOption]: vi.fn() },
        },
        getPos: () => 1,
      } as never;
      renderUi(
        createElement(TooltipProvider, null, createElement(block.Block, props)),
      );
      return { deleted: run, updateAttributes };
    }

    it.each([
      {
        who: "an editor",
        isEditable: true,
        canMutateMedia: true,
        mediaEdits: true,
        comment: true,
      },
      {
        who: "a suggesting editor",
        isEditable: true,
        canMutateMedia: false,
        mediaEdits: false,
        comment: true,
      },
      {
        who: "a reader",
        isEditable: false,
        canMutateMedia: true,
        mediaEdits: false,
        comment: false,
      },
    ] as const)(
      "shows $who, on an image and an audio clip, media edits: $mediaEdits, Comment: $comment",
      ({ isEditable, canMutateMedia, mediaEdits, comment }) => {
        for (const kind of ["image", "audio"] as const) {
          renderBlock(kind, isEditable, () => canMutateMedia);
          expect({
            kind,
            mediaEdits: queryByLabel(blocks[kind].resize) !== null,
            comment: queryByLabel(blocks[kind].comment) !== null,
          }).toEqual({ kind, mediaEdits, comment });
          document.body.replaceChildren();
        }
      },
    );

    it.each([
      { kind: "image", stillAllowed: true },
      { kind: "image", stillAllowed: false },
      { kind: "audio", stillAllowed: true },
      { kind: "audio", stillAllowed: false },
    ] as const)(
      "deletes the $kind from its menu only if the policy still allows it: $stillAllowed",
      async ({ kind, stillAllowed }) => {
        let allowed = true;
        const { deleted } = renderBlock(kind, true, () => allowed);
        await click(byLabel(blocks[kind].more));
        allowed = stillAllowed;
        const remove = Array.from(
          document.body.querySelectorAll('[role="menuitem"]'),
        ).find((item) => item.textContent === "editor.media.delete");
        if (!remove) throw new Error("The menu has no Delete.");
        await click(remove);

        expect(deleted).toHaveBeenCalledTimes(stillAllowed ? 1 : 0);
      },
    );

    it.each([true, false])(
      "keeps an audio upload that finishes while the policy allows it: %s",
      async (stillAllowed) => {
        let allowed = true;
        let finishUpload: (src: string) => void = () => {};
        upload.audio.mockReturnValueOnce(
          new Promise<string>((resolve) => {
            finishUpload = resolve;
          }),
        );
        const { updateAttributes } = renderBlock("audio", true, () => allowed);
        const input =
          document.body.querySelector<HTMLInputElement>('input[type="file"]');
        if (!input) throw new Error("The audio block has no file input.");
        Object.defineProperty(input, "files", {
          configurable: true,
          value: [new File(["sound"], "voice.mp3", { type: "audio/mpeg" })],
        });
        await act(async () => {
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        allowed = stillAllowed;
        await act(async () => finishUpload("https://example.com/new.mp3"));

        expect(updateAttributes).toHaveBeenCalledTimes(stillAllowed ? 1 : 0);
      },
    );
  });
});
