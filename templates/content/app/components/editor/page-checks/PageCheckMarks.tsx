import { useT } from "@agent-native/core/client/i18n";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  memo,
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
  key: string;
  first: PageCheckMark;
  marks: PageCheckMark[];
}

interface MarkLayout {
  tops: ReadonlyMap<string, number>;
  inset: number;
}

interface MarkPlace {
  from: number;
  to: number;
}

const markKey = (mark: PageCheckMark) => `${mark.check.id}:${mark.answer.key}`;

function sameLayout(a: MarkLayout, b: MarkLayout) {
  if (a.inset !== b.inset || a.tops.size !== b.tops.size) return false;
  for (const [key, top] of a.tops) {
    const other = b.tops.get(key);
    if (other === undefined || Math.abs(other - top) >= 0.5) return false;
  }
  return true;
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

export const PageCheckMarks = memo(function PageCheckMarks({
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
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [layout, setLayout] = useState<MarkLayout | null>(null);

  const places = useRef(new Map<string, MarkPlace>());
  const measure = useRef<() => void>(() => {});
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
    let frame = 0;
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return;
      places.current = new Map(
        [...places.current].map(([key, place]) => [
          key,
          {
            from: transaction.mapping.map(place.from),
            to: transaction.mapping.map(place.to, -1),
          },
        ]),
      );
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure.current();
        });
      }
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
      cancelAnimationFrame(frame);
    };
  }, [actions, editor]);

  const groups = useMemo<MarkGroup[]>(() => {
    const byFrom = new Map<number, MarkGroup>();
    for (const mark of live?.marks ?? []) {
      const group = byFrom.get(mark.from);
      if (group) group.marks.push(mark);
      else {
        byFrom.set(mark.from, {
          key: markKey(mark),
          first: mark,
          marks: [mark],
        });
      }
    }
    return [...byFrom].sort(([a], [b]) => a - b).map(([, group]) => group);
  }, [live]);

  measure.current = () => {
    const wrapper = wrapperRef.current;
    if (!wrapper || editor.isDestroyed || groups.length === 0) {
      setLayout(null);
      return;
    }
    const view = editor.view;
    const box = wrapper.getBoundingClientRect();
    const rtl = getComputedStyle(wrapper).direction === "rtl";
    const tops = new Map<string, number>();
    const size = view.state.doc.content.size;
    for (const group of groups) {
      const place = places.current.get(group.key);
      if (!place) continue;
      try {
        const coords = view.coordsAtPos(Math.min(place.from + 1, size));
        tops.set(group.key, (coords.top + coords.bottom) / 2 - box.top);
      } catch {
        // coercion-ok: a position the mapping left behind waits for the next read.
      }
    }
    const next = { tops, inset: markInset(wrapper, view.dom, rtl) };
    setLayout((current) =>
      current && sameLayout(current, next) ? current : next,
    );
  };

  useEffect(() => {
    const dom = editor.view.dom;
    const clip = clipOf(dom);
    const observer = new ResizeObserver(() => measure.current());
    for (let node: HTMLElement | null = dom; node; node = node.parentElement) {
      observer.observe(node);
      if (node === clip) break;
    }
    return () => observer.disconnect();
  }, [editor]);

  useLayoutEffect(() => {
    places.current = new Map(
      (live?.marks ?? []).map((mark) => [
        markKey(mark),
        { from: mark.from, to: mark.to },
      ]),
    );
    measure.current();
  }, [live]);

  const focusCheck = useCallback(
    (checkId: string) => {
      const group = groups.find((entry) =>
        entry.marks.some((mark) => mark.check.id === checkId),
      );
      if (!group) return false;
      const buttons =
        wrapperRef.current?.querySelectorAll<HTMLElement>(
          "[data-page-check-mark]",
        ) ?? [];
      for (const button of buttons) {
        if (button.dataset.pageCheckMark === group.key) {
          button.scrollIntoView({ block: "center" });
        }
      }
      setOpenKey(group.key);
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
          live,
        ),
      focusCheck,
    });
    return () => actions.registerBody(null);
  }, [actions, editor, focusCheck, live]);

  if (!actions || !layout || groups.length === 0) return null;

  const skipHere = (mark: PageCheckMark, textHash: string) => () => {
    setOpenKey(null);
    void actions.skip({
      checkId: mark.check.id,
      placeKey: mark.answer.key,
      textHash,
    });
  };

  return (
    <div className="page-check-marks" data-page-check-marks>
      {groups.map((group) => {
        const top = layout.tops.get(group.key);
        if (top === undefined) return null;
        const labels = group.marks.map((mark) =>
          t("pageChecks.markLabel", {
            answer: pageCheckAnswerText(t, mark.check.parts, mark.answer),
            check: mark.check.sentence,
            place: pageCheckScopeLabel(t, mark.check.scope),
          }),
        );
        return (
          <Popover
            key={group.key}
            open={openKey === group.key}
            onOpenChange={(open) => setOpenKey(open ? group.key : null)}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="page-check-mark"
                style={{ top, insetInlineStart: layout.inset }}
                aria-label={labels.join("; ")}
                data-page-check-mark={group.key}
              >
                <span
                  aria-hidden="true"
                  className="page-check-dot"
                  data-shape={pageCheckMarkShape(group.first.answer.answer)}
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
                  key={markKey(mark)}
                  mark={mark}
                  onComment={
                    onComment
                      ? () => {
                          setOpenKey(null);
                          if (
                            startCommentOnRange(
                              editor,
                              onComment,
                              places.current.get(markKey(mark)) ?? mark,
                            )
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
                          setOpenKey(null);
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
});

function PageCheckCard({
  mark,
  onComment,
  onSkip,
  onEdit,
}: {
  mark: PageCheckMark;
  onComment?: (() => void) | undefined;
  onSkip?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
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
