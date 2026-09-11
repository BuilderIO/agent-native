import { useSendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrgRole } from "@agent-native/core/client/org";
import {
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type AuthType = "none" | "bearer" | "basic" | "api-key-header";
type TestResult = {
  ok?: boolean;
  status?: number;
  error?: string;
  rowCount?: number;
  columns?: string[];
  sampleRows?: unknown[];
};

type ActionMutationName = Parameters<typeof useActionMutation>[0];

const mutationName = (name: string): ActionMutationName => name;

export function CustomApiCard() {
  const t = useT();
  const { canManageOrg, org } = useOrgRole();
  const scope = org?.orgId && canManageOrg ? "org" : "user";
  const { send, isGenerating, codeRequiredDialog } = useSendToAgentChat();
  const register = useActionMutation(mutationName("provider-api-register"));
  const test = useActionMutation(mutationName("test-custom-api-connection"));
  const [open, setOpen] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [registeredProviderId, setRegisteredProviderId] = useState<
    string | null
  >(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authType, setAuthType] = useState<AuthType>("none");
  const [values, setValues] = useState({
    label: "",
    baseUrl: "",
    path: "",
    query: "",
    itemsPath: "",
    credentialKey: "",
    usernameKey: "",
    passwordKey: "",
    headerName: "",
    docsUrl: "",
  });
  function resetConnectionState() {
    setRegistered(false);
    setRegisteredProviderId(null);
    setResult(null);
  }
  const set =
    (key: keyof typeof values) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValues((current) => ({ ...current, [key]: event.target.value }));
      setError(null);
      if (key === "path" || key === "query" || key === "itemsPath") {
        setResult(null);
      } else {
        resetConnectionState();
      }
    };
  const parsedQuery = useMemo(() => {
    if (!values.query.trim()) return undefined;
    try {
      const value: unknown = JSON.parse(values.query);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      return value as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [values.query]);

  function providerId(label: string): string {
    return (
      label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64) || "custom-api"
    );
  }

  function auth() {
    if (authType === "none") return { type: "none" as const };
    if (authType === "basic")
      return {
        type: "basic" as const,
        usernameKey: values.usernameKey.trim(),
        passwordKey: values.passwordKey.trim(),
      };
    if (authType === "api-key-header")
      return {
        type: "api-key-header" as const,
        credentialKey: values.credentialKey.trim(),
        headerName: values.headerName.trim(),
      };
    return {
      type: "bearer" as const,
      credentialKey: values.credentialKey.trim(),
    };
  }

  async function handleRegister() {
    setError(null);
    const id = providerId(values.label);
    try {
      await register.mutateAsync({
        operation: "upsert",
        scope,
        id,
        label: values.label.trim(),
        baseUrl: values.baseUrl.trim(),
        auth: auth(),
        docsUrls: values.docsUrl.trim() ? [values.docsUrl.trim()] : undefined,
      });
      setRegistered(true);
      setRegisteredProviderId(id);
      setResult(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("dataSources.customApi.registerError"),
      );
    }
  }

  async function handleTest() {
    setError(null);
    if (parsedQuery === null) {
      setError(t("dataSources.customApi.invalidQuery"));
      return;
    }
    const provider = registeredProviderId ?? providerId(values.label);
    try {
      const response = await test.mutateAsync({
        provider,
        path: values.path.trim(),
        query: parsedQuery,
        itemsPath: values.itemsPath.trim() || undefined,
      });
      const nextResult = response as TestResult;
      setResult(nextResult);
      if (!nextResult.ok) {
        setError(nextResult.error || t("dataSources.customApi.testError"));
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("dataSources.customApi.testError"),
      );
    }
  }

  function saveAsProgram() {
    const details = {
      provider: registeredProviderId ?? providerId(values.label),
      path: values.path.trim(),
      itemsPath: values.itemsPath.trim() || undefined,
      query: parsedQuery,
    };
    send({
      submit: true,
      openSidebar: true,
      message: `${t("dataSources.customApi.agentPrompt")}\n\n${JSON.stringify(details)}`,
      context:
        "The endpoint above passed a bounded read-only GET test. Save it as a manual-refresh Analytics Data Program using providerFetch and emit(rows, schema). Do not ask for or include raw credential values; the provider registration already references the user's scoped secret key.",
    });
  }

  const needsKey = authType !== "none";
  const credentialLink =
    values.credentialKey.trim() ||
    (authType === "basic" ? values.usernameKey.trim() : "");
  return (
    <Card>
      <CardHeader className="p-0">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 p-6 text-left"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <div>
            <CardTitle>{t("dataSources.customApi.title")}</CardTitle>
            <CardDescription>
              {t("dataSources.customApi.description")}
            </CardDescription>
          </div>
          {open ? (
            <IconChevronUp aria-hidden="true" />
          ) : (
            <IconChevronDown aria-hidden="true" />
          )}
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {(["label", "baseUrl", "path"] as const).map((key) => (
              <div className="space-y-2" key={key}>
                <Label htmlFor={`custom-api-${key}`}>
                  {t(`dataSources.customApi.fields.${key}`)}
                </Label>
                <Input
                  id={`custom-api-${key}`}
                  value={values[key]}
                  onChange={set(key)}
                  placeholder={t(`dataSources.customApi.placeholders.${key}`)}
                  type={key === "baseUrl" ? "url" : "text"}
                />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-api-query">
              {t("dataSources.customApi.fields.query")}
            </Label>
            <Textarea
              id="custom-api-query"
              value={values.query}
              onChange={set("query")}
              placeholder={t("dataSources.customApi.placeholders.query")}
              rows={3}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="custom-api-items-path">
                {t("dataSources.customApi.fields.itemsPath")}
              </Label>
              <Input
                id="custom-api-items-path"
                value={values.itemsPath}
                onChange={set("itemsPath")}
                placeholder={t("dataSources.customApi.placeholders.itemsPath")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-api-docs">
                {t("dataSources.customApi.fields.docsUrl")}
              </Label>
              <Input
                id="custom-api-docs"
                type="url"
                value={values.docsUrl}
                onChange={set("docsUrl")}
                placeholder={t("dataSources.customApi.placeholders.docsUrl")}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-api-auth">
              {t("dataSources.customApi.fields.authType")}
            </Label>
            <Select
              value={authType}
              onValueChange={(value) => {
                setAuthType(value as AuthType);
                setError(null);
                resetConnectionState();
              }}
            >
              <SelectTrigger id="custom-api-auth">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  {t("dataSources.customApi.authNone")}
                </SelectItem>
                <SelectItem value="bearer">
                  {t("dataSources.customApi.authBearer")}
                </SelectItem>
                <SelectItem value="basic">
                  {t("dataSources.customApi.authBasic")}
                </SelectItem>
                <SelectItem value="api-key-header">
                  {t("dataSources.customApi.authApiKey")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {needsKey && (
            <div className="grid gap-4 sm:grid-cols-2">
              {authType === "basic" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="custom-api-username-key">
                      {t("dataSources.customApi.fields.usernameKey")}
                    </Label>
                    <Input
                      id="custom-api-username-key"
                      value={values.usernameKey}
                      onChange={set("usernameKey")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="custom-api-password-key">
                      {t("dataSources.customApi.fields.passwordKey")}
                    </Label>
                    <Input
                      id="custom-api-password-key"
                      value={values.passwordKey}
                      onChange={set("passwordKey")}
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="custom-api-credential-key">
                    {t("dataSources.customApi.fields.credentialKey")}
                  </Label>
                  <Input
                    id="custom-api-credential-key"
                    value={values.credentialKey}
                    onChange={set("credentialKey")}
                  />
                </div>
              )}
              {authType === "api-key-header" && (
                <div className="space-y-2">
                  <Label htmlFor="custom-api-header-name">
                    {t("dataSources.customApi.fields.headerName")}
                  </Label>
                  <Input
                    id="custom-api-header-name"
                    value={values.headerName}
                    onChange={set("headerName")}
                  />
                </div>
              )}
            </div>
          )}
          {needsKey && credentialLink && (
            <p className="text-sm text-muted-foreground">
              {t("dataSources.customApi.keyHint")}{" "}
              <a
                className="inline-flex items-center gap-1 underline"
                href={`/settings/integrations/secrets/${encodeURIComponent(credentialLink)}`}
              >
                {credentialLink}
                <IconExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleRegister}
              disabled={register.isPending || !values.label || !values.baseUrl}
            >
              {t("dataSources.customApi.register")}
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={!registered || test.isPending || !values.path}
            >
              {t("dataSources.customApi.test")}
            </Button>
          </div>
          {result && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Badge>
                  {t("dataSources.customApi.connectionResult")}:{" "}
                  {result.status ?? t("dataSources.customApi.unknown")}
                </Badge>
                <Badge>
                  {t("dataSources.customApi.rowCount")}:{" "}
                  {result.rowCount ?? result.sampleRows?.length ?? 0}
                </Badge>
              </div>
              {result.columns?.length ? (
                <p className="text-sm text-muted-foreground">
                  {t("dataSources.customApi.columns")}:{" "}
                  {result.columns.join(", ")}
                </p>
              ) : null}
              <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify((result.sampleRows ?? []).slice(0, 5), null, 2)}
              </pre>
              {result.ok && (
                <Button onClick={saveAsProgram} disabled={isGenerating}>
                  {t("dataSources.customApi.handoffButton")}
                </Button>
              )}
            </div>
          )}
          {codeRequiredDialog}
        </CardContent>
      )}
    </Card>
  );
}
