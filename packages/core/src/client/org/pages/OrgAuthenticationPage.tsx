import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { IconCircleCheck, IconCircleOff } from "@tabler/icons-react";
import { useState } from "react";

import {
  SIGN_IN_METHOD_ENV_VARS,
  type OrgSignInMethods,
  type SocialSignInMethod,
} from "../../../org/sign-in-methods.js";
import type { OrgInfo } from "../../../org/types.js";
import { useT } from "../../i18n.js";
import { SettingsGroup, SettingsRow } from "../../settings/SettingsRow.js";
import {
  A2ASecretSection,
  DomainSettingsSection,
} from "../AuthenticationSection.js";
import { OrgIdentitySettings } from "../OrgIdentitySettings.js";
import { OrgPageGate } from "./OrgPageGate.js";

const SOCIAL_METHOD_NAMES: Record<SocialSignInMethod, string> = {
  google: "Google",
  github: "GitHub",
};

const SOCIAL_METHODS: readonly SocialSignInMethod[] = ["google", "github"];

export function describeSignInMethods(
  methods: OrgSignInMethods,
  t: ReturnType<typeof useT>,
): string {
  const on = SOCIAL_METHODS.filter((method) => methods[method]).map(
    (method) => SOCIAL_METHOD_NAMES[method],
  );
  if (on.length === 0) return t("agentChat.settingsOrg.auth.methodsEmailOnly");
  if (on.length === 1) {
    return t("agentChat.settingsOrg.auth.methodsEmailAndOne", {
      method: on[0],
    });
  }
  return t("agentChat.settingsOrg.auth.methodsEmailAndTwo", {
    first: on[0],
    second: on[1],
  });
}

function MethodItem({
  on,
  name,
  note,
  envVars,
}: {
  on: boolean;
  name: string;
  note: string;
  envVars?: readonly string[];
}) {
  const t = useT();
  const Icon = on ? IconCircleCheck : IconCircleOff;
  return (
    <li className="flex gap-3 px-4 py-3">
      <Icon
        className={
          on
            ? "mt-0.5 size-4 shrink-0 text-primary"
            : "mt-0.5 size-4 shrink-0 text-muted-foreground"
        }
        aria-label={
          on
            ? t("agentChat.settingsOrg.auth.methodOn")
            : t("agentChat.settingsOrg.auth.methodOff")
        }
      />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-foreground">{name}</p>
        <p className="text-sm text-muted-foreground">{note}</p>
        {envVars ? (
          <p className="flex flex-wrap gap-1.5">
            {envVars.map((envVar) => (
              <code
                key={envVar}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
              >
                {envVar}
              </code>
            ))}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function SignInMethodsRow({
  methods,
  orgName,
}: {
  methods: OrgSignInMethods;
  orgName: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const title = t("agentChat.settingsShell.search.signInMethods");

  return (
    <SettingsRow
      id="sign-in-methods"
      label={title}
      description={describeSignInMethods(methods, t)}
      control={
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setOpen(true)}
          >
            {t("agentChat.settingsOrg.auth.view")}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
              </DialogHeader>
              <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
                <MethodItem
                  on
                  name={t("agentChat.settingsOrg.auth.emailPassword")}
                  note={t("agentChat.settingsOrg.auth.emailPasswordNote")}
                />
                {SOCIAL_METHODS.map((method) => (
                  <MethodItem
                    key={method}
                    on={methods[method]}
                    name={SOCIAL_METHOD_NAMES[method]}
                    note={
                      methods[method]
                        ? t("agentChat.settingsOrg.auth.methodConfigured")
                        : t("agentChat.settingsOrg.auth.methodNotConfigured")
                    }
                    envVars={SIGN_IN_METHOD_ENV_VARS[method]}
                  />
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                {t("agentChat.settingsOrg.auth.requireHint", { org: orgName })}
              </p>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    {t("agentChat.settingsOrg.auth.close")}
                  </Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      }
    />
  );
}

function OrgAuthenticationContent({ org }: { org: OrgInfo }) {
  const t = useT();

  return (
    <div className="space-y-8">
      <SettingsGroup
        id="sign-in"
        title={t("agentChat.settingsOrg.auth.signIn")}
      >
        <OrgIdentitySettings
          org={org}
          requiredAuthProvider={org.requiredAuthProvider}
          afterSignIn={
            org.signInMethods ? (
              <SignInMethodsRow
                methods={org.signInMethods}
                orgName={org.orgName ?? ""}
              />
            ) : null
          }
        />
      </SettingsGroup>
      <SettingsGroup
        id="joining"
        title={t("agentChat.settingsOrg.auth.joining")}
      >
        <DomainSettingsSection
          domain={org.allowedDomain}
          ownerEmail={org.email}
        />
      </SettingsGroup>
      {org.role === "owner" && (
        <SettingsGroup
          id="between-apps"
          title={t("agentChat.settingsOrg.auth.betweenApps")}
        >
          <A2ASecretSection isSet={Boolean(org.a2aSecretSet)} />
        </SettingsGroup>
      )}
    </div>
  );
}

/**
 * Organization › Authentication (owners and admins): sign-in policy, the
 * deployment's sign-in methods, SSO, SCIM, domain auto-join, and, for the
 * owner, the cross-app secret.
 */
export function OrgAuthenticationPage() {
  return (
    <OrgPageGate skeletonRows={4}>
      {(org) =>
        org.role === "owner" || org.role === "admin" ? (
          <OrgAuthenticationContent key={org.orgId} org={org} />
        ) : null
      }
    </OrgPageGate>
  );
}
