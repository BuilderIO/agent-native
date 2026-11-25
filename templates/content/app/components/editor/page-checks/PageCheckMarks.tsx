import { useT } from "@agent-native/core/client/i18n";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { startCommentOnRange, type BubbleToolbarProps } from "../BubbleToolbar";
import { EDITOR_NON_EDIT_META } from "../editor-transaction-meta";
import {
  pageCheckMarkShape,
  pageCheckScopeAt,
  readLivePageChecks,
  type LivePageChecks,
  type PageCheckMark,
} from "./page-check-body";
import { pageCheckAnswerText, pageCheckScopeLabel } from "./page-check-format";
import {
  usePageChecksActions,
  usePageChecksState,
} from "./page-checks-context";

const LIVE_READ_DELAY_MS = 400;
const MARK_BESIDE_HANDLE_PX = 50;
const MARK_AFTER_TEXT_PX = 4;

interface MarkGroup {
  from: number;
  marks: PageCheckMark[];
}

interface MarkLayout {
  tops: ReadonlyMap<number, number>;
  inset: number;
}

function clipOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).overflowX !== "visible") return node;
  }
  return null;
}

function layoutLeft(element: HTMLElement): number {
  let left = 0;
  for (
    let node: Element | null = element;
    node instanceof HTMLElement;
    node = node.offsetParent
  ) {
    left += node.offsetLeft;
  }
  return left;
}

function markInset(wrapper: HTMLElement, text: HTMLElement, rtl: boolean) {
  const clip = clipOf(wrapper);
  const clipLeft = clip ? layoutLeft(clip) + clip.clientLeft : 0;
  const clipRight =
    clipLeft + (clip?.clientWidth ?? document.documentElement.clientWidth);
  const boxLeft = layoutLeft(wrapper);
  const textLeft = layoutLeft(text);
  const textRight = textLeft + text.offsetWidth;
  const start = rtl
    ? boxLeft + wrapper.offsetWidth - textRight
    : textLeft - boxLeft;
  const before = rtl ? clipRight - textRight : textLeft - clipLeft;
  if (before >= MARK_BESIDE_HANDLE_PX) return start - MARK_BESIDE_HANDLE_PX;
  const after = rtl ? textLeft - clipLeft : clipRight - textRight;
  const width = window.matchMedia("(pointer: coarse)").matches ? 32 : 22;
  return start + text.offsetWidth + Math.min(MARK_AFTER_TEXT_PX, after - width);
}

export function PageCheckMarks({
  editor,
  wrapperRef,
  onComment,
  suggesting,
}: {
  editor: Editor;
  wrapperRef: RefObject<HTMLDivElement | null>;
  onComment?: BubbleToolbarProps["onComment"];
  suggesting: boolean;
}) {
  const t = useT();
  const actions = usePageChecksActions();
  const state = usePageChecksState();
  const checks = state?.checks;
  const [live, setLive] = useState<LivePageChecks | null>(null);
  const [openFrom, setOpenFrom] = useState<number | null>(null);
  const [layout, setLayout] = useState<MarkLayout | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);

  const lastRead = useRef<LivePageChecks | null>(null);
  const read = useRef<() => void>(() => {});
  read.current = () => {
    if (editor.isDestroyed || !checks) return;
    const next = checks.length
      ? readLivePageChecks(editor.state.doc, checks)
      : null;
    lastRead.current = next;
    setLive(next);
    actions?.publishLive(next);
  };
  useEffect(() => read.current(), [checks, editor]);
  useEffect(() => {
    actions?.publishLive(lastRead.current);
    return () => actions?.publishLive(null);
  }, [actions]);

  const suggestingRef = useRef(suggesting);
  suggestingRef.current = suggesting;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return;
      setLive((current) =>
        current
          ? {
              ...current,
              marks: current.marks.map((mark) => ({
                ...mark,
                from: transaction.mapping.map(mark.from),
                to: transaction.mapping.map(mark.to, -1),
              })),
            }
          : current,
      );
      if (
        !suggestingRef.current &&
        !isChangeOrigin(transaction) &&
        !transaction.getMeta(EDITOR_NON_EDIT_META)
      ) {
        actions?.noteLocalEdit();
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => read.current(), LIVE_READ_DELAY_MS);
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
      if (timer) clearTimeout(timer);
    };
  }, [actions, editor]);

  const groups = useMemo<MarkGroup[]>(() => {
    const byFrom = new Map<number, PageCheckMark[]>();
    for (const mark of live?.marks ?? []) {
      byFrom.set(mark.from, [...(byFrom.get(mark.from) ?? []), mark]);
    }
    return [...byFrom]
      .sort(([a], [b]) => a - b)
      .map(([from, marks]) => ({ from, marks }));
  }, [live]);

  useEffect(() => {
    const dom = editor.view.dom;
    const clip = clipOf(dom);
    const observer = new ResizeObserver(() => setLayoutTick((n) => n + 1));
    for (let node: HTMLElement | null = dom; node; node = node.parentElement) {
      observer.observe(node);
      if (node === clip) break;
    }
    return () => observer.disconnect();
  }, [editor]);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || editor.isDestroyed || groups.length === 0) {
      setLayout(null);
      return;
    }
    const view = editor.view;
    const box = wrapper.getBoundingClientRect();
    const rtl = getComputedStyle(view.dom).direction === "rtl";
    const tops = new Map<number, number>();
    const size = view.state.doc.content.size;
    for (const group of groups) {
      try {
        const inside = Math.min(group.from + 1, size);
        const coords = view.coordsAtPos(inside);
        tops.set(group.from, (coords.top + coords.bottom) / 2 - box.top);
      } catch {
        // coercion-ok: a position the mapping left behind waits for the next read.
      }
    }
    setLayout({ tops, inset: markInset(wrapper, view.dom, rtl) });
  }, [editor, groups, layoutTick, wrapperRef]);

  const focusCheck = useCallback(
    (checkId: string) => {
      const group = groups.find((entry) =>
        entry.marks.some((mark) => mark.check.id === checkId),
      );
      if (!group) return false;
      const button = wrapperRef.current?.querySelector<HTMLElement>(
        `[data-page-check-from="${group.from}"]`,
      );
      button?.scrollIntoView({ block: "center" });
      setOpenFrom(group.from);
      return true;
    },
    [groups, wrapperRef],
  );
  useEffect(() => {
    if (!actions) return;
    actions.registerBody({
      scopeAt: (pos) =>
        pageCheckScopeAt(
          editor.state.doc,
          pos ?? editor.state.selection.from,
          live?.headings ?? [],
        ),
      focusCheck,
    });
    return () => actions.registerBody(null);
  }, [actions, editor, focusCheck, live]);

  if (!actions || !layout || groups.length === 0) return null;

  const skipHere = (mark: PageCheckMark, textHash: string) => () => {
    setOpenFrom(null);
    void actions.skip({
      checkId: mark.check.id,
      placeKey: mark.answer.key,
      textHash,
    });
  };

  return (
    <div className="page-check-marks" data-page-check-marks>
      {groups.map((group) => {
        const top = layout.tops.get(group.from);
        const first = group.marks.at(0);
        if (top === undefined || !first) return null;
        const labels = group.marks.map((mark) =>
          t("pageChecks.markLabel", {
            answer: pageCheckAnswerText(t, mark.check.parts, mark.answer),
            check: mark.check.sentence,
            place: pageCheckScopeLabel(t, mark.check.scope),
          }),
        );
        return (
          <Popover
            key={group.from}
            open={openFrom === group.from}
            onOpenChange={(open) => setOpenFrom(open ? group.from : null)}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="page-check-mark"
                style={{ top, insetInlineStart: layout.inset }}
                aria-label={labels.join("; ")}
                data-page-check-from={group.from}
              >
                <span
                  aria-hidden="true"
                  className="page-check-dot"
                  data-shape={pageCheckMarkShape(first.answer.answer)}
                />
                {group.marks.length > 1 ? (
                  <span aria-hidden="true" className="page-check-mark-count">
                    {group.marks.length}
                  </span>
                ) : null}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="bottom"
              className="w-80 max-w-[calc(100vw-2rem)] p-0"
            >
              {group.marks.map((mark) => (
                <PageCheckCard
                  key={`${mark.check.id}:${mark.answer.key}`}
                  mark={mark}
                  onComment={
                    onComment
                      ? () => {
                          setOpenFrom(null);
                          if (
                            startCommentOnRange(editor, onComment, {
                              from: mark.from,
                              to: mark.to,
                            })
                          ) {
                            actions.prefillComment(
                              t("pageChecks.commentText", {
                                check: mark.check.sentence,
                                answer: pageCheckAnswerText(
                                  t,
                                  mark.check.parts,
                                  mark.answer,
                                ),
                              }),
                            );
                          }
                        }
                      : undefined
                  }
                  onSkip={
                    actions.canEdit && mark.answer.place
                      ? skipHere(mark, mark.answer.place.textHash)
                      : undefined
                  }
                  onEdit={
                    actions.canEdit
                      ? () => {
                          setOpenFrom(null);
                          actions.openEdit(mark.check.id);
                        }
                      : undefined
                  }
                />
              ))}
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}

function PageCheckCard({
  mark,
  onComment,
  onSkip,
  onEdit,
}: {
  mark: PageCheckMark;
  onComment?: () => void;
  onSkip?: () => void;
  onEdit?: () => void;
}) {
  const t = useT();
  return (
    <div
      className="grid gap-0.5 border-b border-border p-3 last:border-b-0"
      data-page-check-card={mark.answer.answer}
    >
      <p className="text-sm font-semibold">
        {pageCheckAnswerText(t, mark.check.parts, mark.answer)}
      </p>
      <p className="text-xs text-muted-foreground">
        {mark.check.sentence}
        <span aria-hidden="true"> · </span>
        {pageCheckScopeLabel(t, mark.check.scope)}
      </p>
      {onComment || onSkip || onEdit ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {onComment ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onComment}
            >
              {t("pageChecks.comment")}
            </Button>
          ) : null}
          {onSkip ? (
            <Button type="button" size="sm" variant="outline" onClick={onSkip}>
              {t("pageChecks.skipHere")}
            </Button>
          ) : null}
          {onEdit ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ms-auto"
              onClick={onEdit}
            >
              {t("pageChecks.editCheck")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
