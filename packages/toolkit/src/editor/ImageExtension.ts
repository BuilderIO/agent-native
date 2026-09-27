import Image, { type ImageOptions } from "@tiptap/extension-image";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export type ImageUploadFn = (
  file: File,
) => Promise<{ src: string; alt?: string }>;

export interface SharedImageOptions extends ImageOptions {
  onImageUpload?: ImageUploadFn | null;
}

const sharedImageUploadPluginKey = new PluginKey("an-shared-image-upload");

let uploadCounter = 0;
function nextUploadId(): string {
  uploadCounter += 1;
  return `an-img-${Date.now()}-${uploadCounter}`;
}

function imageFilesFrom(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  return Array.from(data.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
}

function uploadAndInsertImages(
  view: EditorView,
  files: File[],
  pos: number,
  upload: ImageUploadFn,
): void {
  if (files.length === 0) return;

  const pending: Array<{ uploadId: string; file: File }> = [];

  let insertAt = pos;
  for (const file of files) {
    const uploadId = nextUploadId();
    const node = view.state.schema.nodes.image?.create({
      src: "",
      alt: "",
      uploadId,
    });
    if (!node) continue;
    const tr = view.state.tr.insert(insertAt, node);
    view.dispatch(tr);
    pending.push({ uploadId, file });
    insertAt += node.nodeSize;
  }

  for (const item of pending) {
    void (async () => {
      try {
        const { src, alt } = await upload(item.file);
        if (!view.dom.isConnected || view.isDestroyed) return;
        patchUploadNode(view, item.uploadId, { src, alt: alt ?? "" });
      } catch (error) {
        console.error("Image upload failed:", error);
        if (view.dom.isConnected && !view.isDestroyed) {
          removeUploadNode(view, item.uploadId);
        }
      }
    })();
  }
}

function findUploadNode(
  view: EditorView,
  uploadId: string,
): { pos: number; nodeSize: number } | null {
  let found: { pos: number; nodeSize: number } | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "image" && node.attrs.uploadId === uploadId) {
      found = { pos, nodeSize: node.nodeSize };
      return false;
    }
    return true;
  });
  return found;
}

function patchUploadNode(
  view: EditorView,
  uploadId: string,
  attrs: { src: string; alt: string },
): void {
  const target = findUploadNode(view, uploadId);
  if (!target) return;
  const node = view.state.doc.nodeAt(target.pos);
  if (!node) return;
  const tr = view.state.tr.setNodeMarkup(target.pos, undefined, {
    ...node.attrs,
    src: attrs.src,
    alt: attrs.alt,
    uploadId: null,
  });
  view.dispatch(tr);
}

function removeUploadNode(view: EditorView, uploadId: string): void {
  const target = findUploadNode(view, uploadId);
  if (!target) return;
  const tr = view.state.tr.delete(target.pos, target.pos + target.nodeSize);
  view.dispatch(tr);
}

export const SharedImage = Image.extend<SharedImageOptions>({
  inline: false,
  group: "block",

  addOptions() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      ...this.parent!(),
      onImageUpload: null,
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      uploadId: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },

  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(
          state: {
            esc: (s: string) => string;
            write: (s: string) => void;
            closeBlock: (n: unknown) => void;
          },
          node: { attrs: { src?: string; alt?: string; title?: string } },
        ) {
          const src = node.attrs.src ?? "";
          const alt = node.attrs.alt ?? "";
          const title = node.attrs.title ?? "";
          const titleSuffix = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
          state.write(`![${state.esc(alt)}](${state.esc(src)}${titleSuffix})`);
          state.closeBlock(node);
        },
        parse: {
          // Parsing `![alt](src)` is handled by markdown-it + the base node's
          // markdown input rule.
        },
      },
    };
  },

  addProseMirrorPlugins() {
    const upload = this.options.onImageUpload;
    const parentPlugins = this.parent?.() ?? [];
    if (!upload) return parentPlugins;

    return [
      ...parentPlugins,
      new Plugin({
        key: sharedImageUploadPluginKey,
        props: {
          handlePaste(view, event) {
            const files = imageFilesFrom(event.clipboardData);
            if (files.length === 0) return false;
            event.preventDefault();
            uploadAndInsertImages(
              view,
              files,
              view.state.selection.from,
              upload,
            );
            return true;
          },
          handleDrop(view, event) {
            const files = imageFilesFrom(event.dataTransfer);
            if (files.length === 0) return false;
            event.preventDefault();
            const coords = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            const pos = coords?.pos ?? view.state.selection.from;
            uploadAndInsertImages(view, files, pos, upload);
            return true;
          },
        },
      }),
    ];
  },
});

export function createImageExtension(
  options: { onImageUpload?: ImageUploadFn | null } = {},
) {
  return SharedImage.configure({
    onImageUpload: options.onImageUpload ?? null,
    HTMLAttributes: { class: "an-rich-md-image" },
  });
}

export function pickAndInsertImage(
  view: EditorView,
  upload: ImageUploadFn,
): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.style.display = "none";
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    input.remove();
    if (files.length === 0) return;
    uploadAndInsertImages(view, files, view.state.selection.from, upload);
  });
  document.body.appendChild(input);
  input.click();
}
