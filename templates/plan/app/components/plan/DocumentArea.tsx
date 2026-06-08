import { useEffect, useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconClipboardText,
  IconCode,
  IconEdit,
  IconPhoto,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { RichMarkdownCollabUser } from "@agent-native/core/client";
import {
  BlockView,
  blockEditSurface,
  useOptionalBlockRegistry,
} from "@agent-native/core/blocks";
import { cn } from "@/lib/utils";
import type { PlanBlock, PlanQuestion } from "@shared/plan-content";
import {
  KitWireframeBlock,
  SketchDiagram,
  Wireframe,
} from "./wireframe/Wireframe";
import { PlanMarkdownEditor } from "./PlanMarkdownEditor";
import { PlanMarkdownReader } from "./PlanMarkdownReader";

/**
 * Renders the document flow: dispatches a single plan block to its block
 * component. `compactVisuals` tightens embedded wireframes/diagrams in dense
 * contexts (e.g. tab panes).
 */
export function PlanBlockView({
  block,
  onChange,
  onRichTextChange,
  onVisualQuestionsSubmit,
  compactVisuals,
  contentUpdatedAt,
  editingDisabled = false,
  planId,
  collabUser,
}: {
  block: PlanBlock;
  onChange?: (block: PlanBlock) => Promise<void> | void;
  onRichTextChange?: (
    blockId: string,
    markdown: string,
  ) => Promise<void> | void;
  onVisualQuestionsSubmit?: (summary: string) => void;
  compactVisuals?: boolean;
  contentUpdatedAt?: string | null;
  editingDisabled?: boolean;
  planId?: string | null;
  collabUser?: RichMarkdownCollabUser | null;
}) {
  // Registry-first dispatch. If the block type is registered, render through the
  // block registry (`BlockView` → spec `Read`, or in edit mode the spec `Edit`
  // or the schema-driven auto-editor). Unregistered types fall through to the
  // legacy branches below unchanged, so existing blocks keep working. The spec's
  // `Read` owns its own block container; the editor path is wrapped in a titled
  // `plan-block` section here so editing matches the document chrome.
  const blockRegistry = useOptionalBlockRegistry();
  const spec = blockRegistry?.registry.get(block.type);
  if (blockRegistry && spec) {
    const editable = block.editable !== false && !!onChange;
    const editing = editable && !editingDisabled;
    const view = (
      <BlockView
        spec={spec}
        block={{
          id: block.id,
          title: block.title,
          summary: block.summary,
          data: (block as { data: unknown }).data,
        }}
        editing={editing}
        editable={editable}
        onChange={(nextData) =>
          onChange?.({
            ...block,
            data: nextData,
          } as PlanBlock)
        }
        ctx={blockRegistry.ctx}
      />
    );
    // In INLINE / CONTAINER edit mode the auto-editor / custom Edit often renders
    // bare fields — wrap them in the standard titled block section. In read mode
    // (and in PANEL edit mode, where `BlockView` renders the spec's own `Read`
    // plus a corner edit button) the spec already provides its own section, so
    // render it directly to avoid double-nesting.
    const surface = blockEditSurface(spec);
    const wrapInline =
      editing && spec.placement.includes("block") && surface !== "panel";
    return wrapInline ? (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <div className="plan-block-label">{block.title}</div>}
        {view}
        {block.summary && (
          <p className="mt-5 text-plan-muted">{block.summary}</p>
        )}
      </section>
    ) : (
      view
    );
  }

  if (block.type === "rich-text") {
    return (
      <RichTextBlock
        block={block}
        onChange={onChange}
        onRichTextChange={onRichTextChange}
        contentUpdatedAt={contentUpdatedAt}
        editingDisabled={editingDisabled}
        planId={planId}
        collabUser={collabUser}
      />
    );
  }
  if (block.type === "callout") {
    return (
      <section className="plan-block plan-callout" data-block-id={block.id}>
        {block.title && <div className="plan-block-label">{block.title}</div>}
        <PlanMarkdownReader markdown={block.data.body} />
      </section>
    );
  }
  if (block.type === "checklist") {
    return (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <div className="plan-block-label">{block.title}</div>}
        <div className="grid gap-3">
          {block.data.items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-plan-interactive
              className="flex items-start gap-3 text-left text-plan-muted"
              onClick={() =>
                onChange?.({
                  ...block,
                  data: {
                    items: block.data.items.map((current) =>
                      current.id === item.id
                        ? { ...current, checked: !current.checked }
                        : current,
                    ),
                  },
                })
              }
            >
              <span
                className={cn(
                  "mt-1 flex size-5 items-center justify-center rounded border",
                  item.checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-plan-line",
                )}
              >
                {item.checked && <IconCheck className="size-3.5" />}
              </span>
              <span>
                <span className="block text-plan-text">{item.label}</span>
                {item.note && (
                  <span className="block text-sm">{item.note}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }
  if (block.type === "table") {
    return (
      <section className="plan-block overflow-x-auto" data-block-id={block.id}>
        {block.title && <div className="plan-block-label">{block.title}</div>}
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-plan-line text-sm text-plan-muted">
              {block.data.columns.map((column) => (
                <th key={column} className="py-3 pr-4 font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.data.rows.map((row, index) => (
              <tr key={index} className="border-b border-plan-line">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="py-4 pr-4 text-plan-muted">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }
  if (block.type === "code-tabs") {
    return <CodeTabsBlock block={block} />;
  }
  if (block.type === "implementation-map") {
    return <ImplementationMapBlock block={block} />;
  }
  if (block.type === "wireframe") {
    return (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <div className="plan-block-label">{block.title}</div>}
        <KitWireframeBlock block={block} compact={compactVisuals} />
        {block.summary && (
          <p className="mt-5 text-plan-muted">{block.summary}</p>
        )}
      </section>
    );
  }
  if (block.type === "legacy-wireframe") {
    return (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <div className="plan-block-label">{block.title}</div>}
        <Wireframe data={block.data} compact={compactVisuals} />
        {block.summary && (
          <p className="mt-5 text-plan-muted">{block.summary}</p>
        )}
      </section>
    );
  }
  if (block.type === "diagram") {
    return (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <div className="plan-block-label">{block.title}</div>}
        <SketchDiagram data={block.data} compact={compactVisuals} />
        {block.summary && (
          <p className="mt-5 text-plan-muted">{block.summary}</p>
        )}
      </section>
    );
  }
  if (block.type === "image") {
    return <ImageBlock block={block} />;
  }
  if (block.type === "decision") {
    return (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <div className="plan-block-label">{block.title}</div>}
        <p className="mt-3 max-w-3xl text-lg leading-8 text-plan-muted">
          {block.data.question}
        </p>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {block.data.options.map((option) => (
            <article
              key={option.id}
              className={cn(
                "rounded-xl border border-plan-line bg-plan-block p-4",
                option.recommended
                  ? "border-primary/30 bg-primary/5"
                  : "opacity-85",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-semibold tracking-tight text-plan-text">
                  {option.label}
                </h3>
                {option.recommended && (
                  <span className="rounded-full border border-plan-line px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-plan-muted">
                    Recommended
                  </span>
                )}
              </div>
              {option.detail && (
                <p className="mt-3 text-sm leading-6 text-plan-muted">
                  {option.detail}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
    );
  }
  if (block.type === "tabs") {
    return (
      <TabsBlock
        block={block}
        onChange={onChange}
        onRichTextChange={onRichTextChange}
        onVisualQuestionsSubmit={onVisualQuestionsSubmit}
        contentUpdatedAt={contentUpdatedAt}
        editingDisabled={editingDisabled}
        planId={planId}
        collabUser={collabUser}
      />
    );
  }
  if (block.type === "custom-html") {
    return <CustomHtmlBlock block={block} onChange={onChange} />;
  }
  if (block.type === "question-form") {
    return (
      <QuestionFormBlock
        block={block}
        onChange={onChange}
        onSubmit={onVisualQuestionsSubmit}
      />
    );
  }
  if (block.type === "visual-questions") {
    return (
      <QuestionFormBlock
        block={block}
        onChange={onChange}
        onSubmit={onVisualQuestionsSubmit}
      />
    );
  }
  return null;
}

function RichTextBlock({
  block,
  onChange,
  onRichTextChange,
  contentUpdatedAt,
  editingDisabled,
  planId,
  collabUser,
}: {
  block: Extract<PlanBlock, { type: "rich-text" }>;
  onChange?: (block: PlanBlock) => Promise<void> | void;
  onRichTextChange?: (
    blockId: string,
    markdown: string,
  ) => Promise<void> | void;
  contentUpdatedAt?: string | null;
  editingDisabled?: boolean;
  planId?: string | null;
  collabUser?: RichMarkdownCollabUser | null;
}) {
  const canUseInlineEditor = block.editable !== false && !!onChange;
  const editable = canUseInlineEditor && !editingDisabled;
  return (
    <section className="plan-block group" data-block-id={block.id}>
      {canUseInlineEditor && !editingDisabled ? (
        <PlanMarkdownEditor
          markdown={block.data.markdown}
          editable={editable}
          contentUpdatedAt={contentUpdatedAt}
          planId={planId}
          blockId={block.id}
          user={collabUser}
          onSave={(markdown) =>
            onRichTextChange
              ? onRichTextChange(block.id, markdown)
              : onChange?.({
                  ...block,
                  data: { ...block.data, markdown },
                })
          }
        />
      ) : (
        // Read-only path (public / shared-reviewer / review mode / SSR): render
        // markdown without mounting Tiptap so comment clicks hit stable text.
        <PlanMarkdownReader markdown={block.data.markdown} />
      )}
    </section>
  );
}

function CodeTabsBlock({
  block,
}: {
  block: Extract<PlanBlock, { type: "code-tabs" }>;
}) {
  const [activeId, setActiveId] = useState(block.data.tabs[0]?.id ?? "");
  const active =
    block.data.tabs.find((tab) => tab.id === activeId) ?? block.data.tabs[0];
  return (
    <section className="plan-block" data-block-id={block.id}>
      {block.title && <div className="plan-block-label">{block.title}</div>}
      <div className="grid overflow-hidden border-y border-plan-line md:grid-cols-[300px_minmax(0,1fr)]">
        <div className="border-plan-line md:border-r">
          {block.data.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-plan-interactive
              className={cn(
                "flex w-full items-start gap-3 border-b border-plan-line px-4 py-4 text-left",
                tab.id === active?.id
                  ? "bg-primary/10 text-plan-text dark:bg-primary/20"
                  : "text-plan-muted hover:bg-accent/30",
              )}
              onClick={() => setActiveId(tab.id)}
            >
              <IconCode className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate font-mono text-sm font-semibold">
                  {tab.label}
                </span>
                {tab.caption && (
                  <span className="mt-1 block text-xs leading-5">
                    {tab.caption}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="min-w-0 p-5">
          {active && (
            <>
              <h3 className="text-2xl font-semibold tracking-tight">
                {active.label}
              </h3>
              {active.caption && (
                <p className="mt-2 text-plan-muted">{active.caption}</p>
              )}
              <CodeBlock code={active.code} language={active.language} />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function CodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  return (
    <div className={cn("plan-code-surface", className ?? "mt-5")}>
      <HighlightedCode code={code} language={language} />
    </div>
  );
}

function ImplementationMapBlock({
  block,
}: {
  block: Extract<PlanBlock, { type: "implementation-map" }>;
}) {
  // Track the active file by INDEX, not by path. A single file legitimately
  // appears in multiple rows (e.g. one workflow file touched three different
  // ways), so keying selection AND the React list key on `file.path` made every
  // row sharing a path highlight together and select as one. Index is unique.
  const [activeIndex, setActiveIndex] = useState(0);
  const active = block.data.files[activeIndex] ?? block.data.files[0];
  return (
    <section className="plan-block" data-block-id={block.id}>
      {block.title && <div className="plan-block-label">{block.title}</div>}
      <div className="grid overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="border-plan-line lg:border-r">
          {block.data.files.map((file, index) => (
            <button
              key={index}
              type="button"
              data-plan-interactive
              onClick={() => setActiveIndex(index)}
              className={cn(
                "grid w-full gap-1 border-b border-plan-line px-4 py-5 text-left",
                index === activeIndex
                  ? "bg-primary/10 text-plan-text dark:bg-primary/20"
                  : "text-plan-muted hover:bg-accent/30",
              )}
            >
              <span className="truncate font-mono text-sm font-semibold">
                {file.title || file.path.split("/").pop()}
              </span>
              <span className="truncate font-mono text-xs">{file.path}</span>
            </button>
          ))}
        </div>
        <div className="min-w-0 p-6">
          {active && (
            <>
              <p className="font-mono text-sm text-plan-muted">{active.path}</p>
              <h3 className="mt-3 text-xl font-semibold tracking-tight">
                {active.title || active.path.split("/").pop()}
              </h3>
              <p className="mt-4 max-w-3xl plan-doc-body text-plan-muted">
                {active.note}
              </p>
              {active.snippet && (
                <CodeBlock
                  code={active.snippet}
                  language={active.language}
                  className="mt-6"
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function TabsBlock({
  block,
  onChange,
  onRichTextChange,
  onVisualQuestionsSubmit,
  contentUpdatedAt,
  editingDisabled,
  planId,
  collabUser,
}: {
  block: Extract<PlanBlock, { type: "tabs" }>;
  onChange?: (block: PlanBlock) => Promise<void> | void;
  onRichTextChange?: (
    blockId: string,
    markdown: string,
  ) => Promise<void> | void;
  onVisualQuestionsSubmit?: (summary: string) => void;
  contentUpdatedAt?: string | null;
  editingDisabled?: boolean;
  planId?: string | null;
  collabUser?: RichMarkdownCollabUser | null;
}) {
  const [activeId, setActiveId] = useState(block.data.tabs[0]?.id ?? "");
  const active =
    block.data.tabs.find((tab) => tab.id === activeId) ?? block.data.tabs[0];
  const compactTabVisuals = /interaction|component|note/i.test(
    block.title ?? "",
  );
  const orientation =
    block.data.orientation === "vertical" ? "vertical" : "horizontal";
  const vertical = orientation === "vertical";
  return (
    <section className="plan-block" data-block-id={block.id}>
      {block.title && <div className="plan-block-label">{block.title}</div>}
      <div
        className={cn(
          vertical &&
            "grid min-w-0 gap-5 md:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)] md:items-start",
        )}
      >
        <div
          className={cn(
            vertical
              ? "mb-5 flex w-full min-w-0 max-w-full flex-nowrap gap-1 overflow-x-auto md:mb-0 md:max-h-[62vh] md:flex-col md:overflow-x-hidden md:overflow-y-auto md:pr-2"
              : "mb-8 inline-flex max-w-full gap-1 overflow-x-auto",
          )}
          role="tablist"
          aria-orientation={orientation}
          data-plan-interactive
        >
          {block.data.tabs.map((tab) => {
            const selected = tab.id === active?.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveId(tab.id)}
                className={cn(
                  "rounded-lg border border-transparent text-sm font-semibold transition-colors",
                  vertical
                    ? "min-w-0 max-w-72 shrink-0 px-3 py-2 text-left md:w-full md:max-w-none"
                    : "shrink-0 whitespace-nowrap px-4 py-2",
                  selected
                    ? "bg-primary/5 text-foreground dark:bg-primary/10"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                <span className={cn(vertical && "block min-w-0 truncate")}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
        {active && (
          <div className={cn(vertical && "min-w-0")}>
            {active.blocks.map((child) => (
              <PlanBlockView
                key={child.id}
                block={child}
                onRichTextChange={onRichTextChange}
                onVisualQuestionsSubmit={onVisualQuestionsSubmit}
                compactVisuals={compactTabVisuals}
                contentUpdatedAt={contentUpdatedAt}
                editingDisabled={editingDisabled}
                planId={planId}
                collabUser={collabUser}
                onChange={(nextChild) => {
                  onChange?.({
                    ...block,
                    data: {
                      ...block.data,
                      tabs: block.data.tabs.map((tab) =>
                        tab.id === active.id
                          ? {
                              ...tab,
                              blocks: updateBlocks(
                                tab.blocks,
                                child.id,
                                () => nextChild,
                              ),
                            }
                          : tab,
                      ),
                    },
                  });
                }}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CustomHtmlBlock({
  block,
  onChange,
}: {
  block: Extract<PlanBlock, { type: "custom-html" }>;
  onChange?: (block: PlanBlock) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [html, setHtml] = useState(block.data.html);
  const [css, setCss] = useState(block.data.css ?? "");
  const srcDoc = `<!doctype html><html><head><style>body{margin:0;min-height:100%;font-family:Inter,system-ui,sans-serif;color:#1f1f1d;background:transparent;}*{box-sizing:border-box}${block.data.css ?? ""}</style></head><body>${block.data.html}</body></html>`;
  return (
    <section className="plan-block group" data-block-id={block.id}>
      <div className="flex items-start justify-between gap-4">
        {block.title ? (
          <div className="plan-block-label">{block.title}</div>
        ) : (
          <span />
        )}
        {onChange && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-plan-interactive
            aria-label={editing ? "Cancel editing source" : "Edit source"}
            className="size-8 text-plan-muted hover:bg-transparent hover:text-plan-text"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? (
              <IconX className="size-4" />
            ) : (
              <IconEdit className="size-4" />
            )}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-4 grid gap-3" data-plan-interactive>
          <Textarea
            value={html}
            onChange={(event) => setHtml(event.target.value)}
            className="min-h-48 font-mono text-sm"
            placeholder="HTML fragment"
          />
          <Textarea
            value={css}
            onChange={(event) => setCss(event.target.value)}
            className="min-h-32 font-mono text-sm"
            placeholder="Optional CSS"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                onChange?.({
                  ...block,
                  data: { ...block.data, html, css: css || undefined },
                });
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          <iframe
            title={block.title || "Custom HTML block"}
            srcDoc={srcDoc}
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            className="mt-4 h-[360px] w-full rounded-xl border border-plan-line bg-plan-block"
          />
          {block.data.caption && (
            <p className="mt-3 text-sm text-plan-muted">{block.data.caption}</p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Reviewer answers to visual intake questions are transient (they belong in
 * comments / events, never in the canonical plan body — see PlanVisualQuestion
 * canon). So answers live in LOCAL component state keyed by question id, not on
 * the block data. `freeform` → a string; `single`/`multi` → selected option ids.
 */
type VisualAnswer = { text?: string; selected?: string[] };
type VisualAnswers = Record<string, VisualAnswer>;

function isAnswered(question: PlanQuestion, answer?: VisualAnswer) {
  if (question.mode === "freeform") return Boolean(answer?.text?.trim());
  return Boolean(answer?.selected?.length || answer?.text?.trim());
}

export function QuestionFormBlock({
  block,
  onSubmit,
}: {
  block: Extract<PlanBlock, { type: "question-form" | "visual-questions" }>;
  onChange?: (block: PlanBlock) => Promise<void> | void;
  onSubmit?: (summary: string) => void;
}) {
  const questions = block.data.questions;
  const [answers, setAnswers] = useState<VisualAnswers>({});

  useEffect(() => {
    setAnswers({});
  }, [block.id]);

  const setAnswer = (questionId: string, next: VisualAnswer) => {
    setAnswers((current) => ({ ...current, [questionId]: next }));
  };

  const answered = questions.filter((question) =>
    isAnswered(question, answers[question.id]),
  ).length;
  const buildSummary = () =>
    summarizeQuestionForm(block.id, block.title, questions, answers);

  return (
    <section className="plan-questions-block" data-block-id={block.id}>
      {block.title && (
        <h2 className="text-[1.45rem] font-semibold leading-tight text-plan-text">
          {block.title}
        </h2>
      )}
      <div className="mt-7 grid gap-8">
        {questions.map((question, index) => (
          <VisualQuestionView
            key={question.id}
            question={question}
            index={index}
            answer={answers[question.id]}
            onAnswer={(next) => setAnswer(question.id, next)}
          />
        ))}
      </div>
      <div className="sticky bottom-0 mt-10 flex items-center justify-between gap-4 border-t border-plan-line bg-plan-document py-4 backdrop-blur">
        <p className="text-sm font-semibold text-plan-muted">
          {answered}/{questions.length} answered
        </p>
        <div data-plan-interactive>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" className="shrink-0 gap-1.5">
                Send to agent
                <IconChevronDown className="size-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-xl">
              <DropdownMenuLabel>Send feedback</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => onSubmit?.(buildSummary())}
                  className="items-start gap-2"
                  disabled={!onSubmit}
                >
                  <IconSend className="mt-0.5 size-4" />
                  <span className="grid gap-0.5">
                    <span>Send to inline agent</span>
                    <span className="text-xs font-normal leading-4 text-muted-foreground">
                      Posts answered questions into the app side agent.
                    </span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void navigator.clipboard.writeText(buildSummary());
                  }}
                  className="items-start gap-2"
                >
                  <IconClipboardText className="mt-0.5 size-4" />
                  <span className="grid gap-0.5">
                    <span>Copy for your agent</span>
                    <span className="text-xs font-normal leading-4 text-muted-foreground">
                      Copies a prompt you can paste into chat.
                    </span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </section>
  );
}

function summarizeQuestionForm(
  blockId: string | undefined,
  blockTitle: string | undefined,
  questions: PlanQuestion[],
  answers: VisualAnswers,
) {
  const lines = [
    "Use these plan question answers to revise the existing visual plan:",
    blockId ? `Question block: ${blockId}` : "",
    blockTitle ? `Section: ${blockTitle}` : "",
    "",
  ].filter((line) => line !== "");
  for (const question of questions) {
    const answer = answers[question.id];
    const selectedLabels =
      question.options
        ?.filter((option) => answer?.selected?.includes(option.id))
        .map((option) => option.label) ?? [];
    const other = answer?.text?.trim();
    const value =
      question.mode === "freeform"
        ? other
        : [...selectedLabels, ...(other ? [`Other: ${other}`] : [])].join(", ");
    lines.push(`- ${question.title}: ${value || "No answer yet"}`);
  }
  return lines.join("\n");
}

function VisualQuestionView({
  question,
  index,
  answer,
  onAnswer,
}: {
  question: PlanQuestion;
  index: number;
  answer?: VisualAnswer;
  onAnswer: (answer: VisualAnswer) => void;
}) {
  const selected = answer?.selected ?? [];
  const hasVisualOptions = Boolean(
    question.options?.some((option) => option.wireframe || option.diagram),
  );
  return (
    <article className="grid gap-4 sm:grid-cols-[36px_minmax(0,1fr)]">
      <div className="flex size-7 items-center justify-center rounded-full border border-plan-line bg-plan-block text-xs font-semibold text-plan-muted">
        {index + 1}
      </div>
      <div>
        <h3 className="text-lg font-semibold leading-7 text-plan-text">
          {question.title}
        </h3>
        {question.subtitle && (
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-plan-muted">
            {question.subtitle}
          </p>
        )}
        {question.mode === "freeform" ? (
          <Textarea
            value={answer?.text ?? ""}
            onChange={(event) => onAnswer({ text: event.target.value })}
            className="mt-4 min-h-28 rounded-xl border-plan-line bg-plan-block text-sm"
            data-plan-interactive
            placeholder={question.placeholder || "Add details..."}
          />
        ) : (
          <div
            className={cn(
              "mt-4",
              hasVisualOptions
                ? "grid gap-4 md:grid-cols-2"
                : "grid max-w-4xl gap-3",
            )}
          >
            {question.options?.map((option) => {
              const isSelected = selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  data-plan-interactive
                  aria-pressed={isSelected}
                  className={cn(
                    hasVisualOptions
                      ? "grid gap-4 rounded-xl border border-plan-line bg-plan-block p-4 text-left transition-colors hover:bg-accent/30"
                      : "grid w-full gap-2 rounded-xl border border-plan-line bg-plan-block px-4 py-3 text-left text-plan-text transition-colors hover:border-primary/40 hover:bg-accent/30",
                    isSelected && "border-primary/40 bg-primary/10",
                  )}
                  onClick={() => {
                    if (question.mode === "single") {
                      onAnswer({ ...answer, selected: [option.id] });
                      return;
                    }
                    onAnswer({
                      ...answer,
                      selected: isSelected
                        ? selected.filter((id) => id !== option.id)
                        : [...selected, option.id],
                    });
                  }}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center border",
                        question.mode === "single" ? "rounded-full" : "rounded",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-plan-line",
                      )}
                    >
                      {isSelected && <IconCheck className="size-3.5" />}
                    </span>
                    <span>
                      <span className="text-base font-semibold leading-6 text-plan-text">
                        {option.label}
                      </span>
                      {option.recommended && (
                        <>
                          {" "}
                          <span className="ml-3 rounded-md border border-primary/30 px-2 py-0.5 align-middle text-[11px] font-medium uppercase tracking-[0.12em] text-primary">
                            Recommended
                          </span>
                        </>
                      )}
                      {option.detail && (
                        <span className="mt-1 block max-w-2xl whitespace-pre-line text-sm font-normal leading-6 text-plan-muted">
                          {option.detail}
                        </span>
                      )}
                    </span>
                  </div>
                  {hasVisualOptions && (option.wireframe || option.diagram) && (
                    <div className="ml-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                      {option.wireframe && (
                        <Wireframe data={option.wireframe} compact />
                      )}
                      {option.diagram && (
                        <SketchDiagram data={option.diagram} compact />
                      )}
                    </div>
                  )}
                </button>
              );
            })}
            {/* Multiple-choice questions always offer a write-in answer so a
                reviewer can give a custom response instead of the listed
                options. Authors opt out only by setting allowOther: false. */}
            {question.allowOther !== false && (
              <Input
                value={answer?.text ?? ""}
                onChange={(event) =>
                  onAnswer({ ...answer, text: event.target.value })
                }
                className={cn(
                  "h-10 w-full rounded-lg border-plan-line bg-plan-block px-4",
                  hasVisualOptions ? "md:col-span-2" : "sm:w-80",
                )}
                data-plan-interactive
                placeholder={
                  question.placeholder || "Other — type your own answer…"
                }
              />
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/* ── Shiki syntax highlighting (lazy-loaded, light/dark themes) ─────────── */
type ShikiHighlighter = {
  codeToHtml: (
    code: string,
    options: {
      lang: string;
      themes: { light: string; dark: string };
      defaultColor?: false | "light" | "dark";
    },
  ) => string | Promise<string>;
  getLoadedLanguages: () => string[];
};

let highlighterLoader: Promise<ShikiHighlighter> | null = null;
function loadHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterLoader) {
    highlighterLoader = (async () => {
      const [{ createHighlighterCore }, { createOnigurumaEngine }] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/oniguruma"),
        ]);
      return createHighlighterCore({
        themes: [
          import("shiki/themes/github-light-default.mjs"),
          import("shiki/themes/github-dark-default.mjs"),
        ],
        langs: [
          import("shiki/langs/javascript.mjs"),
          import("shiki/langs/typescript.mjs"),
          import("shiki/langs/jsx.mjs"),
          import("shiki/langs/tsx.mjs"),
          import("shiki/langs/json.mjs"),
          import("shiki/langs/css.mjs"),
          import("shiki/langs/html.mjs"),
          import("shiki/langs/markdown.mjs"),
          import("shiki/langs/bash.mjs"),
          import("shiki/langs/shellscript.mjs"),
          import("shiki/langs/python.mjs"),
          import("shiki/langs/yaml.mjs"),
          import("shiki/langs/sql.mjs"),
        ],
        engine: createOnigurumaEngine(import("shiki/wasm")),
      }) as unknown as Promise<ShikiHighlighter>;
    })().catch((error) => {
      highlighterLoader = null;
      throw error;
    });
  }
  return highlighterLoader;
}

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  yml: "yaml",
  md: "markdown",
};

function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadHighlighter()
      .then((highlighter) => {
        const requested = (language || "text").toLowerCase();
        const resolved = LANG_ALIASES[requested] ?? requested;
        const loaded = highlighter.getLoadedLanguages();
        const lang = loaded.includes(resolved) ? resolved : "text";
        return highlighter.codeToHtml(code, {
          lang,
          themes: {
            light: "github-light-default",
            dark: "github-dark-default",
          },
          defaultColor: false,
        });
      })
      .then((out) => {
        if (!cancelled) setHtml(out as string);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (html) {
    // Shiki output is generated from plain text by the highlighter itself —
    // it is NOT agent-authored HTML, so this is safe (mirrors core chat).
    return (
      <div className="plan-shiki" dangerouslySetInnerHTML={{ __html: html }} />
    );
  }
  return (
    <pre>
      <code className={language ? `language-${language}` : undefined}>
        {code}
      </code>
    </pre>
  );
}

/* ── Image block ───────────────────────────────────────────────────────── */
function ImageBlock({
  block,
}: {
  block: Extract<PlanBlock, { type: "image" }>;
}) {
  const src = block.data.url ?? imageSrcForAsset(block.data.assetId);
  return (
    <section className="plan-block" data-block-id={block.id}>
      {block.title && <div className="plan-block-label">{block.title}</div>}
      {src ? (
        <img
          src={src}
          alt={block.data.alt}
          loading="lazy"
          className={cn(
            "mt-4 max-h-[640px] w-full rounded-xl border border-plan-line bg-plan-block",
            block.data.fit === "cover" ? "object-cover" : "object-contain",
          )}
        />
      ) : (
        <div className="mt-4 flex h-48 items-center justify-center rounded-xl border border-dashed border-plan-line bg-plan-block text-plan-muted">
          <IconPhoto className="mr-2 size-5" />
          {block.data.alt}
        </div>
      )}
      {block.data.caption && (
        <p className="mt-3 text-sm text-plan-muted">{block.data.caption}</p>
      )}
    </section>
  );
}

function imageSrcForAsset(_assetId?: string): string | undefined {
  // Asset-id resolution is wired during integration (no asset route exists in
  // this template yet). Until then, image blocks render via their `url`; an
  // asset-only block falls back to the labeled placeholder below.
  return undefined;
}

function updateBlocks(
  blocks: PlanBlock[],
  id: string,
  updater: (block: PlanBlock) => PlanBlock,
): PlanBlock[] {
  return blocks.map((block) => {
    if (block.id === id) return updater(block);
    if (block.type !== "tabs") return block;
    return {
      ...block,
      data: {
        ...block.data,
        tabs: block.data.tabs.map((tab) => ({
          ...tab,
          blocks: updateBlocks(tab.blocks, id, updater),
        })),
      },
    };
  });
}
