import { useT } from "@agent-native/core/client/i18n";
import {
  blockText,
  formTitleOf,
  isListItemBlock,
  isMediaBlock,
  type Block,
} from "@shared/form-model";
import { IconArrowRight, IconChevronDown } from "@tabler/icons-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { MentionLabelsProvider } from "@/components/mentions/mention-labels";
import { MentionMenu } from "@/components/mentions/MentionMenu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import { BlockRow, type DropSide } from "./BlockRow";
import {
  caretOffset,
  Editable,
  focusEditable,
  readEditableText,
} from "./Editable";
import {
  addOptionAfter,
  emptyText,
  indexAfterItem,
  insertAt,
  isMediaKind,
  itemIdOf,
  makeBlocks,
  moveItem,
  moveItemTo,
  optionsOf,
  pageNumberOf,
  patchBlock,
  patchQuestion,
  questionSettings,
  removeBlock,
  removeItem,
  removeOption,
  replaceBlock,
  setText,
  siblingsOf,
  toggleThankYou,
  toItems,
  type InsertKind,
  type Item,
} from "./editor-ops";
import { CalculatedFieldsEditor, HiddenFieldsEditor } from "./FieldBlocks";
import { InsertDialog, SlashMenu, useInsertNavigation } from "./InsertMenu";
import { LogicBlock } from "./LogicBlock";
import { MediaEditor } from "./MediaEditor";
import { QuestionSettings } from "./QuestionSettings";
import { QuestionField, QuestionTitle } from "./QuestionView";
import type { useEditorDocument } from "./use-editor-document";
import { StartScreen } from "./welcome/StartScreen";

type Doc = ReturnType<typeof useEditorDocument>;

const TEXT_STYLES: Partial<Record<Block["type"], string>> = {
  TEXT: "py-2 text-base leading-6",
  HEADING_1: "py-2 text-3xl font-bold leading-9",
  HEADING_2: "py-2 text-2xl font-bold leading-8",
  HEADING_3: "py-2 text-xl font-semibold leading-7",
};

const NEEDS_TRAILING_TEXT: InsertKind[] = [
  "PAGE_BREAK",
  "THANK_YOU_PAGE",
  "DIVIDER",
];

function PageDecor({
  last,
  submitLabel,
}: {
  last: boolean;
  submitLabel?: string | undefined;
}) {
  const t = useT();
  return (
    <div aria-hidden className="px-4 pt-2.5 min-[960px]:px-[100px]">
      <div className="forms-actions relative flex">
        <div>
          <div className="inline-block">
            <div className="forms-button inline-flex h-9 items-center gap-1.5 rounded-[var(--fs-button-radius)] bg-[var(--fs-button-bg)] px-[13.5px] text-[15px] font-semibold text-[var(--fs-button-text)]">
              {last
                ? submitLabel || t("forms.editor.submit")
                : t("forms.editor.next")}
              <IconArrowRight className="size-4" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A key pressed while typing belongs to the field, not to the selected block. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== "function") return false;
  if (element.isContentEditable) return true;
  return Boolean(
    element.closest(
      'input, textarea, select, [data-editable], [role="textbox"], [role="combobox"]',
    ),
  );
}

export function EditorSurface({
  doc,
  submitLabel,
}: {
  doc: Doc;
  /** The form's own label for the final button, when the author set one. */
  submitLabel?: string | undefined;
}) {
  const t = useT();
  const { blocks, update } = doc;
  const titleBlock = blocks[0];
  const items = toItems(blocks.slice(1));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [addAfter, setAddAfter] = useState<string | null | undefined>(
    undefined,
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; side: DropSide } | null>(
    null,
  );
  const pendingFocus = useRef<{ id: string; at: "start" | "end" } | null>(null);

  const slashBlock = blocks.find(
    (block) =>
      block.type === "TEXT" &&
      block.uuid === focusedId &&
      blockText(block).startsWith("/") &&
      dismissed !== `${block.uuid}:${blockText(block)}`,
  );
  const slashFilter = slashBlock ? blockText(slashBlock).slice(1) : "";
  const slash = useInsertNavigation(slashFilter);

  useEffect(() => {
    if (!formTitleOf(doc.latest.current)) focusEditable("form-title");
  }, [doc.latest]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    focusEditable(pending.id, pending.at);
  });

  const focusLater = useCallback((id: string, at: "start" | "end" = "end") => {
    pendingFocus.current = { id, at };
  }, []);

  function editableIds(): string[] {
    return [...document.querySelectorAll<HTMLElement>("[data-editable]")].map(
      (element) => element.dataset.editable ?? "",
    );
  }

  function focusNeighbour(from: string, delta: -1 | 1): boolean {
    const ids = editableIds();
    const next = ids[ids.indexOf(from) + delta];
    if (!next) return false;
    return focusEditable(next, delta === 1 ? "start" : "end");
  }

  /** Where to land after inserting `kind`'s blocks: the first thing to type in. */
  function focusTargetFor(added: Block[], kind: InsertKind): string | null {
    if (kind === "CONDITIONAL_LOGIC") return null;
    const typable = added.find(
      (block) =>
        block.type === "TITLE" ||
        block.type === "TEXT" ||
        block.type.startsWith("HEADING"),
    );
    return typable ? typable.uuid : null;
  }

  function insertKind(
    kind: InsertKind,
    anchor: string | null,
    replace: string | null,
  ) {
    update((current) => {
      const index = replace
        ? current.findIndex((block) => block.uuid === replace)
        : indexAfterItem(current, anchor);
      const added = makeBlocks(kind, current, index);
      if (NEEDS_TRAILING_TEXT.includes(kind)) added.push(emptyText());
      const target = focusTargetFor(added, kind);
      if (target) focusLater(target, "start");
      const next = replace
        ? replaceBlock(current, replace, added)
        : insertAt(current, index, added);
      const last = next[next.length - 1];
      return (kind === "CONDITIONAL_LOGIC" ||
        kind === "HIDDEN_FIELDS" ||
        kind === "CALCULATED_FIELDS" ||
        isMediaKind(kind)) &&
        last &&
        last === added[added.length - 1]
        ? [...next, emptyText()]
        : next;
    });
  }

  function pickSlash(kind: InsertKind) {
    if (slashBlock) insertKind(kind, null, slashBlock.uuid);
  }

  function select(id: string) {
    setSelectedId(id);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  function onTitleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault();
      const first = items[0];
      if (
        first?.kind === "block" &&
        first.block.type === "TEXT" &&
        !blockText(first.block)
      ) {
        focusEditable(first.block.uuid, "start");
        return;
      }
      if (event.key === "ArrowDown" && focusNeighbour("form-title", 1)) return;
      const added = emptyText();
      focusLater(added.uuid, "start");
      update((current) => insertAt(current, 1, [added]));
    }
  }

  function onEditableKey(event: KeyboardEvent<HTMLDivElement>, block: Block) {
    const text = readEditableText(event.currentTarget);
    if (slashBlock?.uuid === block.uuid) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(`${block.uuid}:${text}`);
        return;
      }
      if (slash.onKey(event, pickSlash)) return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.shiftKey) return;

    if (event.key === "Escape") {
      event.preventDefault();
      select(itemIdOf(blocks, block.uuid));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusNeighbour(block.uuid, -1);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (focusNeighbour(block.uuid, 1)) return;
      if (block.type === "TEXT" && text === "") return;
      const added = emptyText();
      focusLater(added.uuid, "start");
      update((current) => [...current, added]);
      return;
    }
    if (event.key === "Backspace" && text === "") {
      const removable =
        block.type === "TEXT" || block.type.startsWith("HEADING");
      const option = isListItemBlock(block);
      if (!removable && !(option && siblingsOf(blocks, block).length > 1))
        return;
      event.preventDefault();
      const ids = editableIds();
      const previous = ids[ids.indexOf(block.uuid) - 1];
      if (previous) focusLater(previous, "end");
      update((current) =>
        option
          ? removeOption(current, block.uuid)
          : removeBlock(current, block.uuid),
      );
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();

    if (block.type === "TITLE") {
      const options = optionsOf(blocks, block.groupUuid);
      const firstOption = options[0];
      if (firstOption) {
        focusEditable(firstOption.uuid, "start");
        return;
      }
      insertTextAfter(block.uuid);
      return;
    }
    if (isListItemBlock(block)) {
      const options = siblingsOf(blocks, block);
      const isLast = options[options.length - 1]?.uuid === block.uuid;
      if (text === "" && isLast && options.length > 1) {
        const added = emptyText();
        focusLater(added.uuid, "start");
        update((current) =>
          insertAt(
            removeOption(current, block.uuid),
            indexAfterItem(removeOption(current, block.uuid), block.groupUuid),
            [added],
          ),
        );
        return;
      }
      update((current) => {
        const result = addOptionAfter(current, block.uuid);
        focusLater(result.added, "start");
        return result.blocks;
      });
      return;
    }
    const offset = Math.min(caretOffset(event.currentTarget), text.length);
    const added = {
      ...emptyText(),
      payload: { text: text.slice(offset) },
    } as Block;
    focusLater(added.uuid, "start");
    update((current) =>
      insertAt(
        offset < text.length
          ? setText(current, block.uuid, text.slice(0, offset))
          : current,
        indexAfterItem(current, block.uuid),
        [added],
      ),
    );
  }

  function insertTextAfter(uuid: string) {
    const added = emptyText();
    focusLater(added.uuid, "start");
    update((current) =>
      insertAt(current, indexAfterItem(current, uuid), [added]),
    );
  }

  const onText = useCallback(
    (uuid: string, text: string) =>
      update((current) => setText(current, uuid, text)),
    [update],
  );

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented) return;
      const mod = event.metaKey || event.ctrlKey;
      const active = document.activeElement as HTMLElement | null;
      const focusedEditable = active?.dataset.editable;
      if (
        mod &&
        event.shiftKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        const target =
          selectedId ??
          (focusedEditable && focusedEditable !== "form-title"
            ? itemIdOf(doc.latest.current, focusedEditable)
            : null);
        if (!target) return;
        event.preventDefault();
        if (focusedEditable) focusLater(focusedEditable);
        update((current) =>
          moveItem(current, target, event.key === "ArrowUp" ? -1 : 1),
        );
        return;
      }
      if (!selectedId) return;
      if (event.key === "Escape") setSelectedId(null);
      else if (isTypingTarget(event.target)) {
        // The block stays selected while the author types elsewhere (the Customize
        // panel, the Add block search, a hidden field), so a key pressed in a field
        // must edit that field, never the selection (CEN-forms-2-001).
        return;
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        update((current) => removeItem(current, selectedId));
        setSelectedId(null);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const first = doc.latest.current.find(
          (block) => itemIdOf(doc.latest.current, block.uuid) === selectedId,
        );
        setSelectedId(null);
        if (first) focusEditable(first.uuid, "end");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, update, doc.latest, focusLater]);

  function rowFor(item: Item) {
    const id = item.id;
    const menu =
      item.kind === "question" ? (
        <QuestionMenu
          groupId={id}
          blocks={blocks}
          onPatch={(patch) =>
            update((current) => patchQuestion(current, id, patch))
          }
          onDelete={() => update((current) => removeItem(current, id))}
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => update((current) => removeItem(current, id))}
        >
          {t("forms.editor.delete")}
        </Button>
      );
    return (
      <BlockRow
        key={id}
        id={id}
        selected={selectedId === id}
        drop={dropAt?.id === id ? dropAt.side : null}
        menu={menu}
        title={
          item.kind === "question" ? (
            <QuestionTitle
              blocks={item.blocks}
              onText={onText}
              onKeyDown={onEditableKey}
            />
          ) : undefined
        }
        onAdd={() => setAddAfter(id)}
        onDelete={() => update((current) => removeItem(current, id))}
        onDragStart={setDragging}
        onDragOver={(over, side) =>
          dragging && dragging !== over && setDropAt({ id: over, side })
        }
        onDrop={() => {
          if (dragging && dropAt)
            update((current) =>
              moveItemTo(current, dragging, dropAt.id, dropAt.side),
            );
          setDragging(null);
          setDropAt(null);
        }}
      >
        {item.kind === "question" ? (
          <QuestionField
            blocks={item.blocks}
            onText={onText}
            onKeyDown={onEditableKey}
          />
        ) : (
          <SingleBlock
            block={item.block}
            blocks={blocks}
            onKeyDown={onEditableKey}
            onText={onText}
            slashOpen={slashBlock?.uuid === item.block.uuid}
            slash={slash}
            pickSlash={pickSlash}
            onPatch={(patch) =>
              update((current) => patchBlock(current, item.id, patch))
            }
            onToggleThankYou={() =>
              update((current) => toggleThankYou(current, item.id))
            }
          />
        )}
      </BlockRow>
    );
  }

  const rows: ReactNode[] = [];
  let inThankYou = false;
  items.forEach((item, index) => {
    const type = item.kind === "block" ? item.block.type : null;
    if (type === "PAGE_BREAK" || type === "THANK_YOU_PAGE") {
      if (!inThankYou)
        rows.push(
          <PageDecor
            key={`decor-${item.id}`}
            last={false}
            submitLabel={submitLabel}
          />,
        );
      inThankYou = type === "THANK_YOU_PAGE" || inThankYou;
    }
    rows.push(<Fragment key={item.id}>{rowFor(item)}</Fragment>);
    if (index === items.length - 1 && !inThankYou)
      rows.push(<PageDecor key="decor-last" last submitLabel={submitLabel} />);
  });

  if (!titleBlock) return null;
  return (
    <MentionLabelsProvider blocks={blocks}>
      <div
        className="mx-auto mt-[150px] mb-40 w-full max-w-[900px]"
        onMouseDown={(event) => {
          if (!(event.target as HTMLElement).closest("[data-item]"))
            setSelectedId(null);
        }}
        onFocus={(event) => {
          const id = (event.target as HTMLElement).dataset.editable;
          if (id) {
            setFocusedId(id);
            setSelectedId(null);
          }
        }}
        onBlur={(event) => {
          if ((event.target as HTMLElement).dataset.editable === focusedId)
            setFocusedId(null);
        }}
      >
        <div className="px-4 py-px min-[960px]:px-[100px]">
          <div className="flex flex-col pb-[40px]">
            <input
              data-editable="form-title"
              aria-label={t("forms.editor.formTitle")}
              placeholder={t("forms.editor.formTitle")}
              maxLength={10_000}
              value={blockText(titleBlock)}
              className="w-full bg-transparent text-[40px] leading-[48px] font-bold outline-none placeholder:text-muted-foreground/50"
              onChange={(event) => onText(titleBlock.uuid, event.target.value)}
              onKeyDown={onTitleKey}
            />
          </div>
        </div>
        {items.length === 0 ? (
          <StartScreen
            doc={doc}
            onScratch={() => insertTextAfter(titleBlock.uuid)}
          />
        ) : (
          <>{rows}</>
        )}
        <InsertDialog
          open={addAfter !== undefined}
          onOpenChange={(open) => !open && setAddAfter(undefined)}
          onPick={(kind) => {
            insertKind(kind, addAfter ?? null, null);
            setAddAfter(undefined);
          }}
        />
        <MentionMenu latest={doc.latest} />
        <span className="sr-only" aria-live="polite">
          {formTitleOf(blocks)}
        </span>
      </div>
    </MentionLabelsProvider>
  );
}

function SingleBlock({
  block,
  blocks,
  slashOpen,
  slash,
  pickSlash,
  onKeyDown,
  onText,
  onPatch,
  onToggleThankYou,
}: {
  block: Block;
  blocks: Block[];
  slashOpen: boolean;
  slash: ReturnType<typeof useInsertNavigation>;
  pickSlash: (kind: InsertKind) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, block: Block) => void;
  onText: (uuid: string, text: string) => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onToggleThankYou: () => void;
}) {
  const t = useT();
  if (block.type === "PAGE_BREAK" || block.type === "THANK_YOU_PAGE") {
    const thankYou = block.type === "THANK_YOU_PAGE";
    return (
      <div className="my-6 flex items-center gap-3 text-xs font-medium text-muted-foreground">
        <label className="flex shrink-0 items-center gap-2">
          {t("forms.blocks.thankYouPage")}
          <Switch
            size="sm"
            aria-label={t("forms.blocks.thankYouPage")}
            checked={thankYou}
            onCheckedChange={onToggleThankYou}
          />
        </label>
        <hr className="flex-1 border-border" />
        {thankYou
          ? t("forms.editor.endPage")
          : t("forms.blocks.pageN", {
              number: pageNumberOf(blocks, block.uuid),
            })}
        <hr className="flex-1 border-border" />
        <IconChevronDown className="size-4" />
      </div>
    );
  }
  if (block.type === "DIVIDER") return <hr className="my-4 border-border" />;
  if (isMediaBlock(block))
    return <MediaEditor block={block} onPatch={onPatch} />;
  if (block.type === "HIDDEN_FIELDS")
    return <HiddenFieldsEditor block={block} onPatch={onPatch} />;
  if (block.type === "CALCULATED_FIELDS")
    return <CalculatedFieldsEditor block={block} onPatch={onPatch} />;
  if (block.type === "CONDITIONAL_LOGIC")
    return (
      <div className="my-3">
        <LogicBlock block={block} blocks={blocks} onPatch={onPatch} />
      </div>
    );
  const editable = (
    <Editable
      id={block.uuid}
      label={
        block.type === "TEXT"
          ? t("forms.editor.text")
          : t("forms.editor.heading")
      }
      placeholder={
        block.type === "TEXT"
          ? t("forms.editor.slashHint")
          : t("forms.editor.heading")
      }
      value={blockText(block)}
      className={TEXT_STYLES[block.type]}
      onChange={(text) => onText(block.uuid, text)}
      onKeyDown={(event) => onKeyDown(event, block)}
    />
  );
  if (block.type !== "TEXT") return editable;
  return (
    <SlashMenu
      open={slashOpen}
      items={slash.items}
      active={slash.active}
      onActive={slash.setActive}
      onPick={pickSlash}
    >
      <div>{editable}</div>
    </SlashMenu>
  );
}

function QuestionMenu({
  groupId,
  blocks,
  onPatch,
  onDelete,
}: {
  groupId: string;
  blocks: Block[];
  onPatch: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const settings = questionSettings(blocks, groupId);
  return (
    <div className="flex flex-col gap-3">
      {settings ? (
        <QuestionSettings
          type={settings.type}
          payload={settings.payload}
          onPatch={onPatch}
        />
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="justify-start text-destructive"
        onClick={onDelete}
      >
        {t("forms.editor.delete")}
      </Button>
    </div>
  );
}
