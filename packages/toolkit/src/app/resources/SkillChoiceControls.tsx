import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  isSkillOn,
  skillChoiceKey,
  skillMarkFor,
  SKILL_MARKS,
  type SkillChoicesState,
  type SkillMark,
  type SkillSource,
} from "@agent-native/core/client/resources/use-skill-choices";
import { Switch } from "@agent-native/toolkit/design-system";
import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { IconAlertCircle } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ReadOnlySettingValue } from "../settings/app-group/ReadOnlySettingValue.js";

/** One skill row's place in the skill choices. */
export interface SkillRowChoice {
  source: SkillSource;
  path: string;
  name: string;
}

/** What a Skills page shares with each skill row. */
export interface SkillRowContext {
  state: SkillChoicesState;
  orgName: string | null;
  /** Names of Dispatch skills, to warn an admin about a same-named one. */
  dispatchNames: ReadonlySet<string>;
  /** Asks before an admin makes a skill Required. */
  onRequire: (skill: SkillRowChoice) => void;
}

const MARK_LABEL_KEYS = {
  recommended: "agentChat.settingsResources.skills.markRecommended",
  optional: "agentChat.settingsResources.skills.markOptional",
  required: "agentChat.settingsResources.skills.markRequired",
} as const satisfies Record<SkillMark, string>;

const MARK_HINT_KEYS = {
  recommended: "agentChat.settingsResources.skills.markRecommendedHint",
  optional: "agentChat.settingsResources.skills.markOptionalHint",
  required: "agentChat.settingsResources.skills.markRequiredHint",
} as const satisfies Record<SkillMark, string>;

/**
 * Widths shared by the column headings and each row's controls. The switch
 * column grows for a member's "Always on" label so it never covers the text.
 */
export const SKILL_MARK_COLUMN = "w-[9.5rem]";
export const SKILL_SWITCH_COLUMN = "min-w-16";

function isMarkable(source: SkillSource, context: SkillRowContext): boolean {
  return source !== "personal" && context.state.canMark;
}

/**
 * "For everyone" and "For you" above an admin's shared skills. Hidden on a
 * narrow screen, where the controls sit under each skill's name instead.
 */
export function SkillColumnHeadings() {
  const t = useT();
  return (
    <div
      aria-hidden="true"
      className="hidden items-center gap-3 border-b border-border/60 px-5 py-2 text-xs text-muted-foreground sm:flex sm:px-6"
    >
      <span className="flex-1" />
      <span className={`${SKILL_MARK_COLUMN} text-center`}>
        {t("agentChat.settingsResources.skills.forEveryone")}
      </span>
      <span className={`${SKILL_SWITCH_COLUMN} text-center`}>
        {t("agentChat.settingsResources.skills.forYou")}
      </span>
      <span className="size-8 shrink-0" />
    </div>
  );
}

/**
 * The line under a skill's description: why it's on or off for a member, or
 * how people chose, for an admin. Admins see counts, never names.
 */
export function SkillRowNotes({
  skill,
  context,
}: {
  skill: SkillRowChoice;
  context: SkillRowContext;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { state, orgName } = context;
  if (skill.source === "personal" || !state.isLoaded) return null;
  const mark = skillMarkFor(state.choices, skill.source, skill.path);
  const key = skillChoiceKey(skill.source, skill.path);
  const lines: string[] = [];

  if (isMarkable(skill.source, context)) {
    const count = state.counts?.counts[key];
    const members = state.counts?.members ?? 0;
    if (count && mark === "recommended" && count.off > 0) {
      lines.push(
        t("agentChat.settingsResources.skills.offFor", {
          off: count.off,
          count: members,
        }),
      );
    }
    if (count && mark === "optional" && count.on > 0) {
      lines.push(
        t("agentChat.settingsResources.skills.onFor", {
          on: count.on,
          count: members,
        }),
      );
    }
    if (count && mark !== "required" && count.ownVersions > 0) {
      lines.push(
        t("agentChat.settingsResources.skills.ownVersions", {
          count: count.ownVersions,
        }),
      );
    }
  } else {
    const choice = state.choices.switches[key];
    const org = orgName ?? "";
    if (mark === "required") {
      lines.push(t("agentChat.settingsResources.skills.requiredBy", { org }));
    } else if (mark === "optional") {
      lines.push(
        choice?.on
          ? t("agentChat.settingsResources.skills.optionalOn")
          : t("agentChat.settingsResources.skills.optionalOff"),
      );
    } else if (choice?.on === false) {
      lines.push(
        t("agentChat.settingsResources.skills.switchedOffOn", {
          date: new Intl.DateTimeFormat(locale, {
            month: "short",
            day: "numeric",
          }).format(choice.at),
        }),
      );
    } else if (orgName) {
      lines.push(
        t("agentChat.settingsResources.skills.recommendedBy", { org }),
      );
    }
  }

  const clashes =
    skill.source === "organization" &&
    context.state.canMark &&
    context.dispatchNames.has(skill.name);

  if (lines.length === 0 && !clashes) return null;
  return (
    <>
      {lines.length > 0 ? (
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {lines.join(" · ")}
        </span>
      ) : null}
      {clashes ? (
        <span className="mt-1 flex items-start gap-1.5 text-xs text-foreground">
          <IconAlertCircle className="mt-px size-3.5 shrink-0" />
          {t("agentChat.settingsResources.skills.dispatchClash", {
            name: skill.name,
          })}
        </span>
      ) : null}
    </>
  );
}

/** An admin's "For everyone" select and everyone's own switch. */
export function SkillRowControls({
  skill,
  context,
}: {
  skill: SkillRowChoice;
  context: SkillRowContext;
}) {
  const t = useT();
  const { state, orgName } = context;
  const mark = skillMarkFor(state.choices, skill.source, skill.path);
  const on = isSkillOn(state.choices, skill.source, skill.path);
  const markable = isMarkable(skill.source, context);
  // Ask about Required once the menu has closed, with focus back on its
  // trigger, so the dialog takes focus and returns it there afterward.
  const requireOnClose = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const chooseMark = (next: SkillMark) => {
    if (next === mark || skill.source === "personal") return;
    if (next === "required") {
      requireOnClose.current = true;
      return;
    }
    state.setMark(skill.source, skill.path, next).catch(() => {
      toast.error(
        t("agentChat.settingsResources.skills.markFailed", {
          name: skill.name,
        }),
      );
    });
  };

  return (
    <>
      {markable ? (
        <Select
          value={mark}
          onValueChange={(value) => chooseMark(value as SkillMark)}
          disabled={!state.isLoaded}
        >
          <SelectTrigger
            ref={triggerRef}
            size="sm"
            className={`${SKILL_MARK_COLUMN} shrink-0`}
            aria-label={`${skill.name}: ${t("agentChat.settingsResources.skills.forEveryone")}`}
          >
            <SelectValue>{t(MARK_LABEL_KEYS[mark])}</SelectValue>
          </SelectTrigger>
          <SelectContent
            align="end"
            className="w-72"
            onCloseAutoFocus={(event) => {
              if (!requireOnClose.current) return;
              requireOnClose.current = false;
              event.preventDefault();
              triggerRef.current?.focus({ preventScroll: true });
              context.onRequire(skill);
            }}
          >
            {SKILL_MARKS.map((option) => (
              <SelectItem key={option} value={option}>
                <span className="block">{t(MARK_LABEL_KEYS[option])}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(MARK_HINT_KEYS[option])}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <span
        className={`flex ${SKILL_SWITCH_COLUMN} shrink-0 items-center justify-end`}
      >
        {mark === "required" ? (
          <ReadOnlySettingValue
            value={
              markable ? "" : t("agentChat.settingsResources.skills.alwaysOn")
            }
            reason={t("agentChat.settingsResources.skills.requiredLockHint", {
              org: orgName ?? "",
            })}
          />
        ) : (
          <Switch
            checked={on}
            disabled={!state.isLoaded}
            aria-label={skill.name}
            onChange={(next) => {
              state.setSwitch(skill.source, skill.path, next).catch(() => {
                toast.error(
                  t("agentChat.settingsResources.skills.switchFailed", {
                    name: skill.name,
                  }),
                );
              });
            }}
          />
        )}
      </span>
    </>
  );
}

/** Asks before an admin makes a skill Required, saying who it changes. */
export function RequireSkillDialog({
  skill,
  context,
  onOpenChange,
}: {
  skill: SkillRowChoice | null;
  context: SkillRowContext | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // The dialog has no trigger of its own, so it hands focus back to whatever
  // had it when it opened: the "For everyone" select.
  const returnFocus = useRef<HTMLElement | null>(null);
  const changeOpen = (open: boolean) => {
    if (!open) setFailed(false);
    onOpenChange(open);
  };

  const sentences: string[] = [];
  if (skill && context && skill.source !== "personal") {
    const { state, orgName } = context;
    const mark = skillMarkFor(state.choices, skill.source, skill.path);
    const count =
      state.counts?.counts[skillChoiceKey(skill.source, skill.path)];
    const members = state.counts?.members ?? 0;
    if (mark === "recommended" && count && count.off > 0) {
      sentences.push(
        t("agentChat.settingsResources.skills.requireTurnsBackOn", {
          count: count.off,
        }),
      );
    }
    const notOn = members - (count?.on ?? 0);
    if (mark === "optional" && state.counts && notOn > 0) {
      sentences.push(
        t("agentChat.settingsResources.skills.requireTurnsOn", {
          count: notOn,
        }),
      );
    }
    if (skill.source === "organization" && count && count.ownVersions > 0) {
      sentences.push(
        t("agentChat.settingsResources.skills.requireOwnVersions", {
          count: count.ownVersions,
          org: orgName ?? "",
        }),
      );
    }
    if (sentences.length === 0) {
      sentences.push(t("agentChat.settingsResources.skills.markRequiredHint"));
    }
  }

  const confirm = async () => {
    if (!skill || !context || skill.source === "personal" || pending) return;
    setPending(true);
    setFailed(false);
    try {
      await context.state.setMark(skill.source, skill.path, "required");
      changeOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={skill !== null} onOpenChange={changeOpen}>
      <AlertDialogContent
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus({ preventScroll: true });
          returnFocus.current = null;
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("agentChat.settingsResources.skills.requireTitle", {
              name: skill?.name ?? "",
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>{sentences.join(" ")}</AlertDialogDescription>
        </AlertDialogHeader>
        {failed ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertDescription>
              {t("agentChat.settingsResources.skills.markFailed", {
                name: skill?.name ?? "",
              })}
            </AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="secondary">
              {t("agentChat.settingsResources.cancel")}
            </Button>
          </AlertDialogCancel>
          <Button
            type="button"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? <Spinner /> : null}
            {t("agentChat.settingsResources.skills.makeRequired")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
