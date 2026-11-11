import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@agent-native/toolkit/ui/popover";
import { cn } from "@agent-native/toolkit/utils";
import {
  IconBold,
  IconCheck,
  IconCode,
  IconItalic,
  IconLink,
  IconStrikethrough,
  IconUnlink,
} from "@tabler/icons-react";
import { posToDOMRect, type Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import { useMemo, type ComponentType } from "react";

export interface ReviewComposerFormatLabels {
  /** The toolbar's accessible name. */
  toolbar: string;
  bold: string;
  italic: string;
  strike: string;
  code: string;
  link: string;
  linkField: string;
  linkPlaceholder: string;
  applyLink: string;
  removeLink: string;
}

const DEFAULT_LABELS: ReviewComposerFormatLabels = {
  toolbar: "Formatting",
  bold: "Bold",
  italic: "Italic",
  strike: "Strikethrough",
  code: "Code",
  link: "Link",
  linkField: "Link address",
  linkPlaceholder: "Paste a link",
  applyLink: "Apply link",
  removeLink: "Remove link",
};

type MarkName = "bold" | "italic" | "strike" | "code";

const MARK_BUTTONS: readonly {
  mark: MarkName;
  icon: ComponentType<{ className?: string }>;
  keys: string;
}[] = [
  { mark: "bold", icon: IconBold, keys: "Control+B Meta+B" },
  { mark: "italic", icon: IconItalic, keys: "Control+I Meta+I" },
  {
    mark: "strike",
    icon: IconStrikethrough,
    keys: "Control+Shift+S Meta+Shift+S",
  },
  { mark: "code", icon: IconCode, keys: "Control+E Meta+E" },
];

interface Measurable {
  getBoundingClientRect: () => DOMRect;
  contextElement?: Element;
}

/**
 * The bar over selected text in the comment box: bold, italic, struck, code
 * and a link. Its buttons keep focus in the editor; the link field takes it
 * while it's open. Cmd/Ctrl+K opens the link field too.
 */
export function ReviewComposerToolbar({
  editor,
  labels: labelOverrides,
  linkDraft,
  onLinkDraftChange,
  onOpenLink,
}: {
  editor: Editor | null;
  labels?: Partial<ReviewComposerFormatLabels> | undefined;
  /** The link field's text while it's open, else null. */
  linkDraft: string | null;
  onLinkDraftChange: (draft: string | null) => void;
  onOpenLink: () => void;
}) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance || instance.isDestroyed) return null;
      const { selection } = instance.state;
      return {
        selecting:
          instance.isFocused &&
          instance.isEditable &&
          !selection.empty &&
          !(selection instanceof NodeSelection) &&
          !instance.isActive("codeBlock"),
        from: selection.from,
        to: selection.to,
        bold: instance.isActive("bold"),
        italic: instance.isActive("italic"),
        strike: instance.isActive("strike"),
        code: instance.isActive("code"),
        link: instance.isActive("link"),
      };
    },
  });

  const view = editor && !editor.isDestroyed ? editor.view : null;
  const from = state?.from ?? 0;
  const to = state?.to ?? 0;
  // A new anchor for each selection, so the bar moves with it.
  const anchor = useMemo<{ current: Measurable } | null>(
    () =>
      view
        ? {
            current: {
              getBoundingClientRect: () => posToDOMRect(view, from, to),
              // The editor scrolls; the bar follows what's inside it.
              contextElement: view.dom.firstElementChild ?? view.dom,
            },
          }
        : null,
    [view, from, to],
  );

  if (!editor || !state) return null;
  const linking = linkDraft !== null;
  const open = linking || state.selecting;

  const closeLinkField = () => {
    onLinkDraftChange(null);
    editor.commands.focus();
  };
  const applyLink = () => {
    if (!editor.isEditable) return;
    const typed = (linkDraft ?? "").trim();
    const href = linkHref(typed);
    const chain = editor.chain().focus();
    if (!href) {
      chain.extendMarkRange("link").unsetLink().run();
    } else if (editor.state.selection.empty && !editor.isActive("link")) {
      chain
        .insertContent({
          type: "text",
          text: typed,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    } else {
      chain.extendMarkRange("link").setLink({ href }).run();
    }
    onLinkDraftChange(null);
  };

  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (!next && linking) onLinkDraftChange(null);
      }}
    >
      {anchor ? <PopoverAnchor virtualRef={anchor} /> : null}
      <PopoverContent
        data-review-popover=""
        data-review-format-toolbar=""
        role="toolbar"
        aria-label={labels.toolbar}
        side="top"
        align="center"
        sideOffset={6}
        hideWhenDetached
        className={cn(
          "flex w-auto items-center gap-0.5 rounded-[10px] border-border p-1",
          linking && "w-[296px] max-w-[calc(100vw-2rem)]",
        )}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // A press on a button must not take focus from the editor.
        onMouseDown={(event) => {
          if (!(event.target as HTMLElement).closest("input"))
            event.preventDefault();
        }}
        // React passes the click up to the composer's field, which would move
        // the caret to the end.
        onClick={(event) => event.stopPropagation()}
        onEscapeKeyDown={(event) => {
          // With the link field open, Escape closes just the field. Otherwise
          // it's the editor's, which may close the box.
          if (!linking || event.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          event.stopPropagation();
          closeLinkField();
        }}
      >
        {linking ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              applyLink();
            }}
          >
            <input
              autoFocus
              type="text"
              inputMode="url"
              aria-label={labels.linkField}
              placeholder={labels.linkPlaceholder}
              value={linkDraft}
              onChange={(event) => onLinkDraftChange(event.target.value)}
              className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {state.link ? (
              <ToolbarButton
                label={labels.removeLink}
                icon={IconUnlink}
                onPress={() => {
                  if (editor.isEditable) {
                    editor
                      .chain()
                      .focus()
                      .extendMarkRange("link")
                      .unsetLink()
                      .run();
                  }
                  onLinkDraftChange(null);
                }}
              />
            ) : null}
            <ToolbarButton
              label={labels.applyLink}
              icon={IconCheck}
              type="submit"
            />
          </form>
        ) : (
          <>
            {MARK_BUTTONS.map(({ mark, icon, keys }) => (
              <ToolbarButton
                key={mark}
                label={labels[mark]}
                icon={icon}
                keys={keys}
                pressed={state[mark]}
                onPress={() => editor.chain().focus().toggleMark(mark).run()}
              />
            ))}
            <ToolbarButton
              label={labels.link}
              icon={IconLink}
              keys="Control+K Meta+K"
              pressed={state.link}
              onPress={onOpenLink}
            />
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ToolbarButton({
  label,
  icon: Icon,
  keys,
  pressed,
  type = "button",
  onPress,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  keys?: string;
  pressed?: boolean;
  type?: "button" | "submit";
  onPress?: () => void;
}) {
  return (
    <Button
      type={type}
      size="icon"
      variant="ghost"
      aria-label={label}
      aria-keyshortcuts={keys}
      aria-pressed={pressed}
      data-active={pressed ? "" : undefined}
      className={cn(
        "size-7 rounded-md text-muted-foreground",
        pressed && "bg-accent text-accent-foreground",
      )}
      onClick={onPress}
    >
      <Icon className="size-4" />
    </Button>
  );
}

/**
 * The address a typed link goes to: as typed with a scheme, else a web
 * address, or an email address as a mail link.
 */
function linkHref(typed: string): string {
  if (!typed) return "";
  if (/^[a-z][a-z\d+.-]*:/i.test(typed)) return typed;
  if (/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(typed)) return `mailto:${typed}`;
  return `https://${typed}`;
}
