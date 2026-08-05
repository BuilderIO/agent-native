import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { setClientAppState } from "@agent-native/core/client/application-state";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconMailFast,
  IconMessageCircle,
  IconRefresh,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { refreshAndSelectRun } from "@/lib/automation-runs";
import { TAB_ID } from "@/lib/tab-id";

type Run = {
  id: string;
  automationId: string;
  recipient: string;
  status: string;
  stage: string;
  errorMessage: string | null;
  subject: string;
  previewIntro: string;
  previewItems: string[];
  promptSnapshot: string;
  createdAt: string;
  completedAt: string | null;
  delivery: "preview_only";
};

function formatRunTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status: string, t: (key: string) => string) {
  if (status === "preview_ready") return t("automation.statusPreview");
  if (status === "failed") return t("automation.statusFailed");
  return status;
}

function statusIcon(status: string) {
  if (status === "preview_ready") return IconCheck;
  if (status === "failed") return IconAlertTriangle;
  return IconClock;
}

export default function AutomationsRoute() {
  const t = useT();
  const automationQuery = useActionQuery("get-email-automation", {});
  const runsQuery = useActionQuery("list-email-automation-runs", {});
  const updateAutomation = useActionMutation("update-email-automation");
  const runTest = useActionMutation("run-email-automation-test");
  const [name, setName] = useState("");
  const [recipient, setRecipient] = useState("");
  const [prompt, setPrompt] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const automation = automationQuery.data;
  const runs = (runsQuery.data ?? []) as Run[];
  const activeRun = useMemo(
    () => runs.find((run) => run.id === activeRunId) ?? runs[0] ?? null,
    [activeRunId, runs],
  );

  useEffect(() => {
    if (!automation || isEditing) return;
    setName(automation.name);
    setRecipient(automation.recipient);
    setPrompt(automation.prompt);
  }, [automation, isEditing]);

  useEffect(() => {
    void setClientAppState(
      "automation-console",
      {
        view: "automations",
        automationId: automation?.id ?? null,
        runId: activeRun?.id ?? null,
      },
      { requestSource: TAB_ID },
    );
  }, [activeRun?.id, automation?.id]);

  async function saveDraft() {
    try {
      await updateAutomation.mutateAsync({
        ...(automation?.id ? { id: automation.id } : {}),
        name,
        recipient,
        prompt,
      });
      setIsEditing(false);
      toast.success(t("automation.savedToast"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("automation.saveFailed"),
      );
    }
  }

  async function runNow() {
    try {
      const saved = await updateAutomation.mutateAsync({
        ...(automation?.id ? { id: automation.id } : {}),
        name,
        recipient,
        prompt,
      });
      const run = await runTest.mutateAsync({
        automationId: saved.id ?? undefined,
      });
      await refreshAndSelectRun(
        () => runsQuery.refetch(),
        run.id,
        setActiveRunId,
      );
      setIsEditing(false);
      toast.success(t("automation.previewToast"));
      sendToAgentChat({
        message:
          "Review the latest email automation test run and help me iterate on the digest.",
        context: `Automation id: ${saved.id ?? "unsaved"}\nRun id: ${run.id}\nRecipient: ${run.recipient}\nStatus: ${run.status}\nDelivery: preview only; no email was sent.`,
        submit: true,
        openSidebar: true,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("automation.runFailed"),
      );
    }
  }

  function reviewActiveRun() {
    if (!activeRun) return;
    sendToAgentChat({
      message:
        "Review the selected email automation test run and suggest the smallest useful improvement to the digest.",
      context: `Run id: ${activeRun.id}\nRecipient: ${activeRun.recipient}\nStatus: ${activeRun.status}\nSubject: ${activeRun.subject}\nDelivery: preview only; no email was sent.`,
      submit: true,
      openSidebar: true,
    });
  }

  const isBusy = updateAutomation.isPending || runTest.isPending;

  return (
    <main className="min-h-full bg-background px-5 py-8 sm:px-8 lg:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <IconMailFast size={15} />
              <span>Email automation</span>
            </div>
            <Badge variant="outline" className="rounded-full">
              {t("automation.previewMode")}
            </Badge>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Make the next email run obvious
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Edit the digest, preview it locally, then ask the agent to refine
            the result. No email is sent in preview mode.
          </p>
        </header>

        <section className="rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4 sm:px-7">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Automation setup
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
              What should this digest do?
            </h2>
          </div>
          <div className="space-y-5 px-5 py-6 sm:px-7 sm:py-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="automation-name">
                  {t("automation.nameLabel")}
                </Label>
                <Input
                  id="automation-name"
                  value={name}
                  onFocus={() => setIsEditing(true)}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="automation-recipient">
                  {t("automation.recipientLabel")}
                </Label>
                <Input
                  id="automation-recipient"
                  type="email"
                  value={recipient}
                  onFocus={() => setIsEditing(true)}
                  onChange={(event) => setRecipient(event.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/50 px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-foreground">
                  {t("automation.scheduleLabel")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {automation?.schedule ?? t("automation.loading")}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {t("automation.scheduleUnchanged")}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="automation-prompt">
                  {t("automation.promptLabel")}
                </Label>
                <span className="text-xs text-muted-foreground">
                  {t("automation.markdownHint")}
                </span>
              </div>
              <Textarea
                id="automation-prompt"
                value={prompt}
                onFocus={() => setIsEditing(true)}
                onChange={(event) => setPrompt(event.target.value)}
                className="min-h-36 resize-y leading-6"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => void saveDraft()}
                disabled={isBusy || !name || !recipient || !prompt}
              >
                {t("automation.saveButton")}
              </Button>
              <Button
                type="button"
                onClick={() => void runNow()}
                disabled={isBusy || !name || !recipient || !prompt}
              >
                {isBusy ? (
                  <IconRefresh className="size-4 animate-spin" />
                ) : null}
                {isBusy
                  ? t("automation.runningButton")
                  : t("automation.runButton")}
              </Button>
            </div>
          </div>
          <footer className="border-t border-border px-5 py-3 text-xs text-muted-foreground sm:px-7">
            Saving changes does not change the recurring schedule.
          </footer>
        </section>

        <div className="mt-5 space-y-5">
          <details className="group rounded-xl border border-border bg-card">
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-foreground marker:hidden sm:px-7">
              <span className="flex items-center justify-between gap-3">
                <span>Recent runs</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {runs.length} {runs.length === 1 ? "run" : "runs"}
                </span>
              </span>
            </summary>
            <div className="border-t border-border px-5 py-4 sm:px-7">
              <div className="mb-3 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-2"
                  onClick={() => void runsQuery.refetch()}
                >
                  <IconRefresh className="size-4" />
                  {t("automation.refreshLabel")}
                </Button>
              </div>
              {runs.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  Run the test once to create a durable preview.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {runs.map((run) => {
                    const StatusIcon = statusIcon(run.status);
                    const isSelected = run.id === activeRun?.id;
                    return (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => setActiveRunId(run.id)}
                        className={`flex w-full items-center gap-3 py-3 text-start transition-colors first:pt-0 last:pb-0 ${isSelected ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <StatusIcon className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {statusLabel(run.status, t)} · {run.recipient}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {formatRunTime(run.createdAt)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </details>

          {activeRun ? (
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-7">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Latest preview
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
                    {activeRun.subject}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatRunTime(activeRun.createdAt)} · {activeRun.recipient}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {t("automation.noEmailSent")}
                  </Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={reviewActiveRun}
                  >
                    <IconMessageCircle className="size-4" />
                    Ask agent
                  </Button>
                </div>
              </div>

              <article className="mx-5 my-5 overflow-hidden rounded-lg border border-border bg-background sm:mx-7">
                <div className="border-b border-border px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {t("automation.previewEyebrow")}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
                    {activeRun.subject}
                  </h3>
                </div>
                <div className="space-y-4 px-5 py-5">
                  <p className="text-sm leading-6 text-muted-foreground">
                    {activeRun.previewIntro}
                  </p>
                  <ul className="space-y-3">
                    {activeRun.previewItems.map((item) => (
                      <li
                        key={item}
                        className="flex gap-3 text-sm leading-6 text-foreground"
                      >
                        <IconCheck className="mt-1 size-4 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <Separator />
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      {t("automation.toLabel")} {activeRun.recipient}
                    </span>
                    <span>{t("automation.previewOnlyLabel")}</span>
                  </div>
                </div>
              </article>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
