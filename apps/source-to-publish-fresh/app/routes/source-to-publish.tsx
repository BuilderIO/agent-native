import {
  AgentToggleButton,
  sendToAgentChat,
  useActionMutation,
} from "@agent-native/core/client";
import {
  buildDraft,
  RECIPE_LABELS,
  RECIPE_VALUES,
  type Recipe,
  type TransformSourceInput,
  type TransformSourceResult,
} from "@shared/transform";
import {
  IconArrowUpRight,
  IconBrandX,
  IconCheck,
  IconClipboard,
  IconFileText,
  IconMessageCircle,
  IconMoon,
  IconRefresh,
  IconSun,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const SAMPLE_TITLE = "Q2 launch retrospective";
const SAMPLE_SOURCE = `Q2 launch retrospective

We launched the new workspace in May after six weeks of customer interviews and product reviews. The biggest change was moving the first-run experience from a blank canvas to a guided starting point.

Activation improved because teams could see a useful result in their first session. The launch also surfaced a gap: our help content explains features, but not the decisions teams are trying to make.

For the next cycle, we are keeping the guided start, adding a decision brief template, and asking every launch owner to name the first proof point before work begins.`;

type SourceType = "transcript" | "document" | "article";

const sourceTypeLabels: Record<SourceType, string> = {
  transcript: "Transcript",
  document: "Document",
  article: "Article",
};

const recipeDetails: Record<
  Recipe,
  { description: string; eyebrow: string; source: string }
> = {
  blog: {
    description: "A readable narrative with a clear signal and takeaway.",
    eyebrow: "Long-form narrative",
    source: "transcript → blog",
  },
  "decision-brief": {
    description: "A compact brief for decisions, owners, and next steps.",
    eyebrow: "Decision support",
    source: "document → brief",
  },
  social: {
    description: "Three short posts that keep the useful detail intact.",
    eyebrow: "Social set",
    source: "transcript → social",
  },
  "x-thread": {
    description: "A concise thread with one idea per post.",
    eyebrow: "Thread",
    source: "article → X",
  },
};

function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

const MAX_AGENT_DRAFT_CONTEXT = 5200;

function buildDraftAgentContext(draft: TransformSourceResult) {
  const context = [
    "Source to Publish draft",
    `Format: ${draft.recipeLabel}`,
    `Source title: ${draft.sourceTitle}`,
    `Draft title: ${draft.title}`,
    `Draft body:\n${draft.body}`,
  ].join("\n\n");

  if (context.length <= MAX_AGENT_DRAFT_CONTEXT) return context;

  return `${context.slice(0, MAX_AGENT_DRAFT_CONTEXT - 34)}\n\n[Draft context truncated]`;
}

function renderDraftBody(body: string) {
  return body.split("\n").map((line, index) => {
    if (line.startsWith("# ")) {
      return <h1 key={`${line}-${index}`}>{line.slice(2)}</h1>;
    }
    if (line.startsWith("## ")) {
      return <h2 key={`${line}-${index}`}>{line.slice(3)}</h2>;
    }
    if (line.startsWith("- ")) {
      return <li key={`${line}-${index}`}>{line.slice(2)}</li>;
    }
    if (!line.trim()) return <div className="h-2" key={`space-${index}`} />;
    return <p key={`${line}-${index}`}>{line}</p>;
  });
}

function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Keep the server markup and the first client render on the same icon and
  // label. next-themes can only resolve the user's theme after hydration.
  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      className="text-[var(--muted-foreground)]"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      size="icon"
      title={`Switch to ${isDark ? "light" : "dark"} theme`}
      variant="ghost"
    >
      {isDark ? <IconSun size={17} /> : <IconMoon size={17} />}
    </Button>
  );
}

export function meta() {
  return [{ title: "Source to Publish" }];
}

export default function SourceToPublishRoute() {
  const [recipe, setRecipe] = useState<Recipe>("blog");
  const [sourceType, setSourceType] = useState<SourceType>("transcript");
  const [sourceTitle, setSourceTitle] = useState(SAMPLE_TITLE);
  const [sourceText, setSourceText] = useState(SAMPLE_SOURCE);
  const [draft, setDraft] = useState<TransformSourceResult | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [copied, setCopied] = useState(false);
  const transformSource = useActionMutation<
    TransformSourceResult,
    TransformSourceInput
  >("transform-source", {
    onSuccess: (result) => {
      setDraft(result);
      setUsedFallback(false);
    },
  });

  const currentRecipe = recipeDetails[recipe];
  const sourceWords = useMemo(() => wordCount(sourceText), [sourceText]);

  function loadSample() {
    setSourceTitle(SAMPLE_TITLE);
    setSourceText(SAMPLE_SOURCE);
    setSourceType("transcript");
    setDraft(null);
    setUsedFallback(false);
  }

  function createDraft() {
    const input = {
      recipe,
      sourceText,
      sourceTitle,
    } satisfies TransformSourceInput;
    if (sourceWords < 5) return;

    transformSource.mutate(input, {
      onError: () => {
        setDraft(buildDraft(input));
        setUsedFallback(true);
      },
    });
  }

  async function copyDraft() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.body);
    setCopied(true);
    toast.success("Draft copied to clipboard");
    window.setTimeout(() => setCopied(false), 1600);
  }

  function refineWithAgent() {
    if (!draft) return;

    sendToAgentChat({
      chatTarget: "local",
      context: buildDraftAgentContext(draft),
      message:
        "Refine this draft for clarity and publish-readiness. Preserve the source facts and the selected format.",
      openSidebar: true,
      submit: true,
      type: "content",
    });
    toast.success("Draft sent to AgentSidebar");
  }

  return (
    <main className="source-app-main">
      <header className="source-app-header">
        <div className="source-app-brand">
          <span className="source-app-mark" aria-hidden="true">
            <IconArrowUpRight size={16} stroke={1.8} />
          </span>
          <span className="source-app-name">Source to Publish</span>
        </div>
        <div className="source-app-header-meta">
          <span className="source-app-local-state">Local workspace</span>
          <AgentToggleButton />
          <ThemeButton />
        </div>
      </header>

      <div className="source-app-content">
        <section className="source-app-hero">
          <div className="source-app-eyebrow">
            Content operations / one source
          </div>
          <h1>From source to publish.</h1>
          <p>
            Turn a transcript, document, or article into a useful publishing
            draft - with the source close at hand and an agent ready to refine
            the edges.
          </p>
        </section>

        <section className="source-app-workspace" aria-label="Create a draft">
          <div>
            <div className="source-app-section-label">01 / Source</div>
            <div className="source-app-source-card">
              <div className="source-app-source-top">
                <div className="source-app-source-label">
                  <span className="source-app-source-icon" aria-hidden="true">
                    <IconFileText size={18} stroke={1.7} />
                  </span>
                  <div className="min-w-0">
                    <div className="source-app-source-title">
                      {sourceTitle || "Untitled source"}
                    </div>
                    <div className="source-app-source-subtitle">
                      {sourceTypeLabels[sourceType]} · paste supported · imports
                      coming soon
                    </div>
                  </div>
                </div>
                <Button onClick={loadSample} size="sm" variant="ghost">
                  <IconRefresh size={14} />
                  Use sample
                </Button>
              </div>

              <div
                className="source-app-source-types"
                role="tablist"
                aria-label="Source type"
              >
                {(Object.keys(sourceTypeLabels) as SourceType[]).map((type) => (
                  <button
                    aria-selected={sourceType === type}
                    className="source-app-source-type"
                    data-selected={sourceType === type}
                    key={type}
                    onClick={() => setSourceType(type)}
                    role="tab"
                    type="button"
                  >
                    {sourceTypeLabels[type]}
                  </button>
                ))}
              </div>

              <label className="sr-only" htmlFor="source-title">
                Source title
              </label>
              <input
                className="mb-3 h-9 w-full border-0 border-b border-[var(--border)] bg-transparent text-sm font-medium outline-none placeholder:text-[var(--muted-foreground)]/70 focus:border-[var(--primary)]"
                id="source-title"
                onChange={(event) => setSourceTitle(event.target.value)}
                placeholder="Source title"
                value={sourceTitle}
              />
              <label className="sr-only" htmlFor="source-text">
                Source text
              </label>
              <Textarea
                id="source-text"
                onChange={(event) => setSourceText(event.target.value)}
                placeholder="Paste a transcript, document, or article excerpt..."
                value={sourceText}
              />
              <div className="source-app-source-footer">
                <span>
                  {sourceWords.toLocaleString()} words ·{" "}
                  {sourceText.length.toLocaleString()} characters
                </span>
                <span>Nothing leaves this browser in local mode</span>
              </div>
            </div>
          </div>

          <div className="source-app-publish-panel">
            <div className="source-app-section-label">02 / Publish shape</div>
            <div
              className="source-app-recipe-list"
              role="listbox"
              aria-label="Choose an output"
            >
              {RECIPE_VALUES.map((value) => {
                const details = recipeDetails[value];
                return (
                  <button
                    aria-selected={recipe === value}
                    className="source-app-recipe"
                    data-selected={recipe === value}
                    key={value}
                    onClick={() => setRecipe(value)}
                    role="option"
                    type="button"
                  >
                    <div className="source-app-recipe-title">
                      <span className="inline-flex items-center gap-2">
                        {value === "x-thread" ? (
                          <IconBrandX size={15} stroke={1.8} />
                        ) : null}
                        {RECIPE_LABELS[value]}
                      </span>
                      <span>{details.source}</span>
                    </div>
                    <p className="source-app-recipe-description">
                      {details.description}
                    </p>
                  </button>
                );
              })}
            </div>
            <p className="source-app-recipe-note">
              {currentRecipe.eyebrow}. Start with the smallest useful draft; ask
              the AgentSidebar for a sharper pass after it is ready.
            </p>
            <Button
              className="w-full"
              disabled={sourceWords < 5 || transformSource.isPending}
              onClick={createDraft}
              size="lg"
            >
              {transformSource.isPending
                ? "Drafting..."
                : `Draft ${RECIPE_LABELS[recipe]}`}
              <IconArrowUpRight size={16} />
            </Button>
            {transformSource.error && !usedFallback ? (
              <p className="source-app-error">
                The action endpoint is unavailable, so the next run will use the
                local template fallback.
              </p>
            ) : null}
          </div>
        </section>

        {draft ? (
          <section className="source-app-draft-wrap" aria-live="polite">
            <div className="source-app-section-label">03 / Draft</div>
            <div className="source-app-draft-card">
              <div className="source-app-draft-header">
                <div>
                  <Badge>{draft.recipeLabel} · local draft</Badge>
                  <h2 className="source-app-draft-title">{draft.title}</h2>
                </div>
                <div className="source-app-draft-actions">
                  <Button
                    className="source-app-refine-button"
                    onClick={refineWithAgent}
                    size="sm"
                  >
                    <IconMessageCircle size={15} />
                    Refine with agent
                  </Button>
                  <Button
                    aria-label="Copy draft"
                    onClick={copyDraft}
                    size="icon"
                    title="Copy draft"
                    variant="ghost"
                  >
                    {copied ? (
                      <IconCheck size={16} />
                    ) : (
                      <IconClipboard size={16} />
                    )}
                  </Button>
                  <Button
                    onClick={() => setDraft(null)}
                    size="sm"
                    variant="outline"
                  >
                    Start over
                  </Button>
                </div>
              </div>
              <article className="source-app-draft-body">
                {renderDraftBody(draft.body)}
              </article>
              <div className="source-app-draft-meta">
                <span>From: {draft.sourceTitle}</span>
                <span>{draft.wordCount.toLocaleString()} source words</span>
                <span>
                  {usedFallback ? "Local fallback" : "Action complete"}
                </span>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
