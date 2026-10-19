import { agentNativePath, appPath } from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useActionQuery,
  useAvatarUrl,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrgRole } from "@agent-native/core/client/org";
import {
  SIGMA_API_BASE_URLS,
  SIGMA_DEFAULT_API_BASE_URL,
} from "@agent-native/core/connections/sigma-api";
import { useOrgSwitcherAppLinks } from "@agent-native/toolkit/app/org/workspace-app-links";
import { saveApiKeyValue } from "@agent-native/toolkit/app/settings/api-keys/api-keys-client";
import {
  IconAlertCircle,
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Connection = {
  id: string;
  label: string;
  status: string;
};

type SigmaWorkbook = {
  id: string;
  name: string;
  isArchived?: boolean;
  path?: string;
  updatedAt?: string;
  status: "not_started" | "migrating" | "migrated" | "failed";
  dashboardId?: string | null;
  dashboardName?: string;
  dashboardUrl?: string;
  canOpen?: boolean;
  migratedOwnerEmail?: string;
  migratedOwnerName?: string | null;
  migratingByEmail?: string;
  migratingByName?: string | null;
  canRecoverMissingDashboard?: boolean;
  canRetryStaleClaim?: boolean;
  canStartImport: boolean;
  flaggedCount?: number;
  migratedByTeammate?: boolean;
};

type SigmaWorkbookListResult = {
  connected: boolean;
  connectionId?: string;
  connectionLabel?: string;
  connections: Connection[];
  requiresConnectionSelection: boolean;
  workbooks: SigmaWorkbook[];
  setupUrl?: string;
  nextPage?: string | null;
  total?: number;
};

type LoadedWorkbookPage = { cursor?: string; workbooks: SigmaWorkbook[] };
type SigmaConnectionSaveResult = {
  connectionId: string;
  status: string;
  cleanupPending: boolean;
};
type SigmaConnectionSaveArgs =
  | { operation: "discard"; setupId: string }
  | { operation: "verify"; setupId: string; useDefaultBaseUrl: boolean };

function sigmaSetupKey(
  setupId: string,
  key: "CLIENT_ID" | "CLIENT_SECRET" | "BASE_URL",
) {
  return `ANALYTICS_SIGMA_SETUP_${setupId}_${key}`;
}

const EMPTY_CONNECTIONS: Connection[] = [];
const EMPTY_WORKBOOKS: SigmaWorkbook[] = [];

export function SigmaMigrationDialog({
  open,
  onOpenChange,
  preferredConnectionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preferredConnectionId?: string | null;
}) {
  const t = useT();
  const { canManageOrg } = useOrgRole();
  const { dispatchHref, dispatchVaultHref } = useOrgSwitcherAppLinks(open);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [sigmaApiBaseUrl, setSigmaApiBaseUrl] = useState(
    SIGMA_DEFAULT_API_BASE_URL,
  );
  const [showSigmaOAuthSetup, setShowSigmaOAuthSetup] = useState(false);
  const [search, setSearch] = useState("");
  const [pageCursor, setPageCursor] = useState<string | undefined>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loadedPages, setLoadedPages] = useState<{
    connectionId: string | null;
    pages: LoadedWorkbookPage[];
  }>({ connectionId: null, pages: [] });
  const [lastSuccessfulList, setLastSuccessfulList] = useState<{
    connectionId: string | null;
    result: SigmaWorkbookListResult;
  } | null>(null);
  const activePageCursor =
    loadedPages.connectionId === connectionId ? pageCursor : undefined;

  const workbookList = useActionQuery<
    SigmaWorkbookListResult,
    "list-sigma-workbooks"
  >(
    "list-sigma-workbooks",
    connectionId
      ? {
          connectionId,
          ...(activePageCursor ? { page: activePageCursor } : {}),
        }
      : undefined,
    {
      enabled: open,
      staleTime: 15_000,
      queryKeyScope: [refreshVersion],
      placeholderData: (previous) => previous,
    },
  );
  const listData = workbookList.data;
  const listResultIsValid = listData ? isWorkbookListResult(listData) : false;
  const listHasError =
    workbookList.isError || Boolean(listData && !listResultIsValid);
  const connectionPolicyInvalid =
    actionErrorCode(workbookList.error) === "sigma_connection_policy_invalid";
  const directCredentialsUnavailable =
    actionErrorCode(workbookList.error) ===
    "sigma_direct_credentials_unavailable";
  const isLoadingList =
    workbookList.isPending ||
    (workbookList.isFetching && workbookList.isPlaceholderData);
  useEffect(() => {
    if (
      !listData ||
      !listResultIsValid ||
      workbookList.isError ||
      workbookList.isPlaceholderData
    ) {
      return;
    }
    setLastSuccessfulList({
      connectionId: listData.connectionId ?? null,
      result: listData,
    });
  }, [
    listData,
    listResultIsValid,
    workbookList.isError,
    workbookList.isPlaceholderData,
  ]);
  const listStateForCurrentConnection =
    listData &&
    listResultIsValid &&
    !workbookList.isError &&
    !workbookList.isPlaceholderData
      ? listData
      : lastSuccessfulList?.connectionId === connectionId
        ? lastSuccessfulList.result
        : undefined;
  const connections =
    listStateForCurrentConnection?.connections ?? EMPTY_CONNECTIONS;
  const connectedConnections = useMemo(
    () => connections.filter((connection) => connection.status === "connected"),
    [connections],
  );

  useEffect(() => {
    if (preferredConnectionId) setConnectionId(preferredConnectionId);
  }, [preferredConnectionId]);

  useEffect(() => {
    if (
      !listData ||
      !listResultIsValid ||
      workbookList.isError ||
      workbookList.isPlaceholderData
    ) {
      return;
    }
    setConnectionId((current) => {
      if (current && connectedConnections.some((item) => item.id === current)) {
        return current;
      }
      return connectedConnections.length === 1
        ? connectedConnections[0].id
        : null;
    });
  }, [
    connectedConnections,
    listData,
    listResultIsValid,
    workbookList.isError,
    workbookList.isPlaceholderData,
  ]);

  useEffect(() => {
    setPageCursor(undefined);
    setSearch("");
    setLoadedPages({ connectionId, pages: [] });
  }, [connectionId]);

  useEffect(() => {
    if (
      !connectionId ||
      workbookList.isPending ||
      workbookList.isFetching ||
      workbookList.isPlaceholderData ||
      !listResultIsValid ||
      listData?.connectionId !== connectionId ||
      !Array.isArray(listData.workbooks)
    ) {
      return;
    }
    setLoadedPages((current) => {
      const pages = current.connectionId === connectionId ? current.pages : [];
      const pageIndex = pages.findIndex(
        (page) => page.cursor === activePageCursor,
      );
      if (pageIndex === -1) {
        return {
          connectionId,
          pages: [
            ...pages,
            { cursor: activePageCursor, workbooks: listData.workbooks },
          ],
        };
      }
      const nextPages = [...pages];
      nextPages[pageIndex] = {
        cursor: activePageCursor,
        workbooks: listData.workbooks,
      };
      return { connectionId, pages: nextPages };
    });
  }, [
    activePageCursor,
    connectionId,
    listData,
    listResultIsValid,
    workbookList.isFetching,
    workbookList.isPlaceholderData,
    workbookList.isPending,
  ]);

  const workbooks = useMemo(() => {
    if (loadedPages.connectionId !== connectionId) return EMPTY_WORKBOOKS;
    const merged = new Map<string, SigmaWorkbook>();
    for (const page of loadedPages.pages) {
      for (const workbook of page.workbooks) merged.set(workbook.id, workbook);
    }
    return [...merged.values()];
  }, [connectionId, loadedPages]);
  const visibleWorkbooks = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return workbooks;
    return workbooks.filter((workbook) =>
      workbook.name.toLowerCase().includes(query),
    );
  }, [search, workbooks]);
  const saveSigmaConnection = useActionMutation<
    SigmaConnectionSaveResult,
    SigmaConnectionSaveArgs,
    "save-sigma-connection"
  >("save-sigma-connection");
  const [sigmaClientId, setSigmaClientId] = useState("");
  const [sigmaClientSecret, setSigmaClientSecret] = useState("");
  const [sigmaBaseUrl, setSigmaBaseUrl] = useState("");
  const [sigmaSetupError, setSigmaSetupError] = useState<string | null>(null);
  const [savingSigmaCredentials, setSavingSigmaCredentials] = useState(false);
  const [sigmaCleanupPending, setSigmaCleanupPending] = useState(false);
  const [sigmaCleanupError, setSigmaCleanupError] = useState<string | null>(
    null,
  );
  const [savingSigmaCleanup, setSavingSigmaCleanup] = useState(false);
  const sigmaSetupId = useRef<string | null>(null);

  const connected = Boolean(
    listStateForCurrentConnection?.connected &&
    connectionId &&
    listStateForCurrentConnection.connectionId === connectionId &&
    connectedConnections.some((item) => item.id === connectionId),
  );
  const showConnectionPicker = connectedConnections.length > 1;
  const needsConnectionSelection = showConnectionPicker && !connectionId;
  const handleConnectionChange = (value: string) => {
    setConnectionId(value || null);
    setPageCursor(undefined);
  };

  const startPersonalSigmaOAuth = () => {
    const params = new URLSearchParams({
      scope: "user",
      return: "/dashboards?openSigma=1",
      baseUrl: sigmaApiBaseUrl,
    });
    window.location.assign(
      agentNativePath(
        `/_agent-native/connections/oauth/sigma/start?${params.toString()}`,
      ),
    );
  };

  const handleSigmaConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSigmaSetupError(null);
    setSavingSigmaCredentials(true);
    setSigmaCleanupError(null);
    const setupId = sigmaSetupId.current ?? crypto.randomUUID();
    sigmaSetupId.current = setupId;
    setSigmaCleanupPending(false);
    let setupPhase: "credentials" | "connection" = "credentials";
    try {
      await saveApiKeyValue({
        name: sigmaSetupKey(setupId, "CLIENT_ID"),
        value: sigmaClientId.trim(),
        registered: false,
        shared: true,
      });
      await saveApiKeyValue({
        name: sigmaSetupKey(setupId, "CLIENT_SECRET"),
        value: sigmaClientSecret,
        registered: false,
        shared: true,
      });
      if (sigmaBaseUrl.trim()) {
        await saveApiKeyValue({
          name: sigmaSetupKey(setupId, "BASE_URL"),
          value: sigmaBaseUrl.trim(),
          registered: false,
          shared: true,
        });
      }
      setupPhase = "connection";
      const result = await saveSigmaConnection.mutateAsync({
        operation: "verify",
        setupId,
        useDefaultBaseUrl: !sigmaBaseUrl.trim(),
      });
      if (
        !isSigmaConnectionSaveResult(result) ||
        result.status !== "connected"
      ) {
        setSigmaSetupError(t("dashboardOverview.sigmaConnectFailed"));
        setSigmaCleanupPending(true);
        return;
      }
      if (!result.cleanupPending) sigmaSetupId.current = null;
      setSigmaCleanupPending(result.cleanupPending);
      setSigmaClientId("");
      setSigmaClientSecret("");
      setSigmaBaseUrl("");
      setRefreshVersion((current) => current + 1);
    } catch (error) {
      const code = actionErrorCode(error);
      switch (code) {
        case "sigma_credentials_required":
          setSigmaSetupError(t("dashboardOverview.sigmaCredentialsRequired"));
          break;
        case "sigma_base_url_invalid":
          setSigmaSetupError(t("dashboardOverview.sigmaBaseUrlInvalid"));
          break;
        case "sigma_connection_transactions_unavailable":
          setSigmaSetupError(
            t("dashboardOverview.sigmaPersistenceUnavailable"),
          );
          break;
        case "sigma_connection_policy_invalid":
          setSigmaSetupError(t("dashboardOverview.sigmaPolicyInvalid"));
          break;
        case "sigma_connection_save_failed":
          setSigmaSetupError(t("dashboardOverview.sigmaSaveFailed"));
          break;
        default:
          setSigmaSetupError(
            setupPhase === "credentials"
              ? t("dashboardOverview.sigmaCredentialStageFailed")
              : t("dashboardOverview.sigmaConnectFailed"),
          );
      }
      setSigmaCleanupPending(true);
    } finally {
      setSavingSigmaCredentials(false);
    }
  };

  const cleanupSigmaSetupCredentials = async (): Promise<boolean> => {
    const setupId = sigmaSetupId.current;
    if (!setupId) {
      setSigmaCleanupPending(false);
      setSigmaCleanupError(null);
      return true;
    }
    setSavingSigmaCleanup(true);
    setSigmaCleanupError(null);
    try {
      const result = await saveSigmaConnection.mutateAsync({
        operation: "discard",
        setupId,
      });
      if (
        !isSigmaConnectionSaveResult(result) ||
        result.status !== "discarded" ||
        result.cleanupPending
      ) {
        throw new Error("Sigma setup cleanup did not complete.");
      }
      sigmaSetupId.current = null;
      setSigmaCleanupPending(false);
      return true;
    } catch {
      setSigmaCleanupPending(true);
      setSigmaCleanupError(t("dashboardOverview.sigmaCleanupFailed"));
      return false;
    } finally {
      setSavingSigmaCleanup(false);
    }
  };

  const handleDialogOpenChange = async (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (
      savingSigmaCredentials ||
      saveSigmaConnection.isPending ||
      savingSigmaCleanup
    ) {
      return;
    }
    if (!(await cleanupSigmaSetupCredentials())) return;
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) return;
    setSigmaClientId("");
    setSigmaClientSecret("");
    setSigmaBaseUrl("");
    setSigmaSetupError(null);
    setSigmaCleanupPending(false);
    setSigmaCleanupError(null);
  }, [open]);

  const hasMoreWorkbooks =
    !listHasError &&
    listData?.connectionId === connectionId &&
    Boolean(listData.nextPage);
  const chooseConnectionButton = connectionId ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => handleConnectionChange("")}
    >
      {t("dashboardOverview.sigmaChooseConnectionPlaceholder")}
    </Button>
  ) : null;
  const loadMoreButton = hasMoreWorkbooks ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setPageCursor(listData.nextPage ?? undefined)}
      disabled={workbookList.isFetching}
    >
      {workbookList.isFetching ? (
        <IconLoader2 className="animate-spin" />
      ) : null}
      {workbookList.isFetching
        ? t("dashboardOverview.sigmaLoadingMore")
        : t("dashboardOverview.sigmaLoadMore")}
    </Button>
  ) : null;
  const sigmaOAuthForm = (
    <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-sm text-muted-foreground">
        {t("dashboardOverview.sigmaOAuthDescription")}
      </p>
      <div className="space-y-2">
        <Label htmlFor="sigma-api-region">
          {t("dashboardOverview.sigmaApiRegion")}
        </Label>
        <Select value={sigmaApiBaseUrl} onValueChange={setSigmaApiBaseUrl}>
          <SelectTrigger id="sigma-api-region">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SIGMA_API_BASE_URLS.map((baseUrl) => (
              <SelectItem key={baseUrl} value={baseUrl}>
                {baseUrl}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        className="w-full"
        type="button"
        onClick={startPersonalSigmaOAuth}
      >
        {t("dashboardOverview.sigmaOAuthConnect")}
      </Button>
    </div>
  );
  const sigmaCredentialForm = canManageOrg ? (
    <form className="space-y-3" onSubmit={handleSigmaConnect}>
      <div className="space-y-2">
        <Label htmlFor="sigma-client-id">
          {t("dashboardOverview.sigmaClientId")}
        </Label>
        <Input
          id="sigma-client-id"
          autoComplete="off"
          required
          value={sigmaClientId}
          onChange={(event) => setSigmaClientId(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sigma-client-secret">
          {t("dashboardOverview.sigmaClientSecret")}
        </Label>
        <Input
          id="sigma-client-secret"
          type="password"
          autoComplete="new-password"
          required
          value={sigmaClientSecret}
          onChange={(event) => setSigmaClientSecret(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sigma-base-url">
          {t("dashboardOverview.sigmaBaseUrl")}
        </Label>
        <Input
          id="sigma-base-url"
          type="url"
          autoComplete="url"
          placeholder={t("dashboardOverview.sigmaBaseUrlPlaceholder")}
          value={sigmaBaseUrl}
          onChange={(event) => setSigmaBaseUrl(event.currentTarget.value)}
        />
      </div>
      {sigmaSetupError ? (
        <p className="text-sm text-destructive" role="alert">
          {sigmaSetupError}
        </p>
      ) : null}
      <Button
        className="w-full"
        type="submit"
        disabled={savingSigmaCredentials || saveSigmaConnection.isPending}
      >
        {savingSigmaCredentials || saveSigmaConnection.isPending ? (
          <IconLoader2 className="animate-spin" />
        ) : null}
        {savingSigmaCredentials || saveSigmaConnection.isPending
          ? t("dashboardOverview.sigmaConnecting")
          : t("dashboardOverview.sigmaConnect")}
      </Button>
    </form>
  ) : null;
  const sigmaConnectionManagementLinks = (
    <div className="flex flex-wrap gap-2">
      <Button asChild type="button" variant="outline" size="sm">
        <a href={dispatchHref} target="_blank" rel="noreferrer">
          {t("dashboardOverview.sigmaOpenDispatch")}
          <IconExternalLink />
        </a>
      </Button>
      <Button asChild type="button" variant="ghost" size="sm">
        <a href={dispatchVaultHref} target="_blank" rel="noreferrer">
          {t("dashboardOverview.sigmaOpenVault")}
          <IconExternalLink />
        </a>
      </Button>
    </div>
  );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => void handleDialogOpenChange(nextOpen)}
      >
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>{t("dashboardOverview.importFromSigma")}</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6">
            {sigmaCleanupPending ? (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
                role="alert"
              >
                <span>
                  {sigmaCleanupError ??
                    t("dashboardOverview.sigmaCleanupPending")}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void cleanupSigmaSetupCredentials()}
                  disabled={savingSigmaCleanup || savingSigmaCredentials}
                >
                  {savingSigmaCleanup ? (
                    <IconLoader2 className="animate-spin" />
                  ) : null}
                  {t("dashboardOverview.sigmaRetryCleanup")}
                </Button>
              </div>
            ) : null}
            {isLoadingList && workbooks.length === 0 ? (
              <WorkbookListSkeleton />
            ) : listHasError && workbooks.length === 0 ? (
              <StateMessage
                icon={<IconAlertCircle className="size-4" />}
                title={t("dashboardOverview.sigmaWorkbooksLoadFailed")}
                detail={
                  directCredentialsUnavailable
                    ? t("dashboardOverview.sigmaDirectCredentialsUnavailable")
                    : connectionPolicyInvalid
                      ? t("dashboardOverview.sigmaPolicyInvalid")
                      : t("dashboardOverview.sigmaRetryConnection")
                }
                action={
                  <div className="w-full space-y-4">
                    {connectedConnections.length === 0 ? sigmaOAuthForm : null}
                    {directCredentialsUnavailable ? sigmaCredentialForm : null}
                    {directCredentialsUnavailable || connectionPolicyInvalid
                      ? sigmaConnectionManagementLinks
                      : null}
                    <div className="flex flex-wrap gap-2">
                      {chooseConnectionButton}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void workbookList.refetch()}
                      >
                        {t("dashboardOverview.sigmaRetry")}
                      </Button>
                    </div>
                  </div>
                }
              />
            ) : connectedConnections.length === 0 ? (
              <StateMessage
                icon={<IconAlertCircle className="size-4" />}
                title={t("dashboardOverview.sigmaNoConnection")}
                detail={t("dashboardOverview.sigmaNoConnectionDescription")}
                action={
                  <div className="w-full space-y-4">
                    {sigmaOAuthForm}
                    {sigmaCredentialForm}
                    {sigmaConnectionManagementLinks}
                  </div>
                }
              />
            ) : showConnectionPicker ||
              listStateForCurrentConnection?.requiresConnectionSelection ? (
              <div className="space-y-2">
                <Label htmlFor="sigma-connection">
                  {t("dashboardOverview.sigmaChooseConnection")}
                </Label>
                <Select
                  value={connectionId ?? ""}
                  onValueChange={handleConnectionChange}
                >
                  <SelectTrigger id="sigma-connection">
                    <SelectValue
                      placeholder={t(
                        "dashboardOverview.sigmaChooseConnectionPlaceholder",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {connectedConnections.map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!connectionId ? (
                  <p className="text-sm text-muted-foreground">
                    {t("dashboardOverview.sigmaChooseConnectionDescription")}
                  </p>
                ) : null}
              </div>
            ) : connected ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconCheck className="size-4 text-primary" />
                {t("dashboardOverview.sigmaConnectedTo", {
                  name:
                    connectedConnections.find(
                      (connection) => connection.id === connectionId,
                    )?.label ??
                    listStateForCurrentConnection?.connectionLabel ??
                    t("dashboardOverview.sigmaConnection"),
                })}
              </div>
            ) : null}

            {connectedConnections.length > 0 ? (
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSigmaOAuthSetup((current) => !current)}
                >
                  {showSigmaOAuthSetup
                    ? t("dashboardOverview.sigmaOAuthCancel")
                    : t("dashboardOverview.sigmaOAuthAddAnother")}
                </Button>
                {showSigmaOAuthSetup ? sigmaOAuthForm : null}
              </div>
            ) : null}

            {connected &&
            !needsConnectionSelection &&
            (!workbookList.isPending || workbooks.length > 0) ? (
              workbooks.length === 0 && !listHasError ? (
                <div className="space-y-3">
                  {!hasMoreWorkbooks ? (
                    <p className="text-sm text-muted-foreground">
                      {t("dashboardOverview.sigmaNoWorkbooks")}
                    </p>
                  ) : null}
                  {loadMoreButton}
                </div>
              ) : workbooks.length > 0 ? (
                <div className="space-y-3">
                  <div className="relative">
                    <IconSearch
                      aria-hidden="true"
                      className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      type="search"
                      className="ps-8"
                      value={search}
                      onChange={(event) => setSearch(event.currentTarget.value)}
                      placeholder={t("dashboardOverview.sigmaSearchWorkbooks")}
                      aria-label={t("dashboardOverview.sigmaSearchWorkbooks")}
                    />
                  </div>
                  <WorkbookTable
                    workbooks={visibleWorkbooks}
                    emptyMessage={
                      hasMoreWorkbooks
                        ? t(
                            "dashboardOverview.sigmaNoMatchingWorkbooksLoadMore",
                          )
                        : t("dashboardOverview.sigmaNoMatchingWorkbooks")
                    }
                  />

                  {listHasError ? (
                    <StateMessage
                      icon={<IconAlertCircle className="size-4" />}
                      title={t("dashboardOverview.sigmaMoreWorkbooksFailed")}
                      detail={t("dashboardOverview.sigmaRetryConnection")}
                      action={
                        <div className="flex flex-wrap gap-2">
                          {chooseConnectionButton}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setRefreshVersion((current) => current + 1)
                            }
                          >
                            {t("dashboardOverview.sigmaRetry")}
                          </Button>
                        </div>
                      }
                    />
                  ) : null}

                  {loadMoreButton}
                </div>
              ) : null
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StateMessage({
  icon,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-border/60 p-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
        <div className="space-y-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

function WorkbookListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-9 w-full" />
      <div className="space-y-1 rounded-md border border-border/60 p-2">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

function isWorkbookListResult(
  value: unknown,
): value is SigmaWorkbookListResult {
  if (!value || typeof value !== "object") return false;
  const result = value as SigmaWorkbookListResult;
  return (
    typeof result.connected === "boolean" &&
    Array.isArray(result.connections) &&
    result.connections.every(
      (connection) =>
        typeof connection.id === "string" &&
        typeof connection.label === "string" &&
        typeof connection.status === "string",
    ) &&
    typeof result.requiresConnectionSelection === "boolean" &&
    Array.isArray(result.workbooks) &&
    result.workbooks.every(
      (workbook) =>
        typeof workbook.id === "string" &&
        typeof workbook.name === "string" &&
        (workbook.isArchived === undefined ||
          typeof workbook.isArchived === "boolean") &&
        ["not_started", "migrating", "migrated", "failed"].includes(
          workbook.status,
        ) &&
        (workbook.dashboardUrl === undefined ||
          typeof workbook.dashboardUrl === "string") &&
        (workbook.dashboardId === undefined ||
          typeof workbook.dashboardId === "string") &&
        (workbook.dashboardName === undefined ||
          typeof workbook.dashboardName === "string") &&
        (workbook.canRecoverMissingDashboard === undefined ||
          typeof workbook.canRecoverMissingDashboard === "boolean") &&
        (workbook.canRetryStaleClaim === undefined ||
          typeof workbook.canRetryStaleClaim === "boolean") &&
        (workbook.flaggedCount === undefined ||
          (typeof workbook.flaggedCount === "number" &&
            workbook.flaggedCount >= 0)) &&
        (workbook.migratedByTeammate === undefined ||
          typeof workbook.migratedByTeammate === "boolean") &&
        (workbook.canOpen === undefined ||
          typeof workbook.canOpen === "boolean") &&
        (workbook.migratedOwnerEmail === undefined ||
          typeof workbook.migratedOwnerEmail === "string") &&
        (workbook.migratingByEmail === undefined ||
          typeof workbook.migratingByEmail === "string") &&
        isOptionalName(workbook.migratedOwnerName) &&
        isOptionalName(workbook.migratingByName) &&
        typeof workbook.canStartImport === "boolean",
    ) &&
    (result.nextPage === undefined ||
      result.nextPage === null ||
      typeof result.nextPage === "string")
  );
}

function isSigmaConnectionSaveResult(
  value: unknown,
): value is SigmaConnectionSaveResult {
  if (!value || typeof value !== "object") return false;
  const result = value as SigmaConnectionSaveResult;
  return (
    typeof result.connectionId === "string" &&
    typeof result.status === "string" &&
    typeof result.cleanupPending === "boolean"
  );
}

function actionErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const errorCode = (error as { errorCode?: unknown }).errorCode;
  return typeof errorCode === "string" ? errorCode : undefined;
}

function safeDashboardPath(id: string | null) {
  if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) return null;
  return `/dashboards/${encodeURIComponent(id)}`;
}

function isOptionalName(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function WorkbookTable({
  workbooks,
  emptyMessage,
}: {
  workbooks: SigmaWorkbook[];
  emptyMessage: string;
}) {
  const t = useT();
  return (
    <TooltipProvider delayDuration={200}>
      {/* A fixed height keeps the dialog still while the search narrows it. */}
      <div className="h-96 overflow-y-auto rounded-md border border-border/60">
        {workbooks.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{emptyMessage}</p>
        ) : null}
        <Table>
          <TableBody>
            {workbooks.map((workbook) => (
              <WorkbookRow key={workbook.id} workbook={workbook} t={t} />
            ))}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}

function WorkbookRow({
  workbook,
  t,
}: {
  workbook: SigmaWorkbook;
  t: ReturnType<typeof useT>;
}) {
  // Migrate shows only where the server would let this user start an import,
  // or recover their own import whose dashboard is gone.
  const canMigrate =
    workbook.canStartImport || Boolean(workbook.canRecoverMissingDashboard);
  const dashboardPath =
    workbook.status === "migrated" && !canMigrate
      ? safeDashboardPath(workbook.dashboardId ?? null)
      : null;
  const migrating = workbook.status === "migrating" && !canMigrate;
  const migratingBy = migrating ? (workbook.migratingByEmail ?? null) : null;
  const ownerEmail =
    workbook.status === "migrated" && !canMigrate
      ? (workbook.migratedOwnerEmail ?? null)
      : null;
  const muted = !canMigrate;
  return (
    <TableRow
      data-workbook-id={workbook.id}
      data-state={muted ? "taken" : undefined}
    >
      <TableCell>
        <div
          className={
            muted
              ? "flex min-w-0 items-center gap-2 text-muted-foreground"
              : "flex min-w-0 items-center gap-2"
          }
        >
          {dashboardPath ? (
            // A real link, so middle-click and copy work. Opening an imported
            // workbook never starts a second import; the dashboard's own
            // access check decides what the new tab shows.
            <a
              href={appPath(dashboardPath)}
              target="_blank"
              rel="noopener"
              className="inline-flex min-w-0 items-center gap-1.5 hover:underline"
              aria-label={`${workbook.name} — ${t("dashboardOverview.sigmaOpenMigratedDashboard")}`}
            >
              <span className="truncate">{workbook.name}</span>
              <IconExternalLink
                aria-hidden="true"
                className="size-4 shrink-0"
              />
            </a>
          ) : (
            <span className="truncate">{workbook.name}</span>
          )}
          {workbook.isArchived ? (
            <Badge variant="outline">
              {t("dashboardOverview.sigmaArchived")}
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="w-px whitespace-nowrap text-end">
        {ownerEmail ? (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            {t("dashboardOverview.sigmaOwnedBy")}
            <OwnerAvatar
              email={ownerEmail}
              name={workbook.migratedOwnerName ?? null}
              label={ownerLabel(ownerEmail, workbook.migratedOwnerName)}
            />
          </span>
        ) : migrating ? (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
            {migratingBy ? (
              <OwnerAvatar
                email={migratingBy}
                name={workbook.migratingByName ?? null}
                label={t("dashboardOverview.sigmaMigratingTooltip", {
                  name: ownerLabel(migratingBy, workbook.migratingByName),
                })}
              />
            ) : null}
          </span>
        ) : canMigrate ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A disabled button gets no pointer events, so the span carries the hover. */}
              <span className="inline-flex" tabIndex={0}>
                <Button type="button" size="sm" disabled>
                  {t("dashboardOverview.sigmaMigrate")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t("dashboardOverview.sigmaMigrateComingSoon")}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function ownerLabel(email: string, name: string | null | undefined): string {
  return name ? `${name} · ${email}` : email;
}

/** The account-menu avatar: the person's photo, else two initials. */
function OwnerAvatar({
  email,
  name,
  label,
}: {
  email: string;
  name: string | null;
  label: string;
}) {
  const avatarUrl = useAvatarUrl(email);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={label}
          className="inline-flex rounded-full border border-border text-xs font-semibold text-muted-foreground"
        >
          <Avatar className="size-6">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
            <AvatarFallback>{initials(name ?? email)}</AvatarFallback>
          </Avatar>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function initials(value: string): string {
  return (
    value
      .split(/[ @._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}
