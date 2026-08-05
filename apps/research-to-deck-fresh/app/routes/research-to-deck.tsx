import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { setClientAppState } from "@agent-native/core/client/application-state";
import { useActionMutation } from "@agent-native/core/client/hooks";
import {
  IconArrowUpRight,
  IconFileText,
  IconRefresh,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { buildDeckBrief, type DeckBrief } from "@/lib/deck-brief";
import { TAB_ID } from "@/lib/tab-id";

const SAMPLE_NOTES = `Q2 expansion is tracking ahead of plan, with enterprise pipeline up 18% since the last review.
Activation is still the main friction: new teams reach their first value later than expected, especially in self-serve.
Customer interviews point to clearer onboarding and better project templates as the highest-leverage fixes.
The team needs approval to move two engineers to activation work for the next six weeks.
Next checkpoint: share the onboarding experiment readout with Sales and CS by Friday.`;

export function meta() {
  return [
    { title: "Research to deck brief" },
    {
      name: "description",
      content:
        "Shape research notes into a concise, reviewable meeting deck brief.",
    },
  ];
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The brief could not be built.";
}

export default function ResearchToDeckRoute() {
  const [sourceText, setSourceText] = useState(SAMPLE_NOTES);
  const [brief, setBrief] = useState<DeckBrief | null>(null);
  const buildBrief = useActionMutation<DeckBrief, { sourceText: string }>(
    "build-deck-brief" as never,
  );

  useEffect(() => {
    void setClientAppState(
      "selection",
      {
        kind: "research-to-deck",
        sourceNoteCount: sourceText.split(/[\n.!?]+/).filter(Boolean).length,
        hasBrief: Boolean(brief),
        briefSectionCount: brief?.sections.length ?? 0,
      },
      { requestSource: TAB_ID },
    );
  }, [brief, sourceText]);

  async function handleBuild() {
    try {
      const result = await buildBrief.mutateAsync({ sourceText });
      setBrief(result);
      toast.success("Local deck brief ready to review.");
    } catch (error) {
      setBrief(buildDeckBrief(sourceText));
      toast.warning(
        `Action unavailable; showing local fallback. ${errorMessage(error)}`,
      );
    }
  }

  function handleRefine() {
    if (!brief) return;
    sendToAgentChat({
      message:
        "Refine this local deck brief for a concise QBR or meeting. Keep the narrative grounded in the source notes, call out unsupported claims, and suggest only the smallest useful edits.",
      context: `Source notes:\n${sourceText.slice(0, 8000)}\n\nCurrent brief:\n${brief.sections.map((section) => `${section.label}: ${section.body}${section.points ? `\n${section.points.join("\n")}` : ""}`).join("\n")}`,
      submit: true,
      openSidebar: true,
    });
  }

  return (
    <main className="research-deck-page min-h-full px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-9 max-w-2xl">
          <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--research-ink-muted))]">
            <IconFileText size={15} />
            <span>Research to deck</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[hsl(var(--research-ink))] sm:text-4xl">
            Turn notes into a meeting-ready story.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[hsl(var(--research-ink-muted))]">
            Start with a local outline, then review the narrative before asking
            the agent to sharpen it.
          </p>
        </header>

        <div className="grid gap-7 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] lg:items-start">
          <section className="research-panel rounded-2xl border p-5 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--research-ink-muted))]">
                  01 / Source notes
                </p>
                <h2 className="mt-2 text-lg font-semibold text-[hsl(var(--research-ink))]">
                  What should the room understand?
                </h2>
              </div>
              <span className="rounded-full border border-[hsl(var(--research-line))] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--research-ink-muted))]">
                Local preview
              </span>
            </div>
            <label htmlFor="research-notes" className="sr-only">
              Research notes
            </label>
            <Textarea
              id="research-notes"
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="Paste interview notes, findings, or meeting context..."
              aria-describedby="source-hint"
            />
            <p
              id="source-hint"
              className="mt-3 text-xs leading-5 text-[hsl(var(--research-ink-muted))]"
            >
              Keep the raw notes here. The local pass only extracts a compact,
              reviewable structure.
            </p>
            <Button
              type="button"
              onClick={() => void handleBuild()}
              disabled={buildBrief.isPending || sourceText.trim().length === 0}
              className="mt-6 h-11 w-full rounded-lg bg-[hsl(var(--research-ink))] text-[hsl(var(--research-paper))] hover:bg-[hsl(var(--research-ink)/0.9)]"
            >
              {buildBrief.isPending
                ? "Building local brief..."
                : "Build deck brief"}
              <IconArrowUpRight size={16} />
            </Button>
          </section>

          <section
            className="research-panel rounded-2xl border p-5 sm:p-6"
            aria-live="polite"
          >
            <div className="mb-5 flex items-start justify-between gap-4 border-b border-[hsl(var(--research-line))] pb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--research-ink-muted))]">
                  02 / Review
                </p>
                <h2 className="mt-2 text-lg font-semibold text-[hsl(var(--research-ink))]">
                  {brief?.title ?? "Your brief will land here"}
                </h2>
              </div>
              {brief ? (
                <span className="text-xs text-[hsl(var(--research-ink-muted))]">
                  {brief.sourceNoteCount} notes shaped
                </span>
              ) : null}
            </div>
            {brief ? (
              <div>
                {brief.sections.map((section, index) => (
                  <article
                    key={section.label}
                    className="border-b border-[hsl(var(--research-line))] py-5 first:pt-0 last:border-b-0 last:pb-1"
                  >
                    <div className="flex gap-4">
                      <span className="pt-0.5 font-mono text-xs text-[hsl(var(--research-accent))]">
                        0{index + 1}
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-[hsl(var(--research-ink))]">
                          {section.label}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-[hsl(var(--research-ink-muted))]">
                          {section.body}
                        </p>
                        {section.points ? (
                          <ul className="mt-3 space-y-2 text-sm leading-5 text-[hsl(var(--research-ink))]">
                            {section.points.map((point) => (
                              <li
                                key={point}
                                className="before:mr-2 before:text-[hsl(var(--research-accent))] before:content-['•']"
                              >
                                {point}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center rounded-xl bg-[hsl(var(--research-wash))] px-8 text-center">
                <p className="max-w-xs text-sm leading-6 text-[hsl(var(--research-ink-muted))]">
                  Build a local brief to see the source and generated outline
                  stacked for review.
                </p>
              </div>
            )}
            {brief ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleRefine}
                className="mt-6 h-10 rounded-lg border-[hsl(var(--research-line))] text-[hsl(var(--research-ink))] hover:bg-[hsl(var(--research-wash))]"
              >
                <IconRefresh size={15} />
                Refine with agent
              </Button>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
