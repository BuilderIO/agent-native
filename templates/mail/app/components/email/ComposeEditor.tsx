import { useT } from "@agent-native/core/client/i18n";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import type { EditorView } from "@tiptap/pm/view";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useImperativeHandle,
  forwardRef,
} from "react";
import { Markdown } from "tiptap-markdown";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";

import { CodeBlockLangPicker } from "./CodeBlockLangPicker";
import {
  createComposeAutocompleteExtension,
  handleComposeAutocompleteKeyDown,
  refreshComposeAutocomplete,
  type ComposeAutocompleteOptions,
} from "./compose-autocomplete";
import {
  shouldApplyComposeContent,
  COMPOSE_TYPING_GRACE_MS,
} from "./compose-draft-context";
import { handleComposeSendShortcut } from "./compose-shortcuts";
import { ComposeBubbleToolbar } from "./ComposeBubbleToolbar";
import { ComposeSlashMenu } from "./ComposeSlashMenu";
import { ComposeImageNode } from "./extensions/ComposeImageNode";

const lowlight = createLowlight(common);

export interface ComposeEditorHandle {
  toggleBold: () => void;
  toggleItalic: () => void;
  setLink: () => void;
  isActive: (name: string) => boolean;
  getEditor: () => Editor | null;
}

interface ComposeEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  onGenerate: () => void;
  onSend: (markDone?: boolean) => void;
  onClose: () => void;
  onFlush: () => Promise<unknown> | undefined;
  isGenerating: boolean;
  autocompleteEnabled: boolean;
  draftId: string;
  getCurrentDraftBody: (editor: Editor) => string;
  sendToAgent: (opts: {
    message: string;
    context?: string;
    submit?: boolean;
  }) => void;
  onUploadImage: (file: File) => Promise<string>;
}

export const ComposeEditor = forwardRef<
  ComposeEditorHandle,
  ComposeEditorProps
>(function ComposeEditor(
  {
    content,
    onChange,
    onGenerate,
    onSend,
    onClose,
    onFlush,
    isGenerating,
    autocompleteEnabled,
    draftId,
    getCurrentDraftBody,
    sendToAgent,
    onUploadImage,
  },
  ref,
) {
  const t = useT();
  const isMobile = useIsMobile();
  const autocompleteOptionsRef = useRef<ComposeAutocompleteOptions>({
    enabled: autocompleteEnabled,
    isMobile,
  });
  autocompleteOptionsRef.current = {
    enabled: autocompleteEnabled,
    isMobile,
  };
  const previousAutocompleteOptionsRef = useRef(autocompleteOptionsRef.current);
  const autocompleteExtension = useMemo(
    () =>
      createComposeAutocompleteExtension(() => autocompleteOptionsRef.current),
    [],
  );
  const isSettingContent = useRef(false);
  const lastTypedAtRef = useRef(0);
  const pendingComposeContentRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const onSendRef = useRef(onSend);
  const onCloseRef = useRef(onClose);
  const onUploadImageRef = useRef(onUploadImage);
  onChangeRef.current = onChange;
  onSendRef.current = onSend;
  onCloseRef.current = onClose;
  onUploadImageRef.current = onUploadImage;

  const insertUploadingImage = (
    view: EditorView,
    file: File,
    atPos?: number,
  ) => {
    const objectUrl = URL.createObjectURL(file);
    const imageType = view.state.schema.nodes.image;
    if (!imageType) return;

    const insertTr = view.state.tr;
    const imageNode = imageType.create({ src: objectUrl, alt: "" });
    if (atPos != null) {
      insertTr.insert(atPos, imageNode);
    } else {
      insertTr.replaceSelectionWith(imageNode);
    }
    view.dispatch(insertTr);

    const findNodePos = () => {
      let found: number | null = null;
      view.state.doc.descendants((node, pos) => {
        if (found != null) return false;
        if (node.type.name === "image" && node.attrs.src === objectUrl) {
          found = pos;
          return false;
        }
        return true;
      });
      return found;
    };

    void onUploadImageRef
      .current(file)
      .then((url) => {
        const pos = findNodePos();
        if (pos == null) return;
        const tr = view.state.tr.setNodeAttribute(pos, "src", url);
        view.dispatch(tr);
      })
      .catch(() => {
        const pos = findNodePos();
        if (pos == null) return;
        const node = view.state.doc.nodeAt(pos);
        if (!node) return;
        const tr = view.state.tr.delete(pos, pos + node.nodeSize);
        view.dispatch(tr);
      })
      .finally(() => {
        URL.revokeObjectURL(objectUrl);
      });
  };
  const insertUploadingImageRef = useRef(insertUploadingImage);
  insertUploadingImageRef.current = insertUploadingImage;

  const editor = useEditor({
    extensions: [
      autocompleteExtension,
      (StarterKit as any).configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        link: false,
        dropcursor: { color: "hsl(220 10% 40%)", width: 2 },
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: { class: "compose-code-block" },
      }),
      ComposeImageNode.configure({
        allowBase64: true,
      }),
      Placeholder.configure({
        placeholder: t("mail.compose.writeMessagePlaceholder"),
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "compose-link" },
      }),
      Markdown.configure({
        html: false,
        linkify: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class: "compose-editor",
      },
      handleKeyDown: (_view, event) => {
        if (
          handleComposeAutocompleteKeyDown(
            _view,
            event,
            () => autocompleteOptionsRef.current,
          )
        ) {
          return true;
        }
        if (handleComposeSendShortcut(event, onSendRef.current)) return true;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.items ?? [])
          .filter(
            (item) => item.kind === "file" && item.type.startsWith("image/"),
          )
          .map((item) => item.getAsFile())
          .filter((file): file is File => file != null);
        if (files.length === 0) return false;
        event.preventDefault();
        for (const file of files) {
          insertUploadingImageRef.current(view, file);
        }
        return true;
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter(
          (file) => file.type.startsWith("image/"),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        const dropPos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        for (const file of files) {
          insertUploadingImageRef.current(view, file, dropPos?.pos);
        }
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      if (isSettingContent.current) return;
      lastTypedAtRef.current = Date.now();
      try {
        const md = (editor.storage as any).markdown.getMarkdown();
        onChangeRef.current(md);
      } catch {
        // ignore serialization errors
      }
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const previous = previousAutocompleteOptionsRef.current;
    if (
      previous.enabled === autocompleteOptionsRef.current.enabled &&
      previous.isMobile === autocompleteOptionsRef.current.isMobile
    ) {
      return;
    }
    previousAutocompleteOptionsRef.current = autocompleteOptionsRef.current;
    refreshComposeAutocomplete(editor.view);
  }, [autocompleteEnabled, editor, isMobile]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      if (cancelled || !editor || editor.isDestroyed) return;
      const currentMd = (editor.storage as any).markdown.getMarkdown();

      if (
        content !== currentMd &&
        content !== pendingComposeContentRef.current
      ) {
        pendingComposeContentRef.current = content;
      }

      const nextContent = pendingComposeContentRef.current;
      if (nextContent == null) return;
      if (currentMd === nextContent) {
        pendingComposeContentRef.current = null;
        return;
      }

      if (
        !shouldApplyComposeContent({
          currentMarkdown: currentMd,
          nextContent,
          editorFocused: editor.isFocused,
          lastTypedAt: lastTypedAtRef.current,
          now: Date.now(),
        })
      ) {
        retryTimer = setTimeout(run, COMPOSE_TYPING_GRACE_MS);
        return;
      }

      pendingComposeContentRef.current = null;
      isSettingContent.current = true;
      editor.commands.setContent(nextContent);
      isSettingContent.current = false;
    };

    run();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [content, editor]);

  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const applyLink = () => {
    if (!editor || !linkUrl.trim()) return;
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: linkUrl.trim() })
      .run();
    setLinkUrl("");
    setShowLinkDialog(false);
  };

  useImperativeHandle(ref, () => ({
    toggleBold: () => {
      (editor?.chain().focus() as any)?.toggleBold().run();
    },
    toggleItalic: () => {
      (editor?.chain().focus() as any)?.toggleItalic().run();
    },
    setLink: () => {
      if (!editor) return;
      if (editor.isActive("link")) {
        editor.chain().focus().unsetLink().run();
        return;
      }
      setLinkUrl("");
      setShowLinkDialog(true);
    },
    isActive: (name: string) => editor?.isActive(name) ?? false,
    getEditor: () => editor,
  }));

  if (!editor) return null;

  return (
    <div className="compose-editor-wrapper" style={{ position: "relative" }}>
      <ComposeBubbleToolbar
        editor={editor}
        onFlush={onFlush}
        isGenerating={isGenerating}
        draftId={draftId}
        getCurrentDraftBody={getCurrentDraftBody}
        sendToAgent={sendToAgent}
      />
      <ComposeSlashMenu
        editor={editor}
        onGenerate={onGenerate}
        onUploadImage={onUploadImage}
      />
      <CodeBlockLangPicker editor={editor} />
      <EditorContent editor={editor} />

      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("mail.compose.insertLink")}</DialogTitle>
            <DialogDescription>
              {t("mail.compose.enterLinkUrl")}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://example.com"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLinkDialog(false)}>
              {t("mail.compose.cancel")}
            </Button>
            <Button onClick={applyLink} disabled={!linkUrl.trim()}>
              {t("mail.compose.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
