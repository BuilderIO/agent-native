// @vitest-environment happy-dom

import type { CommentImage } from "@shared/comment-images";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { richEditorValue } from "./comment-composer-test-utils";
import { CommentComposer } from "./CommentComposer";

const uploads = vi.hoisted(() => ({
  finish: [] as Array<(image: CommentImage) => void>,
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock("./comment-images", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./comment-images")>()),
  useCommentImageStorage: () => true,
  uploadCommentImage: () =>
    new Promise<CommentImage>((resolve) => {
      uploads.finish.push(resolve);
    }),
}));

function image(name: string): CommentImage {
  return {
    url: `/api/private-media/${name}`,
    name: `${name}.png`,
    contentType: "image/png",
  };
}

describe("CommentComposer images", () => {
  let container: HTMLDivElement;
  let root: Root;
  const submit = vi.fn();

  function Owner({ initialImages }: { initialImages: CommentImage[] }) {
    const [value, setValue] = useState("Here's what I see");
    const [images, setImages] = useState(initialImages);
    return (
      <CommentComposer
        value={value}
        onChange={setValue}
        onSubmit={submit}
        mentions={[]}
        onMentionsChange={vi.fn()}
        images={images}
        onImagesChange={setImages}
        imageDocumentId="doc-1"
      />
    );
  }

  async function render(initialImages: CommentImage[] = []) {
    await act(async () => root.render(<Owner initialImages={initialImages} />));
  }

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  function find<T extends HTMLElement>(selector: string): T {
    const element = container.querySelector<T>(selector);
    if (!element) throw new Error(`Nothing matches ${selector}`);
    return element;
  }
  const editor = () => find(".ProseMirror");
  const removeButton = (name: string) =>
    find<HTMLButtonElement>(`[aria-label="Remove image: ${name}.png"]`);
  const pressEnter = () =>
    act(async () => {
      editor().focus();
      editor().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

  beforeEach(() => {
    submit.mockClear();
    uploads.finish = [];
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  // The removed button takes focus with it; a keyboard user would land on
  // the page body and have to find the comment again.
  it("hands focus to the next image, then back to the box, as images are removed", async () => {
    await render([image("one"), image("two"), image("three")]);

    await act(async () => removeButton("two").focus());
    await act(async () => removeButton("two").click());
    await settle();
    expect(document.activeElement).toBe(removeButton("three"));

    await act(async () => removeButton("three").click());
    await settle();
    expect(document.activeElement).toBe(removeButton("one"));

    await act(async () => removeButton("one").click());
    await settle();
    expect(container.querySelector("[data-review-composer-image]")).toBeNull();
    expect(editor().contains(document.activeElement)).toBe(true);
  });

  it("keeps the text on Enter while an image uploads, and sends once it's done", async () => {
    await render();
    const input = find<HTMLInputElement>("[data-comment-image-input]");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File([new Uint8Array(3)], "shot.png", { type: "image/png" })],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(uploads.finish).toHaveLength(1);

    await pressEnter();
    await settle();
    expect(submit).not.toHaveBeenCalled();
    expect(richEditorValue(editor())).toBe("Here's what I see");

    const finish = uploads.finish.shift();
    if (!finish) throw new Error("The image never started uploading");
    await act(async () => finish(image("shot")));
    await settle();
    expect(removeButton("shot").isConnected).toBe(true);
    await pressEnter();
    await settle();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
