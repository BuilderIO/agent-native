import Image, { type ImageOptions } from "@tiptap/extension-image";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * The injectable async upload contract for the shared image block.
 *
 * An app provides this to turn a picked / pasted / dropped {@link File} into a
 * hosted image. It returns the final `src` (a hosted URL) plus an optional
 * `alt`. Plans wire it to the framework `upload-image` action; Content keeps its
 * own richer image block and does not use this contract.
 *
 * When NO upload function is supplied, the shared block still renders images and
 * round-trips `![alt](src)` markdown — it just cannot ingest local files (paste
 * of an image URL / markdown still works via the base node's input rules).
 */
export type ImageUploadFn = (
  file: File,
) => Promise<{ src: string; alt?: string }>;

export interface SharedImageOptions extends ImageOptions {
  /**
   * App-injected uploader. When present, the shared block accepts pasted /
   * dropped image files and the `/image` slash command, uploading each file
   * through this function and patching the node's `src` on resolve.
   */
  onImageUpload?: ImageUploadFn | null;
}

const sharedImageUploadPluginKey = new PluginKey("an-shared-image-upload");

/** A monotonically increasing id so concurrent uploads patch the right node. */
let uploadCounter = 0;
function nextUploadId(): string {
  uploadCounter += 1;
  return `an-img-${Date.now()}-${uploadCounter}`;
}

/** Image files only — never ingest non-image clipboard/drop payloads. */
function imageFilesFrom(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  return Array.from(data.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
}

/**
 * Insert a placeholder `image` node (empty `src`, transient `uploadId`) at
 * `pos` for every file, then resolve each upload and patch the matching node's
 * `src`. Mirrors Content's optimistic upload flow but is self-contained in the
 * shared extension so it works for ANY editor wrapper (the plan's
 * `SharedRichEditor` and Content's hand-rolled `useEditor` alike) without a new
 * `editorProps` seam.
 */
function uploadAndInsertImages(
  view: EditorView,
  files: File[],
  pos: number,
  upload: ImageUploadFn,
): void {
  if (files.length === 0) return;

  const pending: Array<{ uploadId: string; file: File }> = [];

  // Insert all placeholders first, top-down from `pos`, so multi-file
  // paste/drop keeps source order.
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
    // Advance past the inserted atom for the next placeholder.
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
        // Drop the placeholder so a failed upload does not leave an empty box.
        if (view.dom.isConnected && !view.isDestroyed) {
          removeUploadNode(view, item.uploadId);
        }
      }
    })();
  }
}

/** Find a placeholder node by its transient `uploadId` and return its position. */
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

/** Patch the resolved `src`/`alt` onto the placeholder and clear `uploadId`. */
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

/** Remove a placeholder whose upload failed. */
function removeUploadNode(view: EditorView, uploadId: string): void {
  const target = findUploadNode(view, uploadId);
  if (!target) return;
  const tr = view.state.tr.delete(target.pos, target.pos + target.nodeSize);
  view.dispatch(tr);
}

/**
 * The SHARED block-level image node. Built on `@tiptap/extension-image` (a
 * node named `image`), so:
 *
 *   - **GFM serialization** emits pure `![alt](src)` markdown via a block-aware
 *     `addStorage().markdown.serialize` (it calls `closeBlock` so a block image
 *     keeps its blank-line separator, byte-stable). It emits NO `<img width>`
 *     HTML, so plans stay source-syncable under the GFM `html:false` contract.
 *   - **Paste / drop** of local image files is handled by a self-contained
 *     ProseMirror plugin that calls the injected {@link ImageUploadFn}. Pasting
 *     an image URL or `![](url)` markdown works through the base node's input
 *     rules even when no uploader is supplied.
 *
 * The node adds one transient `uploadId` attribute (never parsed/rendered to
 * HTML, never serialized to markdown) used to track an in-flight upload.
 *
 * Content keeps its own richer `ImageNode` (Assets picker, AI alt-text, resize,
 * NFM `{color}` serialization) and does NOT use this shared node — both nodes
 * are named `image` but never coexist in the same editor because Content leaves
 * `features.image` off and injects its own via `extraExtensions`.
 */
export const SharedImage = Image.extend<SharedImageOptions>({
  // Block-level atom (Content's image is also a block atom). The base extension
  // is block when `inline:false`.
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
      // Transient: marks an in-flight upload so the plugin can patch `src` on
      // resolve. Never written to HTML or markdown.
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
      // A BLOCK-aware markdown serializer. tiptap-markdown's built-in fallback
      // for the `image` node is prosemirror-markdown's INLINE image serializer,
      // which omits the trailing block separator — so an image immediately
      // followed by a paragraph loses its blank line on round-trip. This
      // node-level spec (merged OVER the fallback by tiptap-markdown's
      // `getMarkdownSpec`) emits the same pure `![alt](src)` markdown but calls
      // `closeBlock`, so a block image stays byte-stable and source-syncable.
      // No `<img width>` / HTML is emitted, so the GFM `html:false` contract and
      // the plan round-trip corpus are preserved.
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

/**
 * Build the shared image extension, optionally wired with an app uploader.
 *
 * @example
 * createImageExtension({ onImageUpload: uploadEditorImage })
 */
export function createImageExtension(
  options: { onImageUpload?: ImageUploadFn | null } = {},
) {
  return SharedImage.configure({
    onImageUpload: options.onImageUpload ?? null,
    HTMLAttributes: { class: "an-rich-md-image" },
  });
}

/**
 * Open a native file picker, then upload + insert the chosen image(s) through
 * the same flow as paste/drop. Used by the `/image` slash command.
 */
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
