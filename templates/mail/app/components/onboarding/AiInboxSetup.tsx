import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { AI_FILTER_LABEL } from "@shared/ai-filter";
import { AI_IMPORTANT_LABEL } from "@shared/ai-priority";
import type { AutomationAction } from "@shared/types";
import { IconCheck } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AiRulePromptField } from "@/components/settings/AiRulePromptField";
import {
  JevAvailabilityError,
  JevConnectionPrompt,
} from "@/components/settings/JevConnectionPrompt";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAutomations, useCreateAutomation } from "@/hooks/use-automations";
import { useLabels, useSettings, useUpdateSettings } from "@/hooks/use-emails";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";

export const TAG_SUGGESTIONS = [
  [
    "receipts",
    "mail.sort.aiSetupTagReceipts",
    "mail.sort.aiSetupPromptReceipts",
  ],
  ["updates", "mail.sort.aiSetupTagUpdates", "mail.sort.aiSetupPromptUpdates"],
  ["github", "mail.sort.aiSetupTagGitHub", "mail.sort.aiSetupPromptGitHub"],
  [
    "calendar",
    "mail.sort.aiSetupTagCalendar",
    "mail.sort.aiSetupPromptCalendar",
  ],
  ["travel", "mail.sort.aiSetupTagTravel", "mail.sort.aiSetupPromptTravel"],
  ["finance", "mail.sort.aiSetupTagFinance", "mail.sort.aiSetupPromptFinance"],
] as const;

type SetupStep = -1 | 0 | 1 | 2;

export function AiInboxSetup({
  forceOpen = false,
  onOpenChange,
}: {
  forceOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const { data: settings } = useSettings();
  const { data: rules = [], isLoading: rulesLoading } = useAutomations();
  const { data: labels = [] } = useLabels();
  const googleStatus = useGoogleAuthStatus();
  const connected = (googleStatus.data?.accounts.length ?? 0) > 0;
  const jevAvailability = useActionQuery(
    "get-jev-availability",
    {},
    {
      enabled: connected,
      staleTime: 0,
      // request-storm-allow: the shared status query revalidates API-key setup when its settings tab returns.
      refetchOnWindowFocus: true,
    },
  );
  const jevAvailabilityResolved =
    !jevAvailability.isError && jevAvailability.data != null;
  const jevConfigured =
    jevAvailabilityResolved && jevAvailability.data?.configured === true;
  const createRuleMutation = useCreateAutomation();
  const updateSettings = useUpdateSettings();
  const [step, setStep] = useState<SetupStep>(0);
  const [selectedTags, setSelectedTags] = useState(
    () => new Set<string>(["receipts", "github"]),
  );
  const [customTagSelected, setCustomTagSelected] = useState(false);
  const [customTagName, setCustomTagName] = useState("");
  const [customTagPrompt, setCustomTagPrompt] = useState("");
  const [importantPrompt, setImportantPrompt] = useState(() =>
    t("mail.sort.aiSetupImportantPrompt"),
  );
  const [archivePrompt, setArchivePrompt] = useState("");
  const [spamPrompt, setSpamPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [jevStepRequired, setJevStepRequired] = useState(false);
  const previousForceOpen = useRef(forceOpen);

  const aiRules = useMemo(
    () =>
      rules.filter(
        (rule) => rule.domain === "mail" && rule.kind === "ai-filter",
      ),
    [rules],
  );
  const visible =
    connected &&
    !googleStatus.isLoading &&
    !rulesLoading &&
    !jevAvailability.isLoading &&
    (forceOpen ||
      (settings?.aiSetupCompleted !== true && aiRules.length === 0));

  useEffect(() => {
    const wasForceOpen = previousForceOpen.current;
    if (!forceOpen) previousForceOpen.current = false;
    if (!visible || !jevAvailabilityResolved) return;
    previousForceOpen.current = forceOpen;
    if (forceOpen && !wasForceOpen) {
      setJevStepRequired(!jevConfigured);
      setStep(jevConfigured ? 0 : -1);
    } else if (!jevConfigured) {
      setJevStepRequired(true);
      setStep(-1);
    } else if (step === -1) {
      setStep(0);
    }
  }, [forceOpen, jevAvailabilityResolved, jevConfigured, step, visible]);

  const complete = async () => {
    try {
      await updateSettings.mutateAsync({ aiSetupCompleted: true });
      onOpenChange?.(false);
    } catch {
      toast.error(t("mail.aiFilter.settingsFailed"));
    }
  };

  const saveRule = async (condition: string, actions: AutomationAction[]) => {
    const trimmed = condition.trim();
    if (!trimmed) return;
    if (
      aiRules.some(
        (rule) =>
          rule.condition.trim() === trimmed &&
          JSON.stringify(rule.actions) === JSON.stringify(actions),
      )
    ) {
      return;
    }
    await createRuleMutation.mutateAsync({
      name: trimmed.slice(0, 72),
      condition: trimmed,
      actions,
      kind: "ai-filter",
      domain: "mail",
    });
  };

  const saveStep = async () => {
    if (step < 0 || !jevConfigured) return;
    setSaving(true);
    try {
      if (step === 0) {
        const currentPinned = settings?.pinnedLabels ?? [];
        const tagIds = [...currentPinned];
        for (const [id, nameKey, promptKey] of TAG_SUGGESTIONS) {
          if (!selectedTags.has(id)) continue;
          const labelName = t(nameKey);
          const prompt = t(promptKey);
          const labelId =
            labels.find(
              (label) =>
                label.name.toLocaleLowerCase() ===
                labelName.toLocaleLowerCase(),
            )?.id ?? labelName.toLocaleLowerCase().replace(/_/g, " ");
          await saveRule(prompt, [{ type: "label", labelName }]);
          if (!tagIds.includes(labelId)) tagIds.push(labelId);
        }
        if (
          customTagSelected &&
          customTagName.trim() &&
          customTagPrompt.trim()
        ) {
          const labelName = customTagName.trim();
          const labelId =
            labels.find(
              (label) =>
                label.name.toLocaleLowerCase() ===
                labelName.toLocaleLowerCase(),
            )?.id ?? labelName.toLocaleLowerCase().replace(/_/g, " ");
          await saveRule(customTagPrompt, [{ type: "label", labelName }]);
          if (!tagIds.includes(labelId)) tagIds.push(labelId);
        }
        if (tagIds.length !== currentPinned.length) {
          await updateSettings.mutateAsync({ pinnedLabels: tagIds });
        }
      } else if (step === 1) {
        await saveRule(importantPrompt, [
          { type: "label", labelName: AI_IMPORTANT_LABEL },
        ]);
      } else {
        await saveRule(archivePrompt, [{ type: "archive" }]);
        await saveRule(spamPrompt, [
          { type: "label", labelName: AI_FILTER_LABEL },
          { type: "archive" },
        ]);
      }
      if (step < 2) setStep((current) => (current + 1) as SetupStep);
      else await complete();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("mail.aiFilter.instructionFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    if (step < 0) {
      await complete();
      return;
    }
    if (!jevAvailabilityResolved) return;
    if (!jevConfigured) {
      await complete();
      return;
    }
    if (step < 2) {
      setStep((current) => (current + 1) as SetupStep);
      return;
    }
    await complete();
  };

  const headline =
    step === -1
      ? jevAvailability.isError
        ? t("mail.aiFilter.jevAvailabilityFailed")
        : t("mail.aiFilter.connectJev")
      : step === 0
        ? t("mail.sort.aiSetupTagsHeadline")
        : step === 1
          ? t("mail.sort.aiSetupImportantHeadline")
          : t("mail.sort.aiSetupSkipInboxHeadline");
  const stepCount = jevStepRequired ? 4 : 3;
  const progressIndex = step < 0 ? 0 : step + (jevStepRequired ? 1 : 0);
  const customTagIncomplete =
    step === 0 &&
    customTagSelected &&
    (!customTagName.trim() || !customTagPrompt.trim());

  return (
    <Dialog
      open={visible}
      onOpenChange={(open) => {
        if (!open) {
          onOpenChange?.(false);
          void complete();
        }
      }}
    >
      <DialogContent className="fixed inset-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-0 p-6 sm:p-12">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center">
          <DialogHeader className="mb-6">
            <DialogTitle className="text-xl font-semibold">
              {headline}
            </DialogTitle>
          </DialogHeader>
          <div
            className="mb-8 flex items-center gap-2"
            aria-label={`${progressIndex + 1}/${stepCount}`}
          >
            {Array.from({ length: stepCount }, (_, index) => index).map(
              (index) => (
                <span
                  key={index}
                  className={`h-1 flex-1 rounded-full ${index <= progressIndex ? "bg-primary" : "bg-muted"}`}
                />
              ),
            )}
          </div>
          {step >= 0 && jevAvailability.isError ? (
            <div className="mb-5">
              <JevAvailabilityError
                onRetry={() => void jevAvailability.refetch()}
                retrying={jevAvailability.isFetching}
              />
            </div>
          ) : null}
          {step === -1 ? (
            jevAvailability.isError ? (
              <JevAvailabilityError
                onRetry={() => void jevAvailability.refetch()}
                retrying={jevAvailability.isFetching}
                showMessage={false}
              />
            ) : (
              <JevConnectionPrompt
                showHeading={false}
                onConnected={() => void jevAvailability.refetch()}
              />
            )
          ) : step === 0 ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {TAG_SUGGESTIONS.map(([id, nameKey]) => {
                  const selected = selectedTags.has(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setSelectedTags((current) => {
                          const next = new Set(current);
                          if (selected) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm transition-colors ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {selected ? <IconCheck className="size-3.5" /> : null}
                      {t(nameKey)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-pressed={customTagSelected}
                  onClick={() => setCustomTagSelected((selected) => !selected)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm transition-colors ${customTagSelected ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {customTagSelected ? (
                    <IconCheck className="size-3.5" />
                  ) : null}
                  {t("mail.sort.aiSetupCustomTag")}
                </button>
              </div>
              {customTagSelected && (
                <div className="space-y-3">
                  <Input
                    value={customTagName}
                    onChange={(event) => setCustomTagName(event.target.value)}
                    placeholder={t("mail.aiFilter.tagNamePlaceholder")}
                    aria-label={t("mail.aiFilter.tagNamePlaceholder")}
                  />
                  <AiRulePromptField
                    value={customTagPrompt}
                    onChange={setCustomTagPrompt}
                    label={t("mail.aiFilter.tagPlaceholder")}
                    placeholder={t("mail.aiFilter.tagPlaceholder")}
                  />
                </div>
              )}
            </div>
          ) : step === 1 ? (
            <AiRulePromptField
              value={importantPrompt}
              onChange={setImportantPrompt}
              label={headline}
              className="min-h-36 resize-none text-sm"
            />
          ) : (
            <div className="space-y-4">
              <label className="block space-y-2 text-sm font-medium">
                {t("mail.sort.aiSetupArchiveLabel")}
                <AiRulePromptField
                  value={archivePrompt}
                  onChange={setArchivePrompt}
                  label={t("mail.sort.aiSetupArchiveLabel")}
                  placeholder={t("mail.aiFilter.archivePlaceholder")}
                  className="min-h-28 resize-none text-sm font-normal"
                />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                {t("mail.sort.aiSetupSpamLabel")}
                <AiRulePromptField
                  value={spamPrompt}
                  onChange={setSpamPrompt}
                  label={t("mail.sort.aiSetupSpamLabel")}
                  placeholder={t("mail.aiFilter.spamPlaceholder")}
                  className="min-h-28 resize-none text-sm font-normal"
                />
              </label>
            </div>
          )}
          <div className="mt-8 flex items-center justify-between">
            <div className="flex items-center gap-1">
              {step > 0 && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    setStep((current) => (current - 1) as SetupStep)
                  }
                  disabled={saving}
                >
                  {t("mail.thread.back")}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => void skip()}
                disabled={saving || (step >= 0 && !jevAvailabilityResolved)}
              >
                {t("mail.sort.aiSetupSkip")}
              </Button>
            </div>
            {step >= 0 && (
              <Button
                onClick={() => void saveStep()}
                disabled={saving || !jevConfigured || customTagIncomplete}
              >
                {step === 2
                  ? t("mail.sort.aiSetupDone")
                  : t("mail.sort.aiSetupContinue")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
