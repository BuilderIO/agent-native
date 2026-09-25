import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button as ToolkitButton } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { useEffect, useState, type ReactNode } from "react";

import { useT } from "../i18n.js";
import { SettingsRow } from "../settings/SettingsRow.js";
import {
  useSetOrgAuthProvider,
  useOrgSsoProviders,
  useCreateOrgSsoProvider,
  useVerifyOrgSsoProvider,
  useDeleteOrgSsoProvider,
  useOrgScim,
  useCreateOrgScimConnection,
  useDeleteOrgScimConnection,
} from "./hooks.js";
import { ErrorText } from "./TeamPrimitives.js";

export function OrgIdentitySettings({
  org,
  requiredAuthProvider,
  afterSignIn,
}: {
  org: { orgId: string | null; allowedDomain: string | null; access?: unknown };
  requiredAuthProvider: string | null | undefined;
  /** Rows rendered between Organization sign-in and Single sign-on. */
  afterSignIn?: ReactNode;
}) {
  const t = useT();
  const access = org.access as
    | { sso?: { enabled?: boolean }; scim?: { enabled?: boolean } }
    | undefined;
  const ssoEnabled = Boolean(access?.sso?.enabled);
  const scimEnabled = Boolean(access?.scim?.enabled);
  const [pendingAuthProvider, setPendingAuthProvider] = useState<
    "google" | `sso:${string}` | null
  >(null);
  const setAuthProvider = useSetOrgAuthProvider();
  const ssoQuery = useOrgSsoProviders(ssoEnabled);
  const createSso = useCreateOrgSsoProvider();
  const verifySso = useVerifyOrgSsoProvider();
  const deleteSso = useDeleteOrgSsoProvider();
  const scimQuery = useOrgScim(scimEnabled);
  const createScim = useCreateOrgScimConnection();
  const deleteScim = useDeleteOrgScimConnection();
  const [providerType, setProviderType] = useState<"oidc" | "saml">("oidc");
  const [providerId, setProviderId] = useState("");
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [discoveryEndpoint, setDiscoveryEndpoint] = useState("");
  const [entryPoint, setEntryPoint] = useState("");
  const [cert, setCert] = useState("");
  const [entityId, setEntityId] = useState("");
  const [metadata, setMetadata] = useState("");
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [domainVerificationTokens, setDomainVerificationTokens] = useState<
    Record<string, string>
  >({});
  const [oneTimeScimToken, setOneTimeScimToken] = useState<string | null>(null);
  useEffect(() => {
    setOneTimeScimToken(null);
    setClientSecret("");
    setMetadata("");
    setCert("");
    setDomainVerificationTokens({});
  }, [org.orgId]);
  const providers = ssoQuery.data?.providers ?? [];

  function submitProvider(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const base = {
      providerId: providerId.trim(),
      issuer: issuer.trim(),
      domain: org.allowedDomain ?? "",
      type: providerType,
    };
    const oidcConfig =
      providerType === "oidc"
        ? {
            clientId: clientId.trim(),
            clientSecret,
            ...(discoveryEndpoint.trim()
              ? { discoveryEndpoint: discoveryEndpoint.trim() }
              : {}),
          }
        : undefined;
    const samlConfig =
      providerType === "saml"
        ? {
            entryPoint: entryPoint.trim(),
            ...(cert.trim() ? { cert: cert.trim() } : {}),
            idpMetadata: { entityID: entityId.trim(), metadata },
          }
        : undefined;
    createSso.mutate(
      {
        ...base,
        ...(oidcConfig ? { oidcConfig } : {}),
        ...(samlConfig ? { samlConfig } : {}),
      },
      {
        onSuccess: (result) => {
          setClientSecret("");
          setMetadata("");
          setCert("");
          if (result.domainVerificationToken) {
            setDomainVerificationTokens((current) => ({
              ...current,
              [result.provider.providerId]: result.domainVerificationToken!,
            }));
          }
          setShowProviderForm(false);
        },
      },
    );
  }

  return (
    <>
      <SettingsRow
        id="organization-sign-in"
        label={t("org.sso.signIn")}
        description={t("org.sso.signInHelp")}
        control={
          <Select
            value={requiredAuthProvider ?? "optional"}
            onValueChange={(value) => {
              const next =
                value === "optional"
                  ? null
                  : (value as "google" | `sso:${string}`);
              if (next) setPendingAuthProvider(next);
              else setAuthProvider.mutate(null);
            }}
            disabled={
              setAuthProvider.isPending ||
              (requiredAuthProvider?.startsWith("sso:") &&
                !providers.some(
                  (provider) =>
                    `sso:${provider.providerId}` === requiredAuthProvider,
                ))
            }
          >
            <SelectTrigger
              className="h-auto w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs sm:w-auto"
              aria-label={t("org.sso.requiredProvider")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="optional">{t("org.sso.optional")}</SelectItem>
              <SelectItem value="google">{t("org.sso.google")}</SelectItem>
              {providers
                .filter((provider) => provider.domainVerified)
                .map((provider) => (
                  <SelectItem
                    key={provider.providerId}
                    value={`sso:${provider.providerId}`}
                  >
                    {provider.domain} ({provider.type.toUpperCase()})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        }
      >
        {setAuthProvider.error ? (
          <ErrorText error={setAuthProvider.error} />
        ) : null}
      </SettingsRow>

      {afterSignIn}

      {ssoEnabled && (
        <SettingsRow
          id="organization-sso"
          label={t("org.sso.title")}
          description={t("org.sso.description")}
        >
          {ssoQuery.error ? <ErrorText error={ssoQuery.error} /> : null}
          {providers.map((provider) => (
            <div
              key={provider.providerId}
              className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0"
            >
              <span>
                {provider.domain} · {provider.type.toUpperCase()} ·{" "}
                {provider.domainVerified
                  ? t("org.sso.verified")
                  : t("org.sso.verifyRequired")}
              </span>
              <span className="flex gap-2">
                {!provider.domainVerified && (
                  <ToolkitButton
                    size="sm"
                    variant="outline"
                    disabled={verifySso.isPending}
                    onClick={() => verifySso.mutate(provider.providerId)}
                  >
                    {t("org.sso.verify")}
                  </ToolkitButton>
                )}
                <ToolkitButton
                  size="sm"
                  variant="ghost"
                  disabled={deleteSso.isPending}
                  onClick={() => deleteSso.mutate(provider.providerId)}
                >
                  {t("org.sso.remove")}
                </ToolkitButton>
              </span>
              <details className="w-full text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {t("org.ssoSetup.idpSetup")}
                </summary>
                <dl className="mt-2 grid gap-1">
                  <dt>{t("org.ssoSetup.redirectUri")}</dt>
                  <dd className="break-all font-mono">
                    {provider.redirectURI}
                  </dd>
                  {provider.spMetadataUrl ? (
                    <>
                      <dt>{t("org.ssoSetup.spMetadataUrl")}</dt>
                      <dd className="break-all font-mono">
                        {provider.spMetadataUrl}
                      </dd>
                    </>
                  ) : null}
                  {domainVerificationTokens[provider.providerId] ? (
                    <>
                      <dt>{t("org.ssoSetup.dnsRecordName")}</dt>
                      <dd className="break-all font-mono">
                        _better-auth-token-{provider.providerId}.
                        {provider.domain}
                      </dd>
                      <dt>{t("org.ssoSetup.dnsRecordValue")}</dt>
                      <dd className="break-all font-mono">
                        {domainVerificationTokens[provider.providerId]}
                      </dd>
                      <p>{t("org.ssoSetup.dnsPropagation")}</p>
                    </>
                  ) : null}
                </dl>
              </details>
            </div>
          ))}
          {verifySso.error ? <ErrorText error={verifySso.error} /> : null}
          {deleteSso.error ? <ErrorText error={deleteSso.error} /> : null}
          {showProviderForm ? (
            <form
              onSubmit={submitProvider}
              className="grid gap-2 border-t pt-3"
            >
              <Select
                value={providerType}
                onValueChange={(value) =>
                  setProviderType(value as "oidc" | "saml")
                }
              >
                <SelectTrigger aria-label={t("org.sso.type")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oidc">OIDC</SelectItem>
                  <SelectItem value="saml">SAML</SelectItem>
                </SelectContent>
              </Select>
              <Input
                aria-label={t("org.sso.providerId")}
                placeholder={t("org.sso.providerId")}
                value={providerId}
                onChange={(event) => setProviderId(event.target.value)}
                required
              />
              <Input
                aria-label={t("org.sso.issuer")}
                placeholder={t("org.sso.issuer")}
                value={issuer}
                onChange={(event) => setIssuer(event.target.value)}
                required
              />
              <Input
                aria-label={t("org.sso.domain")}
                value={org.allowedDomain ?? t("org.sso.noDomain")}
                readOnly
              />
              {providerType === "oidc" ? (
                <>
                  <Input
                    aria-label={t("org.sso.clientId")}
                    placeholder={t("org.sso.clientId")}
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    required
                  />
                  <Input
                    aria-label={t("org.sso.clientSecret")}
                    placeholder={t("org.sso.clientSecret")}
                    type="password"
                    value={clientSecret}
                    onChange={(event) => setClientSecret(event.target.value)}
                    required
                  />
                  <Input
                    aria-label={t("org.sso.discoveryEndpoint")}
                    placeholder={t("org.sso.discoveryEndpoint")}
                    value={discoveryEndpoint}
                    onChange={(event) =>
                      setDiscoveryEndpoint(event.target.value)
                    }
                  />
                </>
              ) : (
                <>
                  <Input
                    aria-label={t("org.sso.entryPoint")}
                    placeholder={t("org.sso.entryPoint")}
                    value={entryPoint}
                    onChange={(event) => setEntryPoint(event.target.value)}
                    required
                  />
                  <Input
                    aria-label={t("org.sso.entityId")}
                    placeholder={t("org.sso.entityId")}
                    value={entityId}
                    onChange={(event) => setEntityId(event.target.value)}
                    required
                  />
                  <textarea
                    aria-label={t("org.sso.metadata")}
                    className="min-h-28 rounded-md border bg-background p-2 text-sm"
                    placeholder={t("org.sso.metadata")}
                    value={metadata}
                    onChange={(event) => setMetadata(event.target.value)}
                    required
                  />
                  <textarea
                    aria-label={t("org.sso.certificate")}
                    className="min-h-20 rounded-md border bg-background p-2 text-sm"
                    placeholder={t("org.sso.certificate")}
                    value={cert}
                    onChange={(event) => setCert(event.target.value)}
                  />
                </>
              )}
              <p className="text-xs text-muted-foreground">
                {t("org.sso.domainHelp")}
              </p>
              {createSso.error ? <ErrorText error={createSso.error} /> : null}
              <div className="flex gap-2">
                <ToolkitButton
                  type="submit"
                  size="sm"
                  disabled={createSso.isPending || !org.allowedDomain}
                >
                  {t("org.sso.saveProvider")}
                </ToolkitButton>
                <ToolkitButton
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowProviderForm(false);
                    setClientSecret("");
                    setMetadata("");
                    setCert("");
                  }}
                >
                  {t("org.sso.cancel")}
                </ToolkitButton>
              </div>
            </form>
          ) : (
            <ToolkitButton
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setShowProviderForm(true)}
            >
              {t("org.sso.addProvider")}
            </ToolkitButton>
          )}
        </SettingsRow>
      )}

      {scimEnabled && (
        <SettingsRow
          id="organization-scim"
          label={t("org.scim.title")}
          description={t("org.scim.description")}
        >
          {scimQuery.error ? <ErrorText error={scimQuery.error} /> : null}
          {scimQuery.data?.connections.map((connection) => (
            <div
              key={connection.connectionId}
              className="flex items-center justify-between gap-2 border-b py-2 text-sm last:border-0"
            >
              <span>{connection.status}</span>
              <ToolkitButton
                size="sm"
                variant="ghost"
                disabled={deleteScim.isPending}
                onClick={() => deleteScim.mutate(connection.connectionId)}
              >
                {t("org.scim.revoke")}
              </ToolkitButton>
            </div>
          ))}
          {deleteScim.error ? <ErrorText error={deleteScim.error} /> : null}
          {oneTimeScimToken ? (
            <div className="grid gap-2 rounded-md border p-3 text-sm">
              <p>{t("org.scim.copyTokenOnce")}</p>
              <code className="break-all">{oneTimeScimToken}</code>
              <code className="break-all">{scimQuery.data?.endpoint}</code>
              <ToolkitButton
                size="sm"
                variant="outline"
                onClick={() => setOneTimeScimToken(null)}
              >
                {t("org.scim.dismissToken")}
              </ToolkitButton>
            </div>
          ) : (
            <ToolkitButton
              size="sm"
              variant="outline"
              disabled={createScim.isPending}
              onClick={() =>
                createScim.mutate(undefined, {
                  onSuccess: (result) => setOneTimeScimToken(result.token),
                })
              }
            >
              {t("org.scim.createConnection")}
            </ToolkitButton>
          )}
          {createScim.error ? <ErrorText error={createScim.error} /> : null}
        </SettingsRow>
      )}
      <AlertDialog
        open={pendingAuthProvider !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAuthProvider(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("org.ssoConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("org.ssoConfirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={setAuthProvider.isPending}>
              {t("org.sso.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={setAuthProvider.isPending}
              onClick={() => {
                if (!pendingAuthProvider) return;
                setAuthProvider.mutate(pendingAuthProvider, {
                  onSuccess: () => setPendingAuthProvider(null),
                });
              }}
            >
              {t("org.ssoConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
