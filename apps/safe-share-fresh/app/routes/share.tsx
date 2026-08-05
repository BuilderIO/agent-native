import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowUpRight,
  IconCheck,
  IconClock,
  IconDownload,
  IconFileUpload,
  IconScan,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  AnalyzeTranscriptInput,
  Audience,
  RedactionSuggestion,
  TranscriptAnalysis,
} from "@/lib/transcript-types";

const MAX_LOCAL_FILE_BYTES = 120_000;
const MAX_AGENT_TRANSCRIPT_CHARS = 32_000;
const MAX_AGENT_ANALYSIS_CHARS = 6_000;
const SAMPLE_TRANSCRIPT = `Project sync — June 18

We agreed to move the launch review to Thursday and keep the scope focused on the onboarding flow.

Contact: Sarah Chen will send the revised notes to sarah.chen@example.com. The internal staging link is https://staging.example.test/review.

Internal only: the team is still investigating a security incident before sharing details externally.`;

const audienceLabels: Record<Audience, string> = {
  public: "Public",
  external: "Customers or partners",
  internal: "Internal team",
};

function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function safeMarkdown(analysis: TranscriptAnalysis) {
  const rows = analysis.redactions.length
    ? analysis.redactions
        .map(
          (item) =>
            `- Line ${item.line}: ${item.category} → ${item.replacement}`,
        )
        .join("\n")
    : "- No pattern matches found.";

  return `# Safe transcript summary

Audience: ${audienceLabels[analysis.audience]}

${analysis.safeSummary}

## Suggested redactions

${rows}

> Local pattern pass only. Review the original before sharing.`;
}

function safeText(analysis: TranscriptAnalysis) {
  const redactions = analysis.redactions.length
    ? analysis.redactions
        .map(
          (item) => `Line ${item.line}: ${item.category} → ${item.replacement}`,
        )
        .join("\n")
    : "No pattern matches found.";
  return `SAFE TRANSCRIPT SUMMARY\nAudience: ${audienceLabels[analysis.audience]}\n\n${analysis.safeSummary}\n\nSUGGESTED REDACTIONS\n${redactions}\n\nLocal pattern pass only. Review the original before sharing.`;
}

function riskClass(risk: TranscriptAnalysis["risk"]) {
  if (risk === "high")
    return "border-destructive/50 bg-destructive/10 text-destructive";
  if (risk === "medium") return "border-primary/40 bg-primary/10 text-primary";
  return "border-border bg-muted/35 text-muted-foreground";
}

function RedactionRow({
  item,
  lineLabel,
}: {
  item: RedactionSuggestion;
  lineLabel: string;
}) {
  return (
    <li className="flex items-start gap-3 border-t border-border/70 py-3 first:border-t-0">
      <span
        className={
          item.severity === "high"
            ? "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive"
            : "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
        }
      >
        <IconShieldCheck className="size-3" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-foreground">
          {item.category}
          <span className="font-normal text-muted-foreground">{lineLabel}</span>
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {item.matchPreview} → {item.replacement}
        </span>
      </span>
    </li>
  );
}

export default function ShareRoute() {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [transcript, setTranscript] = useState("");
  const [audience, setAudience] = useState<Audience>("public");
  const [analysis, setAnalysis] = useState<TranscriptAnalysis | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [showImportOptions, setShowImportOptions] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const analyzeMutation = useActionMutation<
    TranscriptAnalysis,
    AnalyzeTranscriptInput
  >("analyze-transcript", {
    onSuccess: (result) => {
      setAnalysis(result);
      setNotice(null);
    },
    onError: (error) => {
      setNotice(error.message || t("share.analysisError"));
    },
  });

  useEffect(() => {
    document.documentElement.dataset.currentView = "share";
    document.documentElement.dataset.shareAudience = audience;
    document.documentElement.dataset.shareStatus = analysis
      ? "review"
      : "input";
  }, [analysis, audience]);

  function updateTranscript(value: string) {
    setTranscript(value);
    setAnalysis(null);
    setNotice(null);
    setFileName(null);
  }

  function analyze() {
    const trimmed = transcript.trim();
    if (!trimmed) {
      setNotice(t("share.addFirst"));
      return;
    }
    analyzeMutation.mutate({ audience, transcript: trimmed });
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_LOCAL_FILE_BYTES) {
      setNotice(t("share.fileTooLarge"));
      return;
    }
    try {
      updateTranscript(await file.text());
      setFileName(file.name);
    } catch {
      setNotice(t("share.fileReadError"));
    }
  }

  function askAgent(intent: "analyze" | "rewrite") {
    const boundedTranscript = transcript
      .trim()
      .slice(0, MAX_AGENT_TRANSCRIPT_CHARS);
    const currentAnalysis = analysis
      ? `\nCurrent local pass:\n${JSON.stringify(analysis, null, 2).slice(0, MAX_AGENT_ANALYSIS_CHARS)}`
      : "";
    sendToAgentChat({
      message:
        intent === "analyze"
          ? "Review this transcript for sensitive content before I share it. Explain what should be redacted and why, then suggest a safe summary for the selected audience."
          : "Rewrite the safe summary for the selected audience. Preserve the meaning, remove identifying details, and call out anything that still needs human review.",
      context: `Audience: ${audienceLabels[audience]}\nTranscript:\n${boundedTranscript || "(empty)"}${currentAnalysis}`,
      openSidebar: true,
      submit: true,
    });
  }

  const hasInput = transcript.trim().length > 0;
  const audienceLabel = (value: Audience) =>
    value === "public"
      ? t("share.public")
      : value === "external"
        ? t("share.external")
        : t("share.internal");
  const riskLabel =
    analysis?.risk === "high"
      ? t("share.reviewRequired")
      : analysis?.risk === "medium"
        ? t("share.mediumRisk")
        : t("share.lowRisk");

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("share.shareKicker")}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t("share.shareTitle")}
          </h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">
            {t("share.shareDescription")}
          </p>
        </div>

        <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <main className="min-w-0">
            <section aria-labelledby="transcript-heading">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    01
                  </p>
                  <h2
                    id="transcript-heading"
                    className="mt-1 text-lg font-semibold text-foreground"
                  >
                    {t("share.addTranscript")}
                  </h2>
                </div>
                {hasInput && (
                  <span className="text-xs text-muted-foreground">
                    {t("share.characters", {
                      count: Math.round(transcript.length / 1000),
                    })}
                  </span>
                )}
              </div>

              <div className="mt-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-5">
                <Textarea
                  value={transcript}
                  onChange={(event) => updateTranscript(event.target.value)}
                  placeholder={t("share.transcriptPlaceholder")}
                  aria-label={t("share.addTranscript")}
                  className="min-h-[18rem] resize-y border-0 bg-transparent px-0 py-0 text-sm leading-7 shadow-none focus-visible:ring-0"
                />
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,text/plain,text/markdown"
                      className="sr-only"
                      onChange={handleFileChange}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <IconFileUpload className="size-4" aria-hidden="true" />
                      {t("share.upload")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        updateTranscript(SAMPLE_TRANSCRIPT);
                        setFileName("sample-transcript.txt");
                      }}
                    >
                      {t("share.useSample")}
                    </Button>
                    {fileName && (
                      <span className="text-xs text-muted-foreground">
                        {fileName}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t("share.localOnly")}
                  </span>
                </div>
              </div>
            </section>

            <section className="mt-8" aria-labelledby="review-heading">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    02
                  </p>
                  <h2
                    id="review-heading"
                    className="mt-1 text-lg font-semibold text-foreground"
                  >
                    {t("share.review")}
                  </h2>
                </div>
                {analysis && (
                  <span className="text-xs text-muted-foreground">
                    {t("share.redactionCount", {
                      count: analysis.redactionCount,
                      suffix: analysis.redactionCount === 1 ? "" : "s",
                    })}
                  </span>
                )}
              </div>

              {!analysis ? (
                <div className="mt-4 rounded-xl border border-dashed border-border px-5 py-10 text-center sm:px-8">
                  <IconScan
                    className="mx-auto size-6 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <p className="mt-3 text-sm font-medium text-foreground">
                    {t("share.findSensitiveTitle")}
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                    {t("share.findSensitiveDescription")}
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-6">
                  <div
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${riskClass(analysis.risk)}`}
                  >
                    <div className="flex items-center gap-2">
                      {analysis.risk === "low" ? (
                        <IconCheck className="size-4" aria-hidden="true" />
                      ) : (
                        <IconShieldCheck
                          className="size-4"
                          aria-hidden="true"
                        />
                      )}
                      <span className="font-medium">{riskLabel}</span>
                    </div>
                    <span className="text-xs opacity-80">
                      {audienceLabel(analysis.audience)}
                    </span>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-border/90 bg-card">
                    <div className="bg-card p-5 sm:p-7">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-foreground">
                          {t("share.original")}
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {t("share.originalStatus")}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {t("share.originalDescription")}
                      </p>
                      <div className="mt-5 max-h-[26rem] overflow-auto whitespace-pre-wrap break-words font-sans text-[15px] leading-7 text-foreground/90">
                        {transcript}
                      </div>
                    </div>
                    <div className="border-t border-border bg-muted/25 p-5 sm:p-7">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-foreground">
                          {t("share.safeSummary")}
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {t("share.draft")}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {t("share.safeSummaryDescription")}
                      </p>
                      <div className="mt-5 max-h-[26rem] overflow-auto whitespace-pre-wrap break-words font-sans text-[15px] leading-7 text-foreground">
                        {analysis.safeSummary}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-sm font-semibold text-foreground">
                        {t("share.suggestedRedactions")}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {t("share.reviewEach")}
                      </span>
                    </div>
                    <ul className="mt-2 rounded-xl border border-border bg-card px-4">
                      {analysis.redactions.length ? (
                        analysis.redactions.map((item) => (
                          <RedactionRow
                            key={item.id}
                            item={item}
                            lineLabel={t("share.line", { line: item.line })}
                          />
                        ))
                      ) : (
                        <li className="py-4 text-sm text-muted-foreground">
                          {t("share.noMatches")}
                        </li>
                      )}
                    </ul>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-5">
                    <Button
                      type="button"
                      onClick={() =>
                        downloadFile(
                          "safe-summary.md",
                          safeMarkdown(analysis),
                          "text/markdown",
                        )
                      }
                    >
                      <IconDownload className="size-4" aria-hidden="true" />
                      {t("share.exportMarkdown")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        downloadFile(
                          "safe-summary.txt",
                          safeText(analysis),
                          "text/plain",
                        )
                      }
                    >
                      {t("share.exportText")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => askAgent("rewrite")}
                    >
                      {t("share.reviewWithAgent")}
                      <IconArrowUpRight className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </main>

          <aside className="min-w-0 lg:border-l lg:border-border/70 lg:pl-8">
            <div className="sticky top-6">
              <div className="border-b border-border pb-6">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("share.setup")}
                </p>
                <h2 className="mt-2 text-base font-semibold text-foreground">
                  {t("share.audienceQuestion")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t("share.audienceDescription")}
                </p>
                <Select
                  value={audience}
                  onValueChange={(value) => {
                    setAudience(value as Audience);
                    setAnalysis(null);
                  }}
                >
                  <SelectTrigger className="mt-4 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">{t("share.public")}</SelectItem>
                    <SelectItem value="external">
                      {t("share.external")}
                    </SelectItem>
                    <SelectItem value="internal">
                      {t("share.internal")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="border-b border-border py-6">
                <Button
                  type="button"
                  className="w-full"
                  disabled={!hasInput || analyzeMutation.isPending}
                  onClick={analyze}
                >
                  <IconScan className="size-4" aria-hidden="true" />
                  {analyzeMutation.isPending
                    ? t("share.checking")
                    : t("share.findSensitive")}
                </Button>
                <div className="mt-4 border-t border-border/70 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={!hasInput}
                    onClick={() => askAgent("analyze")}
                  >
                    {t("share.askAgent")}
                    <IconArrowUpRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                {notice && (
                  <p
                    className="mt-3 text-sm leading-5 text-destructive"
                    role="status"
                  >
                    {notice}
                  </p>
                )}
              </div>

              <details
                open={showImportOptions}
                onToggle={(event) =>
                  setShowImportOptions(event.currentTarget.open)
                }
                className="group py-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
                  <span>{t("share.moreWays")}</span>
                  <span className="text-xs text-muted-foreground transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                  <p>{t("share.comingSoon")}</p>
                  <div className="flex items-center gap-2 text-xs">
                    <IconClock className="size-4" aria-hidden="true" />
                    <span>{t("share.localPaste")}</span>
                  </div>
                </div>
              </details>

              <div className="border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
                {t("share.staysBrowser")}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
