// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { VideoNode } from "./VideoNode";

describe("VideoNode source panel state", () => {
  it("keeps an open empty-video source panel in editor state but not HTML", () => {
    const editor = new Editor({
      extensions: [StarterKit, VideoNode],
      content: "<p></p>",
    });

    editor.commands.insertContent({
      type: "video",
      attrs: { src: null, sourcePanelOpen: true, sourceTab: "upload" },
    });
    editor.commands.updateAttributes("video", { sourceTab: "link" });

    const video = editor
      .getJSON()
      .content?.find((node) => node.type === "video");
    expect(video?.attrs).toMatchObject({
      src: null,
      sourcePanelOpen: true,
      sourceTab: "link",
    });
    expect(editor.getHTML()).not.toContain("sourcePanelOpen");

    editor.destroy();
  });
});
