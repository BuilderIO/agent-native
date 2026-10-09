import { useT } from "@agent-native/core/client/i18n";
import { IconBold, IconList, IconTypography } from "@tabler/icons-react";
import { useEditorState, type Editor } from "@tiptap/react";
import type { MouseEvent } from "react";

import { Button } from "@/components/ui/button";

export function DirectoryWidgetFormattingToolbar({
  editor,
}: {
  editor: Editor;
}) {
  const t = useT();
  const activeFormatting = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      paragraph: currentEditor.isActive("paragraph"),
      bold: currentEditor.isActive("bold"),
      bulletList: currentEditor.isActive("bulletList"),
    }),
  });
  const keepEditorSelection = (event: MouseEvent<HTMLButtonElement>) =>
    event.preventDefault();

  return (
    <div
      className="flex h-10 min-w-0 items-center gap-1 overflow-x-auto border-b bg-background px-2"
      data-content-widget-format-toolbar=""
      role="toolbar"
      aria-label={t("editor.slash.text")}
    >
      <Button
        type="button"
        className="size-8 shrink-0"
        size="icon"
        variant="ghost"
        aria-label={t("editor.slash.text")}
        title={t("editor.slash.text")}
        aria-pressed={activeFormatting.paragraph}
        onMouseDown={keepEditorSelection}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        <IconTypography size={16} />
      </Button>
      <Button
        type="button"
        className="size-8 shrink-0"
        size="icon"
        variant="ghost"
        aria-label={t("editor.bold")}
        title={t("editor.bold")}
        aria-pressed={activeFormatting.bold}
        onMouseDown={keepEditorSelection}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <IconBold size={16} />
      </Button>
      <Button
        type="button"
        className="size-8 shrink-0"
        size="icon"
        variant="ghost"
        aria-label={t("editor.slash.bulletedList")}
        title={t("editor.slash.bulletedList")}
        aria-pressed={activeFormatting.bulletList}
        onMouseDown={keepEditorSelection}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <IconList size={16} />
      </Button>
    </div>
  );
}
