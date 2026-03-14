import { useEditor, EditorContent } from "@tiptap/react";
import { authFetch } from "@/lib/auth-fetch";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table as BaseTable } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useCallback, useState } from "react";
import { BubbleToolbar } from "./BubbleToolbar";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { LinkHoverPreview } from "./LinkHoverPreview";
import { TableHoverControls } from "./TableHoverControls";
import { InlineImageGen } from "./InlineImageGen";
import { ImageNode } from "./extensions/ImageNode";
import { VideoNode } from "./extensions/VideoNode";
import { useMediaUpload, isImageFile, isVideoFile, isMediaFile } from "@/hooks/use-media-upload";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

function isTransientMediaSrc(src: unknown): src is string {
  return typeof src === "string" && src.startsWith("blob:");
}

function isPersistableMediaSrc(src: unknown): src is string {
  return typeof src === "string" && src.length > 0 && !isTransientMediaSrc(src);
}

const CustomTable = BaseTable.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.inTable = true;
          node.forEach((row: any, _p: number, i: number) => {
            state.write("| ");
            row.forEach((col: any, _p: number, j: number) => {
              if (j) {
                state.write(" | ");
              }
              // Render all content inside the cell, using <br> for new paragraphs
              col.forEach((child: any, _offset: number, index: number) => {
                if (index > 0) state.write("<br>");

                if (child.type.name === "image") {
                  const src = child.attrs.src || "";
                  const alt = child.attrs.alt || "";
                  const title = child.attrs.title || "";
                  const escapedTitle = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
                  state.write(`![${state.esc(alt)}](${state.esc(src)}${escapedTitle})`);
                } else if (child.type.name === "video") {
                  const src = child.attrs.src;
                  const title = child.attrs.title || "";
                  if (isPersistableMediaSrc(src)) {
                    state.write(`<video src="${src}" controls${title ? ` title="${title}"` : ""}></video>`);
                  }
                } else if (child.isTextblock) {
                  // Intercept writes to prevent newlines inside table cells
                  const oldWrite = state.write;
                  state.write = function (str?: string) {
                    if (str === undefined) {
                      oldWrite.call(this);
                    } else {
                      oldWrite.call(this, str.replace(/\n/g, "<br>"));
                    }
                  };
                  state.renderInline(child);
                  state.write = oldWrite;
                } else {
                  // Fallback: render text content only, stripped of newlines
                  state.write(state.esc(child.textContent || "").replace(/\n/g, " "));
                }
              });
            });
            state.write(" |");
            state.ensureNewLine();

            // After the first row, write the Markdown table delimiter
            if (i === 0) {
              const delimiterRow = Array.from({ length: row.childCount })
                .map(() => "---")
                .join(" | ");
              state.write(`| ${delimiterRow} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {
          // Handled by markdown-it
        },
      },
    };
  },
});

interface PendingUploadLocator {
  uploadId: string;
  tempUrl: string;
}

function findPendingUploadNode(
  doc: any,
  { uploadId, tempUrl }: PendingUploadLocator
): { node: any; nodePos: number; matchedBy: "uploadId" | "tempUrl" } | null {
  let fallbackMatch: { node: any; nodePos: number; matchedBy: "uploadId" | "tempUrl" } | null = null;

  doc.descendants((node: any, pos: number) => {
    if (node.attrs?.uploadId === uploadId) {
      fallbackMatch = { node, nodePos: pos, matchedBy: "uploadId" };
      return false;
    }

    if (!fallbackMatch && node.attrs?.uploading && node.attrs?.src === tempUrl) {
      fallbackMatch = { node, nodePos: pos, matchedBy: "tempUrl" };
    }

    return true;
  });

  return fallbackMatch;
}

function updatePendingUploadStatus(
  editor: any,
  locator: PendingUploadLocator,
  status: "uploading" | "processing"
): boolean {
  if (!editor || editor.isDestroyed) return false;

  const match = findPendingUploadNode(editor.state.doc, locator);
  if (!match) return false;

  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(match.nodePos, undefined, {
      ...match.node.attrs,
      uploading: true,
      uploadStatus: status,
    })
  );
  return true;
}

function applyPendingUploadResult(
  editor: any,
  locator: PendingUploadLocator,
  result: { url: string } | null
): "updated" | "removed" | "missing" {
  if (!editor || editor.isDestroyed) return "missing";

  const match = findPendingUploadNode(editor.state.doc, locator);
  if (!match) return "missing";

  if (result) {
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(match.nodePos, undefined, {
        ...match.node.attrs,
        src: result.url,
        uploading: false,
        uploadId: null,
        uploadStatus: null,
      })
    );
    return "updated";
  }

  editor.view.dispatch(editor.state.tr.delete(match.nodePos, match.nodePos + match.node.nodeSize));
  return "removed";
}

function removePendingUploadNode(editor: any, locator: PendingUploadLocator): boolean {
  if (!editor || editor.isDestroyed) return false;

  const match = findPendingUploadNode(editor.state.doc, locator);
  if (!match) return false;

  editor.view.dispatch(editor.state.tr.delete(match.nodePos, match.nodePos + match.node.nodeSize));
  return true;
}

function finalizePendingUpload(
  editor: any,
  {
    fileName,
    locator,
    result,
    context,
  }: {
    fileName: string;
    locator: PendingUploadLocator;
    result: { url: string } | null;
    context: "drop" | "paste";
  }
): boolean {
  try {
    const outcome = applyPendingUploadResult(editor, locator, result);
    if (outcome === "updated" || outcome === "removed") {
      return true;
    }

    const removed = removePendingUploadNode(editor, locator);

    console.warn(`[editor] Uploaded media node could not be reconciled during ${context}`, {
      fileName,
      uploadId: locator.uploadId,
      tempUrl: locator.tempUrl,
      hasResult: Boolean(result),
      removed,
    });

    if (result) {
      toast.error(`Could not finish uploading ${fileName} in the editor.`);
    }

    return removed;
  } catch (error) {
    console.error(`[editor] Failed to reconcile ${context} media upload`, {
      fileName,
      uploadId: locator.uploadId,
      tempUrl: locator.tempUrl,
      error,
    });

    const removed = removePendingUploadNode(editor, locator);
    toast.error(`Could not finish uploading ${fileName} in the editor.`);
    return removed;
  }
}

interface VisualEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  projectSlug: string;
  filePath?: string;
  editable?: boolean;
}

export function VisualEditor({
  content,
  onChange,
  projectSlug,
  filePath,
  editable = true,
}: VisualEditorProps) {
  const isSettingContent = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const { upload, isUploading } = useMediaUpload(projectSlug);
  const [isDragging, setIsDragging] = useState(false);
  const [imageGenText, setImageGenText] = useState<string | null>(null);
  const imageGenInsertPos = useRef<number | null>(null);
  const [imageGenTopOffset, setImageGenTopOffset] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const selectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleUpload = useCallback(
    async (file: File) => {
      const result = await upload(file);
      if (result) {
        return { url: result.url, type: result.type };
      }
      return null;
    },
    [upload]
  );

  const handlePendingUpload = useCallback(
    async (file: File, locator: PendingUploadLocator) => {
      const result = await upload(file, {
        onStatusChange: (status) => {
          updatePendingUploadStatus(editorRef.current, locator, status);
        },
      });
      if (result) return { url: result.url };
      return null;
    },
    [upload]
  );

  const handleUploadForNode = useCallback(
    async (file: File, options?: { onStatusChange?: (status: "uploading" | "processing") => void }) => {
      const result = await upload(file, options);
      if (result) return { url: result.url };
      return null;
    },
    [upload]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: {
          HTMLAttributes: { class: "notion-code-block" },
        },
        horizontalRule: {},
        dropcursor: { color: "hsl(243 75% 59%)", width: 2 },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") {
            const level = node.attrs.level;
            if (level === 1) return "Heading 1";
            if (level === 2) return "Heading 2";
            return "Heading 3";
          }
          return "Start writing your post here...";
        },
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "notion-link" },
      }),
      TaskList.configure({
        HTMLAttributes: { class: "notion-task-list" },
      }),
      TaskItem.configure({
        nested: true,
      }),
      ImageNode.configure({
        HTMLAttributes: { class: "notion-image" },
        onUpload: handleUploadForNode,
        projectSlug,
        articleContent: content,
      }),
      VideoNode.configure({
        HTMLAttributes: { class: "notion-video" },
        onUpload: handleUploadForNode,
      }),
      CustomTable.configure({
        resizable: false,
        HTMLAttributes: { class: "notion-table" },
      }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class: "notion-editor",
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !event.dataTransfer?.files?.length) return false;

        const files = Array.from(event.dataTransfer.files);
        const mediaFiles = files.filter(isMediaFile);
        if (mediaFiles.length === 0) return false;

        event.preventDefault();

        // Get drop position
        const pos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });

        let insertPos = pos?.pos ?? view.state.doc.content.size;

        mediaFiles.forEach((file) => {
          const tempUrl = URL.createObjectURL(file);
          const uploadId = Math.random().toString(36).substring(7);
          const pendingUpload = { uploadId, tempUrl };

          // Ensure insertPos is within bounds
          if (insertPos > view.state.doc.content.size) {
            insertPos = view.state.doc.content.size;
          }

          // Re-resolve position
          const $pos = view.state.doc.resolve(insertPos);
          if ($pos.parent.type.name === 'heading') {
            if (insertPos === $pos.start()) {
              insertPos = $pos.before();
            } else {
              insertPos = $pos.after();
            }
          }

          const isVideo = file.type.startsWith("video/");
          editor.commands.insertContentAt(insertPos, {
            type: isVideo ? "video" : "image",
            attrs: { src: tempUrl, uploading: true, uploadId, uploadStatus: "uploading" },
          });

          // Advance insertPos so subsequent files are inserted after this one
          insertPos += 1;

          void handlePendingUpload(file, pendingUpload)
            .then((result) => {
              const shouldRevokeTempUrl = finalizePendingUpload(editor, {
                fileName: file.name,
                locator: pendingUpload,
                result,
                context: "drop",
              });

              if (shouldRevokeTempUrl) {
                URL.revokeObjectURL(tempUrl);
              }
            })
            .catch((error) => {
              console.error("[editor] Media upload request failed during drop", {
                fileName: file.name,
                uploadId,
                tempUrl,
                error,
              });

              const removed = removePendingUploadNode(editor, pendingUpload);
              if (removed) {
                URL.revokeObjectURL(tempUrl);
              }
              toast.error(`Could not finish uploading ${file.name} in the editor.`);
            });
        });

        return true;
      },
      handlePaste: (view, event) => {
        const files = event.clipboardData?.files;
        if (!files?.length) return false;

        const mediaFiles = Array.from(files).filter(isMediaFile);
        if (mediaFiles.length === 0) return false;

        event.preventDefault();

        let insertPos = view.state.selection.from;

        mediaFiles.forEach((file) => {
          const tempUrl = URL.createObjectURL(file);
          const uploadId = Math.random().toString(36).substring(7);
          const pendingUpload = { uploadId, tempUrl };

          // Ensure insertPos is within bounds
          if (insertPos > view.state.doc.content.size) {
            insertPos = view.state.doc.content.size;
          }

          const $pos = view.state.doc.resolve(insertPos);
          if ($pos.parent.type.name === 'heading') {
            if (insertPos === $pos.start()) {
              insertPos = $pos.before();
            } else {
              insertPos = $pos.after();
            }
          }

          const isVideo = file.type.startsWith("video/");
          editor.commands.insertContentAt(insertPos, {
            type: isVideo ? "video" : "image",
            attrs: { src: tempUrl, uploading: true, uploadId, uploadStatus: "uploading" },
          });

          insertPos += 1;

          void handlePendingUpload(file, pendingUpload)
            .then((result) => {
              const shouldRevokeTempUrl = finalizePendingUpload(editor, {
                fileName: file.name,
                locator: pendingUpload,
                result,
                context: "paste",
              });

              if (shouldRevokeTempUrl) {
                URL.revokeObjectURL(tempUrl);
              }
            })
            .catch((error) => {
              console.error("[editor] Media upload request failed during paste", {
                fileName: file.name,
                uploadId,
                tempUrl,
                error,
              });

              const removed = removePendingUploadNode(editor, pendingUpload);
              if (removed) {
                URL.revokeObjectURL(tempUrl);
              }
              toast.error(`Could not finish uploading ${file.name} in the editor.`);
            });
        });

        return true;
      },
    },
    onUpdate: ({ editor }) => {
      if (isSettingContent.current) return;
      try {
        const md = (editor.storage as any).markdown.getMarkdown();
        onChangeRef.current(md);
      } catch (err: any) {
        toast.error("Markdown serialization error: " + err.message);
        console.error("Markdown serialization error:", err);
      }
    },
    onSelectionUpdate: ({ editor }) => {
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current);
      }
      selectionTimeoutRef.current = setTimeout(() => {
        const sel = editor.state.selection;
        const { from, to } = sel;

        // Check for node selection (image, video, etc.)
        const node = (sel as any).node;
        if (node) {
          const selectionData: Record<string, unknown> = {
            projectSlug,
            filePath,
            type: node.type.name,
            from,
            to,
          };
          if (node.type.name === "image") {
            selectionData.imageSrc = node.attrs.src;
            selectionData.imageAlt = node.attrs.alt || "";
            selectionData.text = `[Image: ${node.attrs.alt || node.attrs.src}]`;
          } else if (node.type.name === "video") {
            selectionData.videoSrc = node.attrs.src;
            selectionData.text = `[Video: ${node.attrs.src}]`;
          }
          authFetch("/api/selection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(selectionData),
          }).catch(() => {});
          return;
        }

        if (from === to) {
          // No text selected — clear
          authFetch("/api/selection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: null, filePath: null }),
          }).catch(() => {});
          return;
        }
        const text = editor.state.doc.textBetween(from, to, " ");
        authFetch("/api/selection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectSlug, filePath, text, from, to, type: "text" }),
        }).catch(() => {});
      }, 300);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  // Sync content from outside (when file changes)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const currentMd = (editor.storage as any).markdown.getMarkdown();
    if (currentMd !== content) {
      if (editor.isFocused) {
        // Don't interrupt the user's typing with external content changes
        // The editor's internal state is the source of truth while focused
        return;
      }
      isSettingContent.current = true;
      editor.commands.setContent(content);
      isSettingContent.current = false;
    }
  }, [content, editor]);

  // Drag-and-drop zone events for the wrapper
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only set false if we're leaving the wrapper itself
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(() => {
    setIsDragging(false);
  }, []);

  if (!editor) return null;

  return (
    <div
      ref={wrapperRef}
      className={`visual-editor-wrapper ${isDragging ? "visual-editor-wrapper--dragging" : ""}`}
      style={{ position: 'relative' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isUploading && (
        <div className="media-upload-indicator">
          <Loader2 size={16} className="animate-spin" />
          <span>Uploading...</span>
        </div>
      )}
      {isDragging && (
        <div className="media-drop-overlay">
          <div className="media-drop-overlay__content">
            <span>Drop image or video here</span>
          </div>
        </div>
      )}
      <BubbleToolbar
        editor={editor}
        onGenerateImage={(text) => {
          // Store the end of the current selection to insert image after it
          const { to } = editor.state.selection;
          // Find the end of the current block node
          const resolved = editor.state.doc.resolve(to);
          const endOfBlock = resolved.end(resolved.depth);
          imageGenInsertPos.current = endOfBlock;

          // Find the DOM node for the block to compute position
          try {
            const blockNode = editor.view.domAtPos(resolved.start(resolved.depth));
            const blockEl = blockNode.node instanceof HTMLElement
              ? blockNode.node
              : blockNode.node.parentElement;
            if (blockEl && wrapperRef.current) {
              const blockRect = blockEl.getBoundingClientRect();
              const wrapperRect = wrapperRef.current.getBoundingClientRect();
              setImageGenTopOffset(blockRect.bottom - wrapperRect.top);
            }
          } catch {
            setImageGenTopOffset(null);
          }
          setImageGenText(text);
        }}
      />
      <SlashCommandMenu editor={editor} onUpload={handleUpload} />
      <LinkHoverPreview editor={editor} />
      <TableHoverControls editor={editor} />
      <EditorContent editor={editor} />
      {imageGenText && (
        <div
          style={imageGenTopOffset != null ? {
            position: 'absolute',
            top: imageGenTopOffset,
            left: 0,
            right: 0,
            zIndex: 10,
          } : undefined}
        >
          <InlineImageGen
            selectedText={imageGenText}
            projectSlug={projectSlug}
            onClose={() => {
              setImageGenText(null);
              imageGenInsertPos.current = null;
              setImageGenTopOffset(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
