import { Avatar, AvatarFallback } from "@agent-native/toolkit/ui/avatar";
import { Button } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import { Input } from "@agent-native/toolkit/ui/input";
import { RadioGroup, RadioGroupItem } from "@agent-native/toolkit/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { useState } from "react";

import { useT } from "../i18n.js";
import {
  useAutomationAccountSearch,
  type AutomationSharingGrant,
  type AutomationSharingMode,
  type AutomationSharingRole,
  type AutomationSharingSummary,
} from "./use-jobs.js";

export interface AutomationSharingGrantDraft {
  email: string;
  role: AutomationSharingRole;
  name: string | null;
  avatar: string | null;
  outsideOrganization: boolean;
}

export interface AutomationSharingState {
  mode: AutomationSharingMode;
  grants: AutomationSharingGrantDraft[];
  acknowledgeExternalCollaborators: boolean;
}

export function defaultAutomationSharingState(): AutomationSharingState {
  return { mode: "personal", grants: [], acknowledgeExternalCollaborators: false };
}

export function automationSharingStateFromSummary(
  summary: AutomationSharingSummary,
): AutomationSharingState {
  if (summary.visibility === "organization") {
    return { mode: "organization", grants: [], acknowledgeExternalCollaborators: false };
  }
  if (summary.visibility === "shared") {
    return {
      mode: "specific",
      grants: (summary.grants ?? []).map((grant) => ({
        email: grant.email,
        role: grant.role,
        name: grant.name,
        avatar: grant.avatar,
        // Already-saved grants do not require a fresh acknowledgement unless
        // the owner changes them, so they are not flagged as outside-org here.
        outsideOrganization: false,
      })),
      acknowledgeExternalCollaborators: false,
    };
  }
  return defaultAutomationSharingState();
}

export function automationSharingRequiresAcknowledgement(
  grants: AutomationSharingGrantDraft[],
): boolean {
  return grants.some(
    (grant) => grant.outsideOrganization && grant.role === "collaborate",
  );
}

export function automationSharingIsValid(
  state: AutomationSharingState,
  orgId: string | null,
): boolean {
  if (state.mode === "organization") return Boolean(orgId);
  if (state.mode === "specific") {
    if (state.grants.length === 0) return false;
    if (
      automationSharingRequiresAcknowledgement(state.grants) &&
      !state.acknowledgeExternalCollaborators
    ) {
      return false;
    }
  }
  return true;
}

function initials(grant: AutomationSharingGrantDraft | AutomationSharingGrant) {
  const label = grant.name || grant.email;
  return label.slice(0, 2).toUpperCase();
}

export interface AutomationSharingFieldsProps {
  value: AutomationSharingState;
  onChange: (next: AutomationSharingState) => void;
  orgId: string | null;
  orgName: string | null;
  disabled?: boolean;
  submitted?: boolean;
}

export function AutomationSharingFields({
  value,
  onChange,
  orgId,
  orgName,
  disabled = false,
  submitted = false,
}: AutomationSharingFieldsProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const searchQuery = useAutomationAccountSearch(query, value.mode === "specific");
  const results = (searchQuery.data ?? []).filter(
    (account) => !value.grants.some((grant) => grant.email === account.email),
  );
  const requiresAck = automationSharingRequiresAcknowledgement(value.grants);
  const invalidGrants = submitted && value.mode === "specific" && value.grants.length === 0;
  const invalidAck = submitted && requiresAck && !value.acknowledgeExternalCollaborators;

  function setMode(mode: AutomationSharingMode) {
    onChange({ ...value, mode });
  }

  function addGrant(account: {
    email: string;
    name: string | null;
    avatar: string | null;
    outsideOrganization: boolean;
  }) {
    onChange({
      ...value,
      grants: [
        ...value.grants,
        {
          email: account.email,
          role: "view",
          name: account.name,
          avatar: account.avatar,
          outsideOrganization: account.outsideOrganization,
        },
      ],
      acknowledgeExternalCollaborators: false,
    });
    setQuery("");
  }

  function removeGrant(email: string) {
    onChange({
      ...value,
      grants: value.grants.filter((grant) => grant.email !== email),
    });
  }

  function setGrantRole(email: string, role: AutomationSharingRole) {
    onChange({
      ...value,
      grants: value.grants.map((grant) =>
        grant.email === email ? { ...grant, role } : grant,
      ),
      acknowledgeExternalCollaborators: false,
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        {t("jobs.sharingLabel", { defaultValue: "Sharing" })}
      </p>
      <RadioGroup
        value={value.mode}
        onValueChange={(mode) => setMode(mode as AutomationSharingMode)}
        className="gap-2"
      >
        <label className="flex items-start gap-2 text-sm">
          <RadioGroupItem
            value="personal"
            disabled={disabled}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">
              {t("jobs.sharingPersonal", { defaultValue: "Personal" })}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t("jobs.sharingPersonalDescription", {
                defaultValue: "Only you can access this automation.",
              })}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <RadioGroupItem
            value="organization"
            disabled={disabled || !orgId}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">
              {t("jobs.sharingOrganization", { defaultValue: "Organization" })}
            </span>
            <span className="block text-xs text-muted-foreground">
              {orgId
                ? t("jobs.sharingOrganizationDescription", {
                    defaultValue:
                      "Every current member of {{organization}} gets View access.",
                    organization: orgName || t("jobs.organization", {
                      defaultValue: "Organization",
                    }),
                  })
                : t("jobs.sharingOrganizationUnavailable", {
                    defaultValue: "Join an organization to share with members.",
                  })}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <RadioGroupItem
            value="specific"
            disabled={disabled}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">
              {t("jobs.sharingSpecific", { defaultValue: "Specific people" })}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t("jobs.sharingSpecificDescription", {
                defaultValue:
                  "Choose existing accounts and give each View or Collaborate access.",
              })}
            </span>
          </span>
        </label>
      </RadioGroup>

      {value.mode === "specific" ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="relative">
            <Input
              value={query}
              disabled={disabled}
              placeholder={t("jobs.sharingSearchPlaceholder", {
                defaultValue: "Search by name or email…",
              })}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            {searchQuery.isFetching ? (
              <IconLoader2 className="absolute end-2 top-2.5 size-4 animate-spin text-muted-foreground" />
            ) : null}
          </div>
          {query.trim().length >= 2 && results.length > 0 ? (
            <ul className="max-h-40 divide-y divide-border/60 overflow-y-auto rounded-md border">
              {results.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => addGrant(account)}
                    className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                  >
                    <Avatar className="size-6">
                      {account.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={account.avatar} alt="" />
                      ) : null}
                      <AvatarFallback className="text-[10px]">
                        {initials({
                          email: account.email,
                          name: account.name,
                        } as AutomationSharingGrant)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate">
                      {account.name || account.email}
                    </span>
                    {account.outsideOrganization ? (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t("jobs.sharingOutsideOrganization", {
                          defaultValue: "Outside organization",
                        })}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {value.grants.length === 0 ? (
            <p
              className={`text-xs ${invalidGrants ? "text-destructive" : "text-muted-foreground"}`}
            >
              {t("jobs.sharingNoGrants", {
                defaultValue: "No one has been added yet.",
              })}
            </p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-md border">
              {value.grants.map((grant) => (
                <li
                  key={grant.email}
                  className="flex items-center gap-2 px-2.5 py-2"
                >
                  <Avatar className="size-6">
                    {grant.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={grant.avatar} alt="" />
                    ) : null}
                    <AvatarFallback className="text-[10px]">
                      {initials(grant)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {grant.name || grant.email}
                    </p>
                    {grant.outsideOrganization ? (
                      <p className="text-[10px] text-muted-foreground">
                        {t("jobs.sharingOutsideOrganization", {
                          defaultValue: "Outside organization",
                        })}
                      </p>
                    ) : null}
                  </div>
                  <Select
                    value={grant.role}
                    disabled={disabled}
                    onValueChange={(role) =>
                      setGrantRole(grant.email, role as AutomationSharingRole)
                    }
                  >
                    <SelectTrigger className="h-8 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="view">
                        {t("jobs.sharingRoleView", { defaultValue: "View" })}
                      </SelectItem>
                      <SelectItem value="collaborate">
                        {t("jobs.sharingRoleCollaborate", {
                          defaultValue: "Collaborate",
                        })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 cursor-pointer text-muted-foreground"
                    disabled={disabled}
                    aria-label={t("jobs.sharingRemove", {
                      defaultValue: "Remove",
                    })}
                    onClick={() => removeGrant(grant.email)}
                  >
                    <IconX className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {requiresAck ? (
            <label className="flex items-start gap-2 text-xs">
              <Checkbox
                checked={value.acknowledgeExternalCollaborators}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onChange({
                    ...value,
                    acknowledgeExternalCollaborators: checked === true,
                  })
                }
              />
              <span className={invalidAck ? "text-destructive" : "text-muted-foreground"}>
                {t("jobs.sharingAcknowledgement", {
                  defaultValue:
                    "I understand outside-organization collaborators can edit, pause/resume, and run this automation now. It will always execute using the creator's identity.",
                })}
              </span>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AutomationSharingSummaryView({
  sharing,
}: {
  sharing: AutomationSharingSummary;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">
        {t("jobs.sharingLabel", { defaultValue: "Sharing" })}
      </p>
      <p className="mt-1 text-xs">
        {t("jobs.sharingOwnerOnly", {
          defaultValue: "Only the owner can change sharing.",
        })}
      </p>
      <p className="mt-1 text-xs">
        {sharing.visibility === "organization"
          ? t("jobs.sharingOrganization", { defaultValue: "Organization" })
          : sharing.visibility === "shared"
            ? t("jobs.sharingSpecificCount", {
                defaultValue: "Shared with {{count}} people",
                count: sharing.grantCount,
              })
            : t("jobs.sharingPersonal", { defaultValue: "Personal" })}
      </p>
    </div>
  );
}
