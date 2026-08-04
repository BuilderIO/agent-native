import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { setClientAppState } from "@agent-native/core/client/application-state";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconCheck,
  IconClock,
  IconMailFast,
  IconRefresh,
  IconSend,
  IconSparkles,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
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
      setIsEditing(false);
      setActiveRunId(run.id);
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

  function openRun(run: Run) {
    setActiveRunId(run.id);
  }

  const isBusy = updateAutomation.isPending || runTest.isPending;

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_right,hsl(var(--accent)),transparent_36%)] px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <IconMailFast className="size-4 text-foreground" />
              {t("automation.eyebrow")}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("automation.title")}
            </h1>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              {t("automation.description")}
            </p>
          </div>
          <Badge
            variant="outline"
            className="w-fit gap-2 rounded-full px-3 py-1.5"
          >
            <span className="size-2 rounded-full bg-emerald-500" />
            {t("automation.previewMode")}
          </Badge>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
          <div className="space-y-6">
            <Card>
              <CardHeader className="gap-1">
                <CardTitle>{t("automation.configTitle")}</CardTitle>
                <CardDescription>
                  {t("automation.configDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
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
                <div className="rounded-lg border border-border bg-muted/35 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {t("automation.scheduleLabel")}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {automation?.schedule ?? t("automation.loading")}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {t("automation.scheduleUnchanged")}
                    </Badge>
                  </div>
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
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
                  <p className="max-w-md text-xs leading-5 text-muted-foreground">
                    {t("automation.saveNote")}
                  </p>
                  <div className="flex gap-2">
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
                      className="gap-2"
                    >
                      {isBusy ? (
                        <IconRefresh className="size-4 animate-spin" />
                      ) : (
                        <IconSparkles className="size-4" />
                      )}
                      {isBusy
                        ? t("automation.runningButton")
                        : t("automation.runButton")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>{t("automation.historyTitle")}</CardTitle>
                    <CardDescription>
                      {t("automation.historyDescription")}
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => void runsQuery.refetch()}
                    aria-label={t("automation.refreshLabel")}
                  >
                    <IconRefresh className="size-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {runs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                    <p className="text-sm font-medium">
                      {t("automation.emptyTitle")}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("automation.emptyDescription")}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {runs.map((run) => {
                      const StatusIcon = statusIcon(run.status);
                      const isSelected = run.id === activeRun?.id;
                      return (
                        <button
                          key={run.id}
                          type="button"
                          onClick={() => openRun(run)}
                          className={`flex w-full items-center gap-3 py-3 text-start transition-colors first:pt-0 last:pb-0 ${isSelected ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          <span
                            className={`flex size-8 shrink-0 items-center justify-center rounded-full ${run.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600"}`}
                          >
                            <StatusIcon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 text-sm font-medium">
                              {statusLabel(run.status, t)}
                              <span className="font-normal text-muted-foreground">
                                · {run.recipient}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {formatRunTime(run.createdAt)}
                            </span>
                          </span>
                          <IconArrowUpRight className="size-4 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-border bg-muted/25">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle>{t("automation.previewTitle")}</CardTitle>
                    <CardDescription>
                      {activeRun
                        ? formatRunTime(activeRun.createdAt)
                        : t("automation.previewEmpty")}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeRun ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => void runNow()}
                        disabled={isBusy}
                      >
                        <IconRefresh className="size-3.5" />
                        {t("automation.retryButton")}
                      </Button>
                    ) : null}
                    {activeRun ? (
                      <Badge variant="secondary">
                        {t("automation.noEmailSent")}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {activeRun ? (
                  <div className="bg-slate-50 p-5 dark:bg-slate-950/40 sm:p-8">
                    <article className="mx-auto max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          <span className="size-2 rounded-full bg-emerald-500" />
                          {t("automation.previewEyebrow")}
                        </div>
                        <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                          {activeRun.subject}
                        </h2>
                      </div>
                      <div className="space-y-5 px-6 py-6">
                        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                          {activeRun.previewIntro}
                        </p>
                        <ul className="space-y-3">
                          {activeRun.previewItems.map((item) => (
                            <li
                              key={item}
                              className="flex gap-3 text-sm leading-6 text-slate-700 dark:text-slate-200"
                            >
                              <IconCheck className="mt-1 size-4 shrink-0 text-emerald-600" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                        <Separator />
                        <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                          <span>
                            {t("automation.toLabel")} {activeRun.recipient}
                          </span>
                          <span>{t("automation.previewOnlyLabel")}</span>
                        </div>
                      </div>
                    </article>
                  </div>
                ) : (
                  <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
                    <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <IconSend className="size-5" />
                    </div>
                    <p className="mt-4 text-sm font-medium">
                      {t("automation.previewEmptyTitle")}
                    </p>
                    <p className="mt-1 max-w-xs text-sm leading-6 text-muted-foreground">
                      {t("automation.previewEmptyDescription")}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="rounded-xl border border-border bg-card/70 px-5 py-4 text-sm text-muted-foreground">
              <div className="flex gap-3">
                <IconArrowUpRight className="mt-0.5 size-4 shrink-0 text-foreground" />
                <p className="leading-6">{t("automation.agentNote")}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
