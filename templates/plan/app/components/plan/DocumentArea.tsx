import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  IconCheck,
  IconCode,
  IconEdit,
  IconPhoto,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { PlanBlock, PlanVisualQuestion } from "@shared/plan-content";
import {
  KitWireframeBlock,
  SketchDiagram,
  Wireframe,
} from "./wireframe/Wireframe";

/**
 * Renders the document flow: dispatches a single plan block to its block
 * component. `compactVisuals` tightens embedded wireframes/diagrams in dense
 * contexts (e.g. tab panes).
 */
export function PlanBlockView({
  block,
  onChange,
  onVisualQuestionsSubmit,
  compactVisuals,
}: {
  block: PlanBlock;
  onChange?: (block: PlanBlock) => void;
  onVisualQuestionsSubmit?: (summary: string) => void;
  compactVisuals?: boolean;
}) {
  if (block.type === "rich-text") {
    return <RichTextBlock block={block} onChange={onChange} />;
  }
  if (block.type === "callout") {
    return (
      <section className="plan-block plan-callout" data-block-id={block.id}>
        {block.title && <h2>{block.title}</h2>}
        <p>{block.data.body}</p>
      </section>
    );
  }
  if (block.type === "checklist") {
    return (
      <section className="plan-block" data-block-id={block.id}>
        {block.title && <h2>{block.title}</h2>}
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
        {block.title && <h2>{block.title}</h2>}
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
        {block.title && <h2>{block.title}</h2>}
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
        {block.title && <h2>{block.title}</h2>}
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
        {block.title && <h2>{block.title}</h2>}
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
        {block.title && <h2>{block.title}</h2>}
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
                  ? "shadow-[inset_3px_0_0_hsl(var(--ring))]"
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
        onVisualQuestionsSubmit={onVisualQuestionsSubmit}
      />
    );
  }
  if (block.type === "custom-html") {
    return <CustomHtmlBlock block={block} onChange={onChange} />;
  }
  if (block.type === "visual-questions") {
    return (
      <VisualQuestionsBlock
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
}: {
  block: Extract<PlanBlock, { type: "rich-text" }>;
  onChange?: (block: PlanBlock) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(block.data.markdown);
  return (
    <section className="plan-block group" data-block-id={block.id}>
      <div className="flex items-start justify-between gap-4">
        {block.title && <h2>{block.title}</h2>}
        {block.editable && onChange && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="opacity-70 transition-opacity group-hover:opacity-100"
            data-plan-interactive
            onClick={() => {
              setDraft(block.data.markdown);
              setEditing((value) => !value);
            }}
          >
            {editing ? (
              <IconX className="size-4" />
            ) : (
              <IconEdit className="size-4" />
            )}
            {editing ? "Cancel" : "Edit"}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-4 space-y-3" data-plan-interactive>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft((value) => `## ${value}`)}
            >
              Heading
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft((value) => appendLine(value, "- "))}
            >
              Bullet
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft((value) => appendLine(value, "> "))}
            >
              Quote
            </Button>
          </div>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-48 resize-y rounded-xl border-plan-line bg-plan-block font-mono text-sm"
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
                  data: { ...block.data, markdown: draft },
                });
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="plan-prose mt-4">
          <PlanMarkdown markdown={block.data.markdown} />
        </div>
      )}
    </section>
  );
}

/**
 * Safe rich-text renderer. react-markdown does NOT render raw HTML by default
 * (no rehype-raw), so agent-authored markdown can never inject HTML/scripts.
 * Links are sanitized through react-markdown's defaultUrlTransform and forced
 * to open in a new tab. Fenced code blocks get the shared dark Shiki theme.
 */
function PlanMarkdown({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={defaultUrlTransform}
      components={{
        a({ children, href }) {
          if (!href) return <span>{children}</span>;
          return (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
        pre({ children }) {
          const codeProps = getCodeElementProps(children);
          if (codeProps) {
            const langMatch = (codeProps.className ?? "").match(
              /\blanguage-([\w+-]+)\b/,
            );
            const code = extractCodeText(codeProps.children).replace(/\n$/, "");
            return <CodeBlock code={code} language={langMatch?.[1]} />;
          }
          return <pre>{children}</pre>;
        },
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

function getCodeElementProps(
  node: ReactNode,
): { className?: string; children?: ReactNode } | null {
  if (typeof node === "object" && node !== null && "props" in node) {
    return (
      node as unknown as {
        props: { className?: string; children?: ReactNode };
      }
    ).props;
  }
  return null;
}

function extractCodeText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractCodeText).join("");
  const props = getCodeElementProps(node);
  if (props) return extractCodeText(props.children);
  return "";
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
      {block.title && <h2>{block.title}</h2>}
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
                  ? "bg-plan-block text-plan-text shadow-[inset_3px_0_0_hsl(var(--ring))]"
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
  const [activePath, setActivePath] = useState(block.data.files[0]?.path ?? "");
  const active =
    block.data.files.find((file) => file.path === activePath) ??
    block.data.files[0];
  return (
    <section className="plan-block" data-block-id={block.id}>
      {block.title && <h2>{block.title}</h2>}
      <div className="grid overflow-hidden border-y border-plan-line lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="border-plan-line lg:border-r">
          {block.data.files.map((file) => (
            <button
              key={file.path}
              type="button"
              data-plan-interactive
              onClick={() => setActivePath(file.path)}
              className={cn(
                "grid w-full gap-1 border-b border-plan-line px-4 py-5 text-left",
                file.path === active?.path
                  ? "bg-plan-block text-plan-text shadow-[inset_3px_0_0_hsl(var(--ring))]"
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
              <h3 className="mt-3 text-3xl font-semibold tracking-tight">
                {active.title || active.path.split("/").pop()}
              </h3>
              <p className="mt-4 max-w-3xl text-xl leading-8 text-plan-muted">
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
  onVisualQuestionsSubmit,
}: {
  block: Extract<PlanBlock, { type: "tabs" }>;
  onChange?: (block: PlanBlock) => void;
  onVisualQuestionsSubmit?: (summary: string) => void;
}) {
  const [activeId, setActiveId] = useState(block.data.tabs[0]?.id ?? "");
  const active =
    block.data.tabs.find((tab) => tab.id === activeId) ?? block.data.tabs[0];
  const compactTabVisuals = /interaction|component|note/i.test(
    block.title ?? "",
  );
  return (
    <section className="plan-block" data-block-id={block.id}>
      {block.title && <h2>{block.title}</h2>}
      <div
        className="mb-8 inline-flex max-w-full gap-1 overflow-x-auto"
        role="tablist"
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
                "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                selected
                  ? "bg-plan-block text-plan-text shadow-sm"
                  : "text-plan-muted hover:bg-plan-block/60 hover:text-plan-text",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {active && (
        <div>
          {active.blocks.map((child) => (
            <PlanBlockView
              key={child.id}
              block={child}
              onVisualQuestionsSubmit={onVisualQuestionsSubmit}
              compactVisuals={compactTabVisuals}
              onChange={(nextChild) => {
                onChange?.({
                  ...block,
                  data: {
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
    </section>
  );
}

function CustomHtmlBlock({
  block,
  onChange,
}: {
  block: Extract<PlanBlock, { type: "custom-html" }>;
  onChange?: (block: PlanBlock) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [html, setHtml] = useState(block.data.html);
  const [css, setCss] = useState(block.data.css ?? "");
  const srcDoc = `<!doctype html><html><head><style>body{margin:0;min-height:100%;font-family:Inter,system-ui,sans-serif;color:#1f1f1d;background:transparent;}*{box-sizing:border-box}${block.data.css ?? ""}</style></head><body>${block.data.html}</body></html>`;
  return (
    <section className="plan-block group" data-block-id={block.id}>
      <div className="flex items-start justify-between gap-4">
        {block.title && <h2>{block.title}</h2>}
        {onChange && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-plan-interactive
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? (
              <IconX className="size-4" />
            ) : (
              <IconEdit className="size-4" />
            )}
            {editing ? "Cancel" : "Edit source"}
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

function isAnswered(question: PlanVisualQuestion, answer?: VisualAnswer) {
  if (question.mode === "freeform") return Boolean(answer?.text?.trim());
  return Boolean(answer?.selected?.length);
}

function VisualQuestionsBlock({
  block,
  onSubmit,
}: {
  block: Extract<PlanBlock, { type: "visual-questions" }>;
  onChange?: (block: PlanBlock) => void;
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

  return (
    <section className="plan-questions-block" data-block-id={block.id}>
      {block.title && <h2>{block.title}</h2>}
      <div className="mt-8 grid gap-14">
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
      <div className="sticky bottom-0 mt-14 flex items-center justify-between gap-4 border-t border-plan-line bg-plan-document py-4 backdrop-blur">
        <p className="text-sm font-semibold text-plan-muted">
          {answered}/{questions.length} answered
        </p>
        <div className="flex gap-2" data-plan-interactive>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(
                summarizeVisualQuestions(questions, answers),
              );
            }}
          >
            Copy prompt
          </Button>
          <Button
            type="button"
            onClick={() =>
              onSubmit?.(summarizeVisualQuestions(questions, answers))
            }
          >
            {block.data.submitLabel || "Send to agent"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function summarizeVisualQuestions(
  questions: PlanVisualQuestion[],
  answers: VisualAnswers,
) {
  const lines = [
    "Use these visual intake answers to create or update the visual plan:",
    "",
  ];
  for (const question of questions) {
    const answer = answers[question.id];
    const value =
      question.mode === "freeform"
        ? answer?.text?.trim()
        : question.options
            ?.filter((option) => answer?.selected?.includes(option.id))
            .map((option) => option.label)
            .join(", ");
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
  question: PlanVisualQuestion;
  index: number;
  answer?: VisualAnswer;
  onAnswer: (answer: VisualAnswer) => void;
}) {
  const selected = answer?.selected ?? [];
  return (
    <article className="grid gap-6 sm:grid-cols-[46px_minmax(0,1fr)]">
      <div className="flex size-8 items-center justify-center rounded-full border border-plan-line bg-plan-block text-sm font-semibold text-plan-muted">
        {index + 1}
      </div>
      <div>
        <h3 className="text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">
          {question.title}
        </h3>
        {question.subtitle && (
          <p className="mt-3 max-w-3xl text-lg leading-8 text-plan-muted">
            {question.subtitle}
          </p>
        )}
        {question.mode === "freeform" ? (
          <Textarea
            value={answer?.text ?? ""}
            onChange={(event) => onAnswer({ text: event.target.value })}
            className="mt-6 min-h-28 rounded-xl border-plan-line bg-plan-block text-base"
            data-plan-interactive
            placeholder="Add details..."
          />
        ) : (
          <div className="mt-6 grid gap-7">
            {question.options?.map((option) => {
              const isSelected = selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  data-plan-interactive
                  className="grid gap-5 border-b border-plan-line pb-7 text-left last:border-b-0"
                  onClick={() => {
                    if (question.mode === "single") {
                      onAnswer({ selected: [option.id] });
                      return;
                    }
                    onAnswer({
                      selected: isSelected
                        ? selected.filter((id) => id !== option.id)
                        : [...selected, option.id],
                    });
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-1 flex size-5 shrink-0 items-center justify-center border",
                        question.mode === "single" ? "rounded-full" : "rounded",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-plan-line",
                      )}
                    >
                      {isSelected && <IconCheck className="size-3.5" />}
                    </span>
                    <span>
                      <span className="text-xl font-semibold text-plan-text">
                        {option.label}
                      </span>
                      {option.recommended && (
                        <span className="ml-3 rounded-full border border-primary/30 px-2 py-0.5 text-xs font-bold uppercase tracking-[0.12em] text-primary">
                          Recommended
                        </span>
                      )}
                      {option.detail && (
                        <span className="mt-2 block max-w-2xl whitespace-pre-line text-base leading-7 text-plan-muted">
                          {option.detail}
                        </span>
                      )}
                    </span>
                  </div>
                  {(option.wireframe || option.diagram) && (
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
          </div>
        )}
      </div>
    </article>
  );
}

/* ── Shiki syntax highlighting (lazy-loaded, single dark theme) ─────────── */
type ShikiHighlighter = {
  codeToHtml: (
    code: string,
    options: { lang: string; theme: string },
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
        themes: [import("shiki/themes/github-dark-default.mjs")],
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
          theme: "github-dark-default",
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
      {block.title && <h2>{block.title}</h2>}
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
        tabs: block.data.tabs.map((tab) => ({
          ...tab,
          blocks: updateBlocks(tab.blocks, id, updater),
        })),
      },
    };
  });
}

function appendLine(value: string, prefix: string) {
  const suffix = value.endsWith("\n") || value.length === 0 ? "" : "\n";
  return `${value}${suffix}${prefix}`;
}
