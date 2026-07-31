import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconExternalLink,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { TriageStatusPill } from "@/components/triage/triage-status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type TriageDecision = {
  decisionId: string;
  summary?: string | null;
  reason?: string | null;
  verdict?: string | null;
};

type TriageRule = {
  id: string;
  name: string;
  description: string;
  promptText: string;
  mode: string;
  enabled: boolean;
  promptVersion: number;
};

type TriageConfig = {
  slackWorkspace?: "primary" | "secondary";
  slackChannelId?: string | null;
  slackChannelName?: string | null;
  pollingEnabled?: boolean;
  repository?: string | null;
};

type TriageItem = {
  itemId?: string;
  id?: string;
  source?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  url?: string | null;
  risk?: string | null;
  status?: string | null;
  coverage?: string | number | null;
  reason?: string | null;
  decisionSummary?: string | null;
  decisions?: TriageDecision[] | null;
};

type TriageListResponse = TriageItem[] | { items?: TriageItem[] };
type Verdict = "correct" | "incorrect" | "uncertain";

function listItems(data: TriageListResponse | undefined) {
  return Array.isArray(data) ? data : (data?.items ?? []);
}

function itemId(item: TriageItem) {
  return item.itemId ?? item.id ?? "";
}

function displayValue(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "-" : value;
}

export function meta() {
  return [{ title: "Factory" }];
}

export default function TriageRoute() {
  const t = useT();
  const [status, setStatus] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [selectedVerdict, setSelectedVerdict] = useState<Verdict | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [rulePrompt, setRulePrompt] = useState("");
  const [slackWorkspace, setSlackWorkspace] = useState<"primary" | "secondary">(
    "primary",
  );
  const [slackChannelId, setSlackChannelId] = useState("");
  const [slackChannelName, setSlackChannelName] = useState("");
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [repository, setRepository] = useState("");

  const listQuery = useActionQuery<TriageListResponse>("list-triage-items", {
    limit: 50,
    ...(status.trim() ? { status: status.trim() } : {}),
  });
  const detailQuery = useActionQuery<TriageItem>(
    "get-triage-item",
    selectedItemId ? { itemId: selectedItemId } : undefined,
    { enabled: Boolean(selectedItemId) },
  );
  const feedbackMutation = useActionMutation("record-triage-feedback");
  const approveMutation = useActionMutation("approve-factory-item");
  const rulesQuery = useActionQuery<TriageRule[]>("list-triage-rules", {});
  const saveRuleMutation = useActionMutation("save-triage-rule");
  const configQuery = useActionQuery<TriageConfig>("get-triage-config", {});
  const saveConfigMutation = useActionMutation("save-triage-config");
  const items = listItems(listQuery.data);
  const selectedItem = detailQuery.data;
  const rules = rulesQuery.data ?? [];

  useEffect(() => {
    if (!configQuery.data) return;
    setSlackWorkspace(configQuery.data.slackWorkspace ?? "primary");
    setSlackChannelId(configQuery.data.slackChannelId ?? "");
    setSlackChannelName(configQuery.data.slackChannelName ?? "");
    setPollingEnabled(configQuery.data.pollingEnabled ?? false);
    setRepository(configQuery.data.repository ?? "");
  }, [configQuery.data]);

  function recordFeedback(decisionId: string) {
    if (!selectedVerdict) return;
    feedbackMutation.mutate({
      decisionId,
      verdict: selectedVerdict,
      ...(feedbackNote.trim() ? { note: feedbackNote.trim() } : {}),
    });
  }

  function editRule(rule: TriageRule) {
    setEditingRuleId(rule.id);
    setRuleName(rule.name);
    setRulePrompt(rule.promptText);
  }

  function startNewRule() {
    setEditingRuleId(null);
    setRuleName("");
    setRulePrompt("");
  }

  async function saveRule() {
    const name = ruleName.trim();
    const promptText = rulePrompt.trim();
    if (!name || !promptText) return;
    await saveRuleMutation.mutateAsync({
      ...(editingRuleId ? { id: editingRuleId } : {}),
      name,
      description: "",
      promptText,
      mode: "shadow",
      enabled: true,
    });
    await rulesQuery.refetch();
  }

  async function saveConfig() {
    await saveConfigMutation.mutateAsync({
      slackWorkspace,
      ...(slackChannelId.trim()
        ? { slackChannelId: slackChannelId.trim() }
        : {}),
      ...(slackChannelName.trim()
        ? { slackChannelName: slackChannelName.trim() }
        : {}),
      pollingEnabled,
      ...(repository.trim() ? { repository: repository.trim() } : {}),
    });
    await configQuery.refetch();
  }

  async function approveSelectedItem() {
    if (!selectedItemId || !selectedItem?.decisions?.length) return;
    await approveMutation.mutateAsync({
      itemId: selectedItemId,
      decisionId:
        selectedItem.decisions[selectedItem.decisions.length - 1]?.decisionId,
      confirm: true,
    });
    await Promise.all([detailQuery.refetch(), listQuery.refetch()]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          {t("triage.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("triage.description")}
        </p>
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <Card className="min-w-0">
          <CardHeader className="gap-3 border-b sm:flex-row sm:items-end sm:justify-between">
            <CardTitle className="text-base">
              {t("triage.queueTitle")}
            </CardTitle>
            <div className="flex items-end gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="triage-status">
                  {t("triage.statusFilter")}
                </Label>
                <Input
                  id="triage-status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  placeholder={t("triage.statusPlaceholder")}
                  className="h-8 w-36"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void listQuery.refetch()}
                disabled={listQuery.isFetching}
              >
                {listQuery.isFetching && (
                  <IconLoader2 className="animate-spin" />
                )}
                {t("triage.refresh")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {listQuery.isError ? (
              <ErrorState
                message={t("triage.queueError")}
                retryLabel={t("triage.retry")}
                onRetry={() => void listQuery.refetch()}
              />
            ) : listQuery.isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">
                {t("triage.loading")}
              </p>
            ) : items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {t("triage.empty")}
              </p>
            ) : (
              <div className="divide-y">
                {items.map((item) => {
                  const id = itemId(item);
                  const isSelected = id === selectedItemId;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      key={id}
                      onClick={() => {
                        setSelectedItemId(id);
                        setSelectedVerdict(null);
                        setFeedbackNote("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedItemId(id);
                          setSelectedVerdict(null);
                          setFeedbackNote("");
                        }
                      }}
                      className={`grid w-full gap-3 p-4 text-left transition-colors hover:bg-muted/50 sm:grid-cols-[1.2fr_.7fr_.8fr_.8fr_1.8fr] ${isSelected ? "bg-muted/60" : ""}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {displayValue(item.sourceName ?? item.source)}
                        </div>
                        {item.sourceUrl && (
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex max-w-full items-center gap-1 truncate text-xs text-primary hover:underline"
                          >
                            {item.sourceUrl}
                            <IconExternalLink className="size-3 shrink-0" />
                          </a>
                        )}
                      </div>
                      <FieldValue
                        label={t("triage.risk")}
                        value={item.risk}
                        pill
                      />
                      <FieldValue
                        label={t("triage.status")}
                        value={item.status}
                        pill
                      />
                      <FieldValue
                        label={t("triage.coverage")}
                        value={item.coverage}
                      />
                      <FieldValue
                        label={t("triage.reason")}
                        value={item.reason ?? item.decisionSummary}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-base">
              {t("triage.detailTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedItemId ? (
              <p className="text-sm text-muted-foreground">
                {t("triage.selectItem")}
              </p>
            ) : detailQuery.isError ? (
              <ErrorState
                message={t("triage.detailError")}
                retryLabel={t("triage.retry")}
                onRetry={() => void detailQuery.refetch()}
              />
            ) : detailQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">
                {t("triage.loading")}
              </p>
            ) : selectedItem ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {displayValue(
                        selectedItem.sourceName ?? selectedItem.source,
                      )}
                    </p>
                    {(selectedItem.sourceUrl ?? selectedItem.url) ? (
                      <a
                        href={
                          selectedItem.sourceUrl ??
                          selectedItem.url ??
                          undefined
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {t("triage.openSource")}
                        <IconExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </div>
                  <TriageStatusPill status={selectedItem.status} />
                </div>
                <Button
                  size="sm"
                  onClick={() => void approveSelectedItem()}
                  disabled={
                    !selectedItem.decisions?.length || approveMutation.isPending
                  }
                >
                  {approveMutation.isPending && (
                    <IconLoader2 className="animate-spin" />
                  )}
                  Approve and start
                </Button>
                {approveMutation.isError && (
                  <p className="text-sm text-destructive">
                    {approveMutation.error instanceof Error
                      ? approveMutation.error.message
                      : t("triage.approvalError")}
                  </p>
                )}
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <FieldValue
                    label={t("triage.risk")}
                    value={selectedItem.risk}
                    pill
                  />
                  <FieldValue
                    label={t("triage.coverage")}
                    value={selectedItem.coverage}
                  />
                  <FieldValue
                    label={t("triage.reason")}
                    value={selectedItem.reason}
                  />
                </div>
                {selectedItem.decisionSummary && (
                  <p className="rounded-md bg-muted px-3 py-2 text-sm">
                    {selectedItem.decisionSummary}
                  </p>
                )}
                <div className="space-y-2 border-t pt-4">
                  <p className="text-sm font-medium">{t("triage.decisions")}</p>
                  {selectedItem.decisions?.length ? (
                    <div className="space-y-3">
                      {selectedItem.decisions.map((decision) => (
                        <div
                          key={decision.decisionId}
                          className="space-y-3 rounded-md border p-3"
                        >
                          <p className="text-sm">
                            {displayValue(decision.summary ?? decision.reason)}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {(
                              ["correct", "incorrect", "uncertain"] as Verdict[]
                            ).map((verdict) => (
                              <Button
                                key={verdict}
                                size="sm"
                                variant={
                                  selectedVerdict === verdict
                                    ? "default"
                                    : "outline"
                                }
                                onClick={() => setSelectedVerdict(verdict)}
                              >
                                {t(`triage.verdict.${verdict}`)}
                              </Button>
                            ))}
                          </div>
                          <Input
                            value={feedbackNote}
                            onChange={(event) =>
                              setFeedbackNote(event.target.value)
                            }
                            placeholder={t("triage.notePlaceholder")}
                            aria-label={t("triage.noteLabel")}
                          />
                          <Button
                            size="sm"
                            onClick={() => recordFeedback(decision.decisionId)}
                            disabled={
                              !selectedVerdict || feedbackMutation.isPending
                            }
                          >
                            {feedbackMutation.isPending && (
                              <IconLoader2 className="animate-spin" />
                            )}
                            {t("triage.submitFeedback")}
                          </Button>
                          {feedbackMutation.isError && (
                            <div className="flex items-center gap-2 text-sm text-destructive">
                              <IconAlertCircle className="size-4" />
                              <span>{t("triage.feedbackError")}</span>
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0"
                                onClick={() =>
                                  recordFeedback(decision.decisionId)
                                }
                              >
                                {t("triage.retry")}
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("triage.noDecisions")}
                    </p>
                  )}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">
              {t("triage.rulesTitle")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("triage.rulesDescription")}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={startNewRule}>
            <IconPlus />
            {t("triage.newRule")}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-5 p-4 lg:grid-cols-[minmax(220px,.7fr)_minmax(0,1.3fr)] lg:p-6">
          <div className="space-y-2">
            {rulesQuery.isError ? (
              <ErrorState
                message={t("triage.ruleError")}
                retryLabel={t("triage.retry")}
                onRetry={() => void rulesQuery.refetch()}
              />
            ) : rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("triage.noRules")}
              </p>
            ) : (
              rules.map((rule) => (
                <Button
                  key={rule.id}
                  variant={editingRuleId === rule.id ? "secondary" : "ghost"}
                  className="h-auto w-full justify-between gap-3 px-3 py-2 text-left"
                  onClick={() => editRule(rule)}
                >
                  <span className="min-w-0 truncate">{rule.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t("triage.shadowOnly")}
                  </span>
                </Button>
              ))
            )}
          </div>

          <div className="space-y-4 rounded-md border p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="triage-rule-name">{t("triage.ruleName")}</Label>
              <Input
                id="triage-rule-name"
                value={ruleName}
                onChange={(event) => setRuleName(event.target.value)}
                placeholder={t("triage.ruleNamePlaceholder")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="triage-rule-prompt">
                {t("triage.rulePrompt")}
              </Label>
              <Textarea
                id="triage-rule-prompt"
                value={rulePrompt}
                onChange={(event) => setRulePrompt(event.target.value)}
                placeholder={t("triage.rulePromptPlaceholder")}
              />
            </div>
            <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {t("triage.hardGuards")}
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => void saveRule()}
                disabled={
                  !ruleName.trim() ||
                  !rulePrompt.trim() ||
                  saveRuleMutation.isPending
                }
              >
                {saveRuleMutation.isPending && (
                  <IconLoader2 className="animate-spin" />
                )}
                {t("triage.saveRule")}
              </Button>
              {saveRuleMutation.isError && (
                <span className="text-sm text-destructive">
                  {t("triage.ruleError")}
                </span>
              )}
              {!saveRuleMutation.isPending && saveRuleMutation.isSuccess && (
                <span className="text-sm text-muted-foreground">
                  {t("triage.ruleSaved")}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("triage.settingsTitle")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("triage.settingsDescription")}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:p-6">
          <div className="grid gap-1.5">
            <Label htmlFor="triage-slack-workspace">
              {t("triage.slackWorkspace")}
            </Label>
            <select
              id="triage-slack-workspace"
              value={slackWorkspace}
              onChange={(event) =>
                setSlackWorkspace(event.target.value as "primary" | "secondary")
              }
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="primary">primary</option>
              <option value="secondary">secondary</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="triage-slack-channel">
              {t("triage.slackChannelId")}
            </Label>
            <Input
              id="triage-slack-channel"
              value={slackChannelId}
              onChange={(event) => setSlackChannelId(event.target.value)}
              placeholder={t("triage.slackChannelPlaceholder")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="triage-slack-channel-name">
              {t("triage.slackChannelName")}
            </Label>
            <Input
              id="triage-slack-channel-name"
              value={slackChannelName}
              onChange={(event) => setSlackChannelName(event.target.value)}
              placeholder={t("triage.slackChannelNamePlaceholder")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="triage-repository">{t("triage.repository")}</Label>
            <Input
              id="triage-repository"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              placeholder={t("triage.repositoryPlaceholder")}
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <input
              id="triage-polling-enabled"
              type="checkbox"
              checked={pollingEnabled}
              onChange={(event) => setPollingEnabled(event.target.checked)}
              className="size-4 rounded border"
            />
            <Label htmlFor="triage-polling-enabled">
              {t("triage.enablePolling")}
            </Label>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2 sm:justify-end">
            <Button
              onClick={() => void saveConfig()}
              disabled={saveConfigMutation.isPending || configQuery.isLoading}
            >
              {saveConfigMutation.isPending && (
                <IconLoader2 className="animate-spin" />
              )}
              {t("triage.saveSettings")}
            </Button>
            {saveConfigMutation.isError && (
              <span className="text-sm text-destructive">
                {t("triage.settingsError")}
              </span>
            )}
            {!saveConfigMutation.isPending && saveConfigMutation.isSuccess && (
              <span className="text-sm text-muted-foreground">
                {t("triage.settingsSaved")}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FieldValue({
  label,
  value,
  pill = false,
}: {
  label: string;
  value: string | number | null | undefined;
  pill?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {pill ? (
        <TriageStatusPill status={value?.toString()} />
      ) : (
        <div className="truncate text-sm">{displayValue(value)}</div>
      )}
    </div>
  );
}

function ErrorState({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-destructive">
      <IconAlertCircle className="size-4 shrink-0" />
      <span>{message}</span>
      <Button variant="link" size="sm" className="h-auto p-0" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
