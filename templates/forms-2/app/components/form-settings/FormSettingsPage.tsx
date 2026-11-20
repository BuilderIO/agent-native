import { useActionMutation, useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { RETENTION_UNITS } from "@shared/form-contract";
import {
  deriveQuestions,
  MENTION_META_FIELDS,
  type MentionRef,
} from "@shared/form-model";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { useFormOutlet } from "@/components/forms/form-data";
import { META_LABEL_KEYS } from "@/components/mentions/mention-labels";
import { PageColumn } from "@/components/shell/PageColumn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  draftErrors,
  draftFromForm,
  draftToUpdate,
  LANGUAGES,
  type SettingsDraft,
} from "./settings-model";
import { TokenField, type TokenOption } from "./TokenField";

function SettingRow({
  title,
  description,
  control,
  children,
}: {
  title: string;
  description?: string | undefined;
  control: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flow-root border-b border-b-border">
      <div className="my-5 flex items-center justify-between">
        <div className="block min-w-0 flex-1 pr-[50px]">
          <div className="mb-[5px] flex gap-[10px]">
            <span className="text-sm font-bold leading-[18px]">{title}</span>
          </div>
          {description ? (
            <div className="text-sm leading-[21px] text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        <div className="shrink-0">{control}</div>
      </div>
      {children ? <div className="mb-5 max-w-[650px]">{children}</div> : null}
    </div>
  );
}

function FieldError({
  id,
  message,
}: {
  id: string;
  message?: string | undefined;
}) {
  return message ? (
    <p id={id} className="mt-1.5 text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

export function FormSettingsPage() {
  const t = useT();
  const form = useFormOutlet();
  const { session } = useSession();
  const [saved, setSaved] = useState(() => draftFromForm(form));
  const [draft, setDraft] = useState(saved);
  const save = useActionMutation("update-form-settings");
  const errors = draftErrors(draft, t);
  const [showPassword, setShowPassword] = useState(false);
  const questions = useMemo(
    () => deriveQuestions(form.publishedBlocks),
    [form.publishedBlocks],
  );
  const emailOptions = questions
    .filter((question) => question.type === "INPUT_EMAIL" && question.title)
    .map(
      (question): TokenOption => ({
        ref: { kind: "answer", questionId: question.id },
        label: question.title,
      }),
    );
  const textOptions: TokenOption[] = [
    ...questions
      .filter((question) => question.title)
      .map(
        (question): TokenOption => ({
          ref: { kind: "answer", questionId: question.id },
          label: question.title,
        }),
      ),
    ...MENTION_META_FIELDS.map((field): TokenOption => {
      const ref: MentionRef = { kind: "meta", field };
      return { ref, label: t(META_LABEL_KEYS[field]) };
    }),
  ];
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const canSave = dirty && Object.keys(errors).length === 0;
  const change = (patch: Partial<SettingsDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  function submit() {
    const sent = draft;
    save.mutate(
      { id: form.id, ...draftToUpdate(sent) },
      {
        onSuccess: () => {
          const stored = {
            ...sent,
            password: "",
            passwordStored: sent.passwordEnabled,
          };
          setSaved(stored);
          setDraft((current) => ({
            ...current,
            password: "",
            passwordStored: sent.passwordEnabled,
          }));
        },
      },
    );
  }

  return (
    <>
      <PageColumn className="mt-8 mb-28">
        <div className="border-b border-b-border text-lg font-bold leading-[42px]">
          {t("forms.settings.general")}
        </div>
        <>
          <SettingRow
            title={t("forms.settings.languageTitle")}
            description={t("forms.settings.languageDescription")}
            control={
              <Select
                value={draft.language}
                onValueChange={(language) => change({ language })}
              >
                <SelectTrigger
                  aria-label={t("forms.settings.languageTitle")}
                  className="w-[200px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((language) => (
                    <SelectItem key={language.code} value={language.code}>
                      {language.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />

          <SettingRow
            title={t("forms.settings.redirectTitle")}
            description={t("forms.settings.redirectDescription")}
            control={
              <Switch
                className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
                aria-label={t("forms.settings.redirectTitle")}
                checked={draft.redirectEnabled}
                onCheckedChange={(redirectEnabled) =>
                  change({ redirectEnabled })
                }
              />
            }
          >
            {draft.redirectEnabled ? (
              <>
                <Input
                  type="url"
                  aria-label={t("forms.settings.redirectLink")}
                  aria-describedby="redirect-error"
                  aria-invalid={errors.redirectUrl ? true : undefined}
                  placeholder="https://example.com/thanks"
                  value={draft.redirectUrl}
                  onChange={(event) =>
                    change({ redirectUrl: event.target.value })
                  }
                />
                <FieldError id="redirect-error" message={errors.redirectUrl} />
              </>
            ) : null}
          </SettingRow>

          <SettingRow
            title={t("forms.settings.progressTitle")}
            description={t("forms.settings.progressDescription")}
            control={
              <Switch
                className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
                aria-label={t("forms.settings.progressTitle")}
                checked={draft.progressBar}
                onCheckedChange={(progressBar) => change({ progressBar })}
              />
            }
          />

          <SettingRow
            title={t("forms.settings.closeTitle")}
            description={t("forms.settings.closeDescription")}
            control={
              <Switch
                className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
                aria-label={t("forms.settings.closeTitle")}
                checked={draft.isClosed}
                onCheckedChange={(isClosed) => change({ isClosed })}
              />
            }
          >
            {draft.isClosed ? (
              <Textarea
                aria-label={t("forms.settings.closedMessage")}
                placeholder={t("forms.settings.closedMessagePlaceholder")}
                maxLength={2000}
                value={draft.closedMessage}
                onChange={(event) =>
                  change({ closedMessage: event.target.value })
                }
              />
            ) : null}
          </SettingRow>

          <SettingRow
            title={t("forms.settings.limitTitle")}
            description={t("forms.settings.limitDescription")}
            control={
              <Switch
                className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
                aria-label={t("forms.settings.limitTitle")}
                checked={draft.limitEnabled}
                onCheckedChange={(limitEnabled) => change({ limitEnabled })}
              />
            }
          >
            {draft.limitEnabled ? (
              <>
                <Input
                  type="number"
                  min={1}
                  aria-label={t("forms.settings.limitMax")}
                  aria-describedby="limit-error"
                  aria-invalid={errors.submissionsLimit ? true : undefined}
                  className="w-40"
                  value={draft.submissionsLimit}
                  onChange={(event) =>
                    change({ submissionsLimit: event.target.value })
                  }
                />
                <FieldError
                  id="limit-error"
                  message={errors.submissionsLimit}
                />
              </>
            ) : null}
          </SettingRow>

          <SettingRow
            title={t("forms.settings.scheduleTitle")}
            description={t("forms.settings.scheduleDescription")}
            control={
              <Switch
                className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
                aria-label={t("forms.settings.scheduleTitle")}
                checked={draft.closeEnabled}
                onCheckedChange={(closeEnabled) => change({ closeEnabled })}
              />
            }
          >
            {draft.closeEnabled ? (
              <>
                <Input
                  type="datetime-local"
                  aria-label={t("forms.settings.closeAt")}
                  aria-describedby="close-error"
                  aria-invalid={errors.closeAt ? true : undefined}
                  className="w-60"
                  value={draft.closeAt}
                  onChange={(event) => change({ closeAt: event.target.value })}
                />
                <FieldError id="close-error" message={errors.closeAt} />
              </>
            ) : null}
          </SettingRow>

          <SettingRow
            title={t("forms.settings.autoJumpTitle")}
            description={t("forms.settings.autoJumpDescription")}
            control={
              <Switch
                className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
                aria-label={t("forms.settings.autoJumpTitle")}
                checked={draft.autoJump}
                onCheckedChange={(autoJump) => change({ autoJump })}
              />
            }
          />

          <SettingRow
            title={t("forms.collection.partialTitle")}
            description={t("forms.collection.partialDescription")}
            control={
              <Switch
                className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
                aria-label={t("forms.collection.partialTitle")}
                checked={draft.partialSubmissions}
                onCheckedChange={(partialSubmissions) =>
                  change({ partialSubmissions })
                }
              />
            }
          />

          <SettingRow
            title={t("forms.collection.retentionTitle")}
            description={t("forms.collection.retentionDescription")}
            control={
              <Switch
                className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
                aria-label={t("forms.collection.retentionTitle")}
                checked={draft.retentionEnabled}
                onCheckedChange={(retentionEnabled) =>
                  change({ retentionEnabled })
                }
              />
            }
          >
            {draft.retentionEnabled ? (
              <>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={1}
                    aria-label={t("forms.collection.retentionPeriod")}
                    aria-describedby="retention-error"
                    aria-invalid={errors.retentionValue ? true : undefined}
                    className="w-24"
                    value={draft.retentionValue}
                    onChange={(event) =>
                      change({ retentionValue: event.target.value })
                    }
                  />
                  <Select
                    value={draft.retentionUnit}
                    onValueChange={(retentionUnit) =>
                      change({
                        retentionUnit:
                          RETENTION_UNITS.find(
                            (unit) => unit === retentionUnit,
                          ) ?? draft.retentionUnit,
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label={t("forms.collection.retentionUnit")}
                      className="w-[140px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RETENTION_UNITS.map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {t(`forms.collection.unit.${unit}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <FieldError
                  id="retention-error"
                  message={errors.retentionValue}
                />
              </>
            ) : null}
          </SettingRow>

          <div className="mt-8 border-b border-b-border text-lg font-bold leading-[42px]">
            {t("forms.collection.accessSection")}
          </div>

          <SettingRow
            title={t("forms.collection.passwordTitle")}
            description={t("forms.collection.passwordDescription")}
            control={
              <Switch
                className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
                aria-label={t("forms.collection.passwordTitle")}
                checked={draft.passwordEnabled}
                onCheckedChange={(passwordEnabled) =>
                  change({ passwordEnabled })
                }
              />
            }
          >
            {draft.passwordEnabled ? (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    aria-label={t("forms.collection.passwordLabel")}
                    aria-describedby="password-error"
                    aria-invalid={errors.password ? true : undefined}
                    placeholder={
                      draft.passwordStored
                        ? t("forms.collection.passwordKeep")
                        : ""
                    }
                    value={draft.password}
                    onChange={(event) =>
                      change({ password: event.target.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={
                      showPassword
                        ? t("forms.collection.hidePassword")
                        : t("forms.collection.showPassword")
                    }
                    onClick={() => setShowPassword((shown) => !shown)}
                  >
                    {showPassword ? <IconEyeOff /> : <IconEye />}
                  </Button>
                </div>
                <FieldError id="password-error" message={errors.password} />
              </>
            ) : null}
          </SettingRow>

          <SettingRow
            title={t("forms.collection.uniqueTitle")}
            description={t("forms.collection.uniqueDescription")}
            control={
              <Switch
                className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
                aria-label={t("forms.collection.uniqueTitle")}
                checked={draft.duplicatesEnabled}
                onCheckedChange={(duplicatesEnabled) =>
                  change({ duplicatesEnabled })
                }
              />
            }
          >
            {draft.duplicatesEnabled ? (
              <Select
                value={draft.uniqueKey}
                onValueChange={(uniqueKey) => change({ uniqueKey })}
              >
                <SelectTrigger
                  aria-label={t("forms.collection.uniqueKey")}
                  className="w-[260px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="respondent">
                    {t("forms.collection.uniqueRespondent")}
                  </SelectItem>
                  <SelectItem value="ip">
                    {t("forms.collection.uniqueIp")}
                  </SelectItem>
                  {questions.map((question) => (
                    <SelectItem
                      key={question.id}
                      value={`field:${question.id}`}
                    >
                      {question.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </SettingRow>

          <div className="mt-8 border-b border-b-border text-lg font-bold leading-[42px]">
            {t("forms.collection.behaviorSection")}
          </div>

          <SettingRow
            title={t("forms.collection.submitLabelTitle")}
            description={t("forms.collection.submitLabelDescription")}
            control={
              <Input
                aria-label={t("forms.collection.submitLabelTitle")}
                placeholder={t("forms.collection.submitLabelPlaceholder")}
                maxLength={60}
                value={draft.submitLabel}
                onChange={(event) =>
                  change({ submitLabel: event.target.value })
                }
              />
            }
          />

          <SettingRow
            title={t("forms.collection.saveLaterTitle")}
            description={t("forms.collection.saveLaterDescription")}
            control={
              <Switch
                className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
                aria-label={t("forms.collection.saveLaterTitle")}
                checked={draft.saveForLater}
                onCheckedChange={(saveForLater) => change({ saveForLater })}
              />
            }
          />

          <div className="mt-8 border-b border-b-border text-lg font-bold leading-[42px]">
            {t("forms.notify.section")}
          </div>

          <SettingRow
            title={t("forms.notify.ownerTitle")}
            description={t("forms.notify.ownerDescription")}
            control={
              <Switch
                className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
                aria-label={t("forms.notify.ownerTitle")}
                checked={draft.notifyOwner}
                onCheckedChange={(notifyOwner) =>
                  change({
                    notifyOwner,
                    ownerTo:
                      notifyOwner && !draft.ownerTo.trim()
                        ? (session?.email ?? "")
                        : draft.ownerTo,
                  })
                }
              />
            }
          >
            {draft.notifyOwner ? (
              <>
                <Input
                  aria-label={t("forms.notify.to")}
                  aria-describedby="owner-to-error"
                  aria-invalid={errors.ownerTo ? true : undefined}
                  placeholder={t("forms.notify.ownerToPlaceholder")}
                  value={draft.ownerTo}
                  onChange={(event) => change({ ownerTo: event.target.value })}
                />
                <FieldError id="owner-to-error" message={errors.ownerTo} />
              </>
            ) : null}
          </SettingRow>

          <SettingRow
            title={t("forms.notify.respondentTitle")}
            description={t("forms.notify.respondentDescription")}
            control={
              <Switch
                className="aria-[checked=false]:bg-[var(--forms-ink-off)]"
                aria-label={t("forms.notify.respondentTitle")}
                checked={draft.notifyRespondent}
                onCheckedChange={(notifyRespondent) =>
                  change({ notifyRespondent })
                }
              />
            }
          >
            {draft.notifyRespondent ? (
              <div className="flex flex-col gap-4">
                <div>
                  <TokenField
                    label={t("forms.notify.to")}
                    placeholder={t("forms.notify.respondentToPlaceholder")}
                    value={draft.respondentTo}
                    options={emailOptions}
                    invalid={Boolean(errors.respondentTo)}
                    onChange={(respondentTo) => change({ respondentTo })}
                  />
                  <FieldError
                    id="respondent-to-error"
                    message={errors.respondentTo}
                  />
                </div>
                <TokenField
                  label={t("forms.notify.subject")}
                  value={draft.respondentSubject}
                  options={textOptions}
                  maxLength={200}
                  onChange={(respondentSubject) =>
                    change({ respondentSubject })
                  }
                />
                <TokenField
                  multiline
                  label={t("forms.notify.message")}
                  value={draft.respondentMessage}
                  options={textOptions}
                  maxLength={5000}
                  onChange={(respondentMessage) =>
                    change({ respondentMessage })
                  }
                />
              </div>
            ) : null}
          </SettingRow>
        </>
      </PageColumn>
      <div className="sticky bottom-0 border-t border-t-border bg-background py-5">
        <PageColumn className="flex items-center gap-4">
          <Button
            variant={canSave ? "default" : "outline"}
            className="h-9 rounded-lg px-[13.5px] text-[15px] font-normal"
            disabled={!canSave || save.isPending}
            onClick={submit}
          >
            <span className="font-semibold">{t("forms.settings.save")}</span>
          </Button>
          {save.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t("forms.settings.saveFailed")}
            </p>
          ) : null}
        </PageColumn>
      </div>
    </>
  );
}
