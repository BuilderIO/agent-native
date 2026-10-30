import { IconTerminal2 } from "@tabler/icons-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  apiRequestOperations,
  apiRequestProblems,
  apiRequestShape,
  authenticationOf,
  isPlainBinding,
  pathOfUrl,
  splitQueryFromPath,
  withAuthentication,
  withSplitPath,
  type ApiRequestArgs,
  type ApiRequestAuth,
  type SplitPath,
} from "@/lib/workflow-editor/api-request";

import {
  connectionRows,
  type ConnectionRow,
} from "../../../factory/connection-rows";
import { ConnectProviderButton } from "../../../factory/ConnectProviderButton";
import { ReadinessChip } from "../../../factory/ReadinessChip";
import { useProviderConnections } from "../../../factory/use-provider-connections";
import { curlProvidersOf } from "../../../workflow/api-provider-catalog";
import { useProviderApiCatalog } from "../../../workflow/use-provider-api-catalog";
import { providerName } from "../../node-kinds";
import { useWorkflowCanvasStrings } from "../../strings";
import { BindingField } from "../BindingField";
import { Field, TextInput } from "../fields";
import { useQuietMarks } from "../issue-marks";
import { argsForOperation } from "../OperationFields";
import { OptionsSection, ParamsSection } from "./ApiRequestParams";
import { ImportCurlDialog } from "./ImportCurlDialog";
import type { FormProps } from "./types";
import { withOptional } from "./types";

/** The provider's connection state, with the one control that fixes it. */
function ConnectionState({ provider }: { provider: string }) {
  const connections = useProviderConnections();
  if (connections.isPending) return <Skeleton className="h-6 w-28" />;
  const row: ConnectionRow | undefined = connectionRows(
    [provider],
    connections.data?.providers ?? [],
  ).find((entry) => entry.provider === provider);
  if (!row) return null;
  return (
    <div className="flex items-center gap-2">
      <ReadinessChip readiness={row.readiness} word={row.word} />
      {row.word !== "connected" ? (
        <ConnectProviderButton
          provider={row.provider}
          connectWith={row.connectWith}
          readiness={row.readiness}
          onConnected={() => void connections.refetch()}
        />
      ) : null}
    </div>
  );
}

/**
 * The form of the API request step: a GET to a path on a connected provider.
 * Everything it writes is a field of the operation the catalog declares, so the
 * agent and the engine read exactly what this form saves.
 */
export function ApiRequestForm({
  settings,
  onChange,
  context,
}: FormProps<"lookup">) {
  const strings = useWorkflowCanvasStrings();
  const a = strings.inspector.apiRequest;
  const id = useId();
  const quiet = useQuietMarks();
  const [importOpen, setImportOpen] = useState(false);
  const apiCatalog = useProviderApiCatalog();

  const def = context.catalog.get(settings.operation);
  const shape = apiRequestShape(def);
  const providers = useMemo(
    () => apiRequestOperations(context.catalog),
    [context.catalog],
  );
  const curlProviders = useMemo(
    () =>
      apiCatalog.data
        ? curlProvidersOf(
            apiCatalog.data.providers,
            providers.map((operation) => operation.provider),
          )
        : undefined,
    [apiCatalog.data, providers],
  );
  if (!def || !shape) return null;

  const args = settings.args;
  const setArgs = (next: ApiRequestArgs) =>
    onChange({ ...settings, args: next });
  const section = { def, shape, args, onArgs: setArgs, context };
  const pathField = def.fields.find(
    (field) => field.name === shape.fields.path,
  );
  const authName = shape.fields.auth;
  const authField = def.fields.find((field) => field.name === authName);
  const pathBinding =
    shape.fields.path in args ? args[shape.fields.path] : undefined;
  const pathProblem = quiet
    ? undefined
    : apiRequestProblems(shape, args).find((entry) => entry.field === "path");
  const baseUrl = apiCatalog.data?.providers.find(
    (entry) => entry.id === def.provider,
  )?.defaultBaseUrl;

  const applySplit = (split: SplitPath | undefined) => {
    if (!split) return;
    setArgs(withSplitPath(shape, args, split));
    if (split.dropped.length > 0) {
      toast.info(a.problem.droppedCredentials(split.dropped.join(", ")));
    }
  };
  const pathText =
    pathBinding?.mode === "fixed" && typeof pathBinding.value === "string"
      ? pathBinding.value
      : "";
  let pathFix: { label: string; split: SplitPath | undefined } | undefined;
  if (pathProblem?.code === "full_url_refused") {
    pathFix = {
      label: a.problem.useOnlyPath,
      split: pathOfUrl(pathText, baseUrl),
    };
  } else if (
    pathProblem?.code === "unsafe_path_value" &&
    pathProblem.reason === "query"
  ) {
    pathFix = {
      label: a.problem.moveToParameters,
      split: splitQueryFromPath(pathText),
    };
  }
  const authLabel = (auth: ApiRequestAuth) =>
    auth === "none" ? a.authNone : a.authProvider;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setImportOpen(true)}
        >
          <IconTerminal2 />
          {a.importCurl}
        </Button>
      </div>

      <Field label={a.method} htmlFor={`${id}-method`}>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A disabled control takes no hover, so the span carries the tooltip. */}
            <span tabIndex={0} className="block rounded-md">
              <Select value="GET" disabled>
                <SelectTrigger id={`${id}-method`} size="sm">
                  <SelectValue>GET</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                </SelectContent>
              </Select>
            </span>
          </TooltipTrigger>
          <TooltipContent>{a.methodReadOnly}</TooltipContent>
        </Tooltip>
      </Field>

      <Field label={a.provider} htmlFor={`${id}-provider`}>
        <Select
          value={def.provider}
          onValueChange={(provider) => {
            const next = providers.find(
              (operation) => operation.provider === provider,
            );
            if (!next) return;
            onChange({
              ...settings,
              operation: next.id,
              args: argsForOperation(next, args),
            });
          }}
        >
          <SelectTrigger id={`${id}-provider`} size="sm">
            <SelectValue>{providerName(def.provider)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {providers.map((operation) => (
              <SelectItem key={operation.provider} value={operation.provider}>
                {providerName(operation.provider)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ConnectionState provider={def.provider} />
      </Field>

      {pathField ? (
        <div data-autofocus-field className="flex flex-col gap-1.5">
          <BindingField
            field={pathField}
            label={a.path}
            binding={pathBinding}
            context={context}
            modes={["fixed", "path"]}
            placeholder={a.pathPlaceholder}
            onChange={(binding) => {
              if (binding) setArgs({ ...args, [shape.fields.path]: binding });
              else {
                const { [shape.fields.path]: _removed, ...rest } = args;
                setArgs(rest);
              }
            }}
          />
          {pathProblem ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p role="alert" className="text-xs text-destructive">
                {a.problem.sentence(pathProblem)}
              </p>
              {pathFix?.split ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => applySplit(pathFix.split)}
                >
                  {pathFix.label}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {authName !== undefined && authField ? (
        isPlainBinding(args, authName) ? (
          <Field label={a.authentication} htmlFor={`${id}-auth`}>
            <Select
              value={authenticationOf(shape, args)}
              onValueChange={(auth) =>
                setArgs(withAuthentication(shape, args, auth as ApiRequestAuth))
              }
            >
              <SelectTrigger id={`${id}-auth`} size="sm">
                <SelectValue>
                  {authLabel(authenticationOf(shape, args))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(["provider", "none"] as const).map((auth) => (
                  <SelectItem key={auth} value={auth}>
                    <span className="flex flex-col">
                      <span>{authLabel(auth)}</span>
                      <span className="text-xs text-muted-foreground">
                        {auth === "none" ? a.authNoneHint : a.authProviderHint}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <BindingField
            field={authField}
            label={a.authentication}
            binding={args[authName]}
            context={context}
            onChange={(binding) => {
              if (binding) setArgs({ ...args, [authName]: binding });
              else setArgs(withAuthentication(shape, args, "provider"));
            }}
          />
        )
      ) : null}

      <ParamsSection kind="query" {...section} />
      <ParamsSection kind="headers" {...section} />
      <OptionsSection {...section} />

      <Field label={strings.inspector.resultName} htmlFor={`${id}-into`}>
        <TextInput
          id={`${id}-into`}
          value={settings.into ?? ""}
          placeholder={context.node.name}
          onChange={(into) => onChange(withOptional(settings, "into", into))}
        />
      </Field>

      <p className="rounded-md border-s-2 border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {a.notice}
      </p>

      <ImportCurlDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        catalog={context.catalog}
        providers={curlProviders}
        providersFailed={apiCatalog.isError}
        onRetryProviders={() => void apiCatalog.refetch()}
        onImport={({ operation, args: imported }) =>
          onChange({ ...settings, operation, args: imported })
        }
      />
    </div>
  );
}
