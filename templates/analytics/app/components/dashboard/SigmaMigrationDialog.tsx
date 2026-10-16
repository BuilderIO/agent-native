import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrgRole } from "@agent-native/core/client/org";
import { useSendToAgentChat } from "@agent-native/toolkit/app/chat";
import { useOrgSwitcherAppLinks } from "@agent-native/toolkit/app/org/workspace-app-links";
import { saveApiKeyValue } from "@agent-native/toolkit/app/settings/api-keys/api-keys-client";
import {
  IconAlertCircle,
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconSparkles,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
  canRecoverMissingDashboard?: boolean;
  canRetryStaleClaim?: boolean;
  flaggedCount?: number;
  migratedByTeammate?: boolean;
  retryableByCurrentUser: boolean;
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

type SigmaElementReviewReason =
  | "unsupported_element"
  | "unsupported_source"
  | "source_unavailable"
  | "source_mapping_required"
  | "query_unavailable"
  | "unsafe_sql"
  | "visualization_review";

type SigmaWorkbookElement = {
  id: string;
  name: string;
  type: string;
  importable: boolean;
  visualizationPreserved: boolean;
  reason?: SigmaElementReviewReason;
};

type SigmaWorkbookInspection = {
  workbook: { id: string; name: string; updatedAt?: string };
  importableCount: number;
  unsupportedCount: number;
  reviewRequiredCount: number;
  sourceMappingRequiredCount: number;
  elements: SigmaWorkbookElement[];
  betaRepresentationWarning: boolean;
};

type SigmaMigrationResult =
  | {
      status: "completed";
      dashboardId: string;
      dashboardName: string;
      dashboardUrl: string;
      importedCount: number;
      unsupportedCount: number;
      reviewRequiredCount: number;
      flaggedCount: number;
    }
  | {
      status: "already_migrated";
      dashboardId?: string;
      dashboardName?: string;
      dashboardUrl?: string;
    }
  | { status: "in_progress" };

type MigrationArgs = {
  workbookId: string;
  connectionId?: string;
  recoverMissingDashboard?: boolean;
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
const SIGMA_PREVIEW_ELEMENT_LIMIT = 100;

export function SigmaMigrationDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}) {
  const t = useT();
  const { canManageOrg } = useOrgRole();
  const { dispatchHref, dispatchVaultHref } = useOrgSwitcherAppLinks(open);
  const { send, isGenerating, codeRequiredDialog } = useSendToAgentChat();
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [workbookId, setWorkbookId] = useState<string | null>(null);
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
  const [migrationResult, setMigrationResult] =
    useState<SigmaMigrationResult | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [migrationInProgress, setMigrationInProgress] = useState(false);
  const [awaitingListConfirmation, setAwaitingListConfirmation] =
    useState(false);
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
    setWorkbookId(null);
    setMigrationResult(null);
    setMigrationError(null);
    setMigrationInProgress(false);
    setAwaitingListConfirmation(false);
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
  useEffect(() => {
    if (workbooks.some((workbook) => workbook.id === workbookId)) return;
    setWorkbookId(workbooks[0]?.id ?? null);
  }, [workbooks, workbookId]);

  const selectedWorkbook =
    workbooks.find((workbook) => workbook.id === workbookId) ?? null;
  const selectedWorkbookPage =
    loadedPages.connectionId === connectionId
      ? loadedPages.pages.find((page) =>
          page.workbooks.some((workbook) => workbook.id === workbookId),
        )?.cursor
      : undefined;
  const inspection = useActionQuery<
    SigmaWorkbookInspection,
    "inspect-sigma-workbook"
  >(
    "inspect-sigma-workbook",
    selectedWorkbook && connectionId
      ? { workbookId: selectedWorkbook.id, connectionId }
      : undefined,
    {
      enabled: open && Boolean(selectedWorkbook && connectionId),
      staleTime: 15_000,
    },
  );
  const migrateWorkbook = useActionMutation<
    SigmaMigrationResult,
    MigrationArgs,
    "migrate-sigma-workbook"
  >("migrate-sigma-workbook");
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
  const inspectionIsValid = inspection.data
    ? isWorkbookInspection(inspection.data)
    : false;
  const canImport =
    Boolean(selectedWorkbook && connectionId && inspectionIsValid) &&
    (inspection.data?.importableCount ?? 0) > 0 &&
    !migrationInProgress &&
    selectedWorkbook?.retryableByCurrentUser !== false &&
    (selectedWorkbook?.status !== "migrated" ||
      selectedWorkbook?.canRecoverMissingDashboard === true) &&
    (selectedWorkbook?.status !== "migrating" ||
      selectedWorkbook?.canRetryStaleClaim === true);
  const isImported =
    migrationResult?.status === "completed" ||
    migrationResult?.status === "already_migrated" ||
    selectedWorkbook?.status === "migrated";
  const accessibleDashboardId =
    dashboardIdFromMigrationResult(migrationResult) ??
    (!awaitingListConfirmation && selectedWorkbook?.status === "migrated"
      ? (selectedWorkbook.dashboardId ?? null)
      : null);
  const accessibleDashboardUrl = safeDashboardPath(accessibleDashboardId);
  const reviewTarget =
    selectedWorkbook &&
    isImported &&
    accessibleDashboardId &&
    accessibleDashboardUrl
      ? {
          dashboardId: accessibleDashboardId,
          dashboardName:
            (migrationResult?.status === "completed" ||
            migrationResult?.status === "already_migrated"
              ? migrationResult.dashboardName
              : undefined) ??
            selectedWorkbook.dashboardName ??
            selectedWorkbook.name,
        }
      : null;

  const handleConnectionChange = (value: string) => {
    setConnectionId(value || null);
    setPageCursor(undefined);
    setWorkbookId(null);
    setMigrationResult(null);
    setMigrationError(null);
    setMigrationInProgress(false);
    setAwaitingListConfirmation(false);
  };

  const handleWorkbookChange = (value: string) => {
    setWorkbookId(value);
    setMigrationResult(null);
    setMigrationError(null);
    setMigrationInProgress(false);
    setAwaitingListConfirmation(false);
  };

  const handleImport = async () => {
    if (!selectedWorkbook || !connectionId || !canImport) return;
    setMigrationError(null);
    setMigrationResult(null);
    setMigrationInProgress(false);
    setAwaitingListConfirmation(false);
    try {
      const result = await migrateWorkbook.mutateAsync({
        workbookId: selectedWorkbook.id,
        connectionId,
        ...(selectedWorkbook.canRecoverMissingDashboard
          ? { recoverMissingDashboard: true }
          : {}),
      });
      if (!isMigrationResult(result)) {
        setMigrationError(t("dashboardOverview.sigmaMigrationResultInvalid"));
        return;
      }
      if (result.status === "in_progress") {
        setMigrationInProgress(true);
        setPageCursor(selectedWorkbookPage);
        setRefreshVersion((current) => current + 1);
        return;
      }
      setMigrationResult(result);
      setAwaitingListConfirmation(true);
      setPageCursor(selectedWorkbookPage);
      setRefreshVersion((current) => current + 1);
      onImported?.();
    } catch {
      setMigrationError(t("dashboardOverview.sigmaMigrationFailed"));
    }
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

  useEffect(() => {
    if (
      !awaitingListConfirmation ||
      !selectedWorkbook ||
      !connectionId ||
      workbookList.isPending ||
      workbookList.isFetching ||
      listData?.connectionId !== connectionId ||
      !listData.workbooks.some(
        (workbook) => workbook.id === selectedWorkbook.id,
      )
    ) {
      return;
    }
    setAwaitingListConfirmation(false);
  }, [
    awaitingListConfirmation,
    connectionId,
    listData,
    selectedWorkbook,
    workbookList.isFetching,
    workbookList.isPending,
  ]);

  useEffect(() => {
    if (
      !migrationInProgress ||
      !selectedWorkbook ||
      workbookList.isFetching ||
      listData?.connectionId !== connectionId
    ) {
      return;
    }
    const listedWorkbook = listData.workbooks.find(
      (workbook) => workbook.id === selectedWorkbook.id,
    );
    if (
      listedWorkbook &&
      (listedWorkbook.status !== "migrating" ||
        listedWorkbook.canRetryStaleClaim === true)
    ) {
      setMigrationInProgress(false);
    }
  }, [
    connectionId,
    listData,
    migrationInProgress,
    selectedWorkbook,
    workbookList.isFetching,
  ]);

  const handleReview = () => {
    if (!reviewTarget || !selectedWorkbook) return;
    send({
      message: t("dashboardOverview.sigmaReviewPrompt", {
        name: reviewTarget.dashboardName,
      }),
      context: JSON.stringify({
        dashboardId: reviewTarget.dashboardId,
        workbookId: selectedWorkbook.id,
        source: "sigma",
      }),
      contextLabel: t("dashboardOverview.sigmaReviewContext"),
      submit: true,
      openSidebar: true,
    });
    onOpenChange(false);
  };

  const dashboardPath = reviewTarget ? accessibleDashboardUrl : null;
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
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>{t("dashboardOverview.importFromSigma")}</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-2">
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
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="sigma-workbook">
                      {t("dashboardOverview.sigmaWorkbook")}
                    </Label>
                    <Select
                      value={selectedWorkbook?.id ?? ""}
                      onValueChange={handleWorkbookChange}
                    >
                      <SelectTrigger id="sigma-workbook">
                        <SelectValue
                          placeholder={t(
                            "dashboardOverview.sigmaChooseWorkbook",
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {workbooks.map((workbook) => (
                          <SelectItem key={workbook.id} value={workbook.id}>
                            {workbook.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedWorkbook?.migratedByTeammate ? (
                    <Badge variant="outline">
                      {t("dashboardOverview.sigmaImportedByTeammate")}
                    </Badge>
                  ) : null}
                  {typeof selectedWorkbook?.flaggedCount === "number" &&
                  selectedWorkbook.flaggedCount > 0 ? (
                    <Badge variant="outline">
                      {t("dashboardOverview.sigmaFlaggedCount", {
                        count: selectedWorkbook.flaggedCount,
                      })}
                    </Badge>
                  ) : null}

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

                  {selectedWorkbook ? (
                    <section className="space-y-3" aria-live="polite">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
                          {selectedWorkbook.name}
                        </h3>
                        <WorkbookStatusBadge status={selectedWorkbook.status} />
                        {selectedWorkbook.isArchived ? (
                          <Badge variant="outline">
                            {t("dashboardOverview.sigmaArchived")}
                          </Badge>
                        ) : null}
                      </div>
                      {selectedWorkbook.status === "failed" &&
                      selectedWorkbook.retryableByCurrentUser === false ? (
                        <p className="text-sm text-muted-foreground">
                          {t("dashboardOverview.sigmaRetryOwnerOnly")}
                        </p>
                      ) : null}

                      {inspection.isPending ? (
                        <PreviewSkeleton />
                      ) : inspection.isError ||
                        (inspection.data && !inspectionIsValid) ? (
                        <StateMessage
                          icon={<IconAlertCircle className="size-4" />}
                          title={t("dashboardOverview.sigmaPreviewFailed")}
                          detail={t("dashboardOverview.sigmaRetryPreview")}
                          action={
                            <div className="flex flex-wrap gap-2">
                              {chooseConnectionButton}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void inspection.refetch()}
                              >
                                {t("dashboardOverview.sigmaRetry")}
                              </Button>
                            </div>
                          }
                        />
                      ) : inspection.data ? (
                        <>
                          <WorkbookPreview inspection={inspection.data} t={t} />
                        </>
                      ) : null}

                      {(selectedWorkbook.status === "migrating" &&
                        selectedWorkbook.canRetryStaleClaim !== true) ||
                      migrationInProgress ? (
                        <p
                          className="text-sm text-muted-foreground"
                          role="status"
                        >
                          {t("dashboardOverview.sigmaImportInProgress")}
                        </p>
                      ) : null}

                      {migrationError ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm text-destructive" role="alert">
                            {migrationError}
                          </p>
                          {chooseConnectionButton}
                        </div>
                      ) : null}

                      {isImported ? (
                        <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
                          <div className="flex items-start gap-2">
                            <IconCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                            <div className="min-w-0 space-y-1">
                              <p className="text-sm font-medium">
                                {t(
                                  migrationResult?.status === "completed"
                                    ? "dashboardOverview.sigmaImportComplete"
                                    : "dashboardOverview.sigmaAlreadyImported",
                                )}
                              </p>
                              {migrationResult?.status === "completed" ? (
                                <p className="text-sm text-muted-foreground">
                                  {t("dashboardOverview.sigmaImportSummary", {
                                    imported: migrationResult.importedCount,
                                    unsupported:
                                      migrationResult.unsupportedCount,
                                  })}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          {migrationResult?.status === "completed" &&
                          migrationResult.flaggedCount > 0 ? (
                            <Badge variant="outline">
                              {t("dashboardOverview.sigmaFlaggedCount", {
                                count: migrationResult.flaggedCount,
                              })}
                            </Badge>
                          ) : null}
                          {reviewTarget && dashboardPath ? (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                asChild
                                type="button"
                                variant="outline"
                                size="sm"
                              >
                                <Link to={dashboardPath}>
                                  {t("dashboardOverview.sigmaOpenDashboard")}
                                  <IconExternalLink />
                                </Link>
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={handleReview}
                                disabled={isGenerating}
                              >
                                <IconSparkles />
                                {t("dashboardOverview.sigmaReviewWithAgent")}
                              </Button>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              {t("dashboardOverview.sigmaImportedNoDashboard")}
                            </p>
                          )}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              ) : null
            ) : null}
          </div>

          <DialogFooter className="border-t border-border/60 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("sidebar.cancel")}
            </Button>
            {connected &&
            !needsConnectionSelection &&
            selectedWorkbook &&
            (canImport || migrateWorkbook.isPending) ? (
              <Button
                type="button"
                onClick={() => void handleImport()}
                disabled={
                  !canImport || migrationInProgress || migrateWorkbook.isPending
                }
              >
                {migrateWorkbook.isPending ? (
                  <IconLoader2 className="animate-spin" />
                ) : null}
                {migrateWorkbook.isPending
                  ? t("dashboardOverview.sigmaImporting")
                  : selectedWorkbook.canRetryStaleClaim
                    ? t("dashboardOverview.sigmaRetry")
                    : t("dashboardOverview.sigmaImportWorkbook")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {codeRequiredDialog}
    </>
  );
}

function WorkbookPreview({
  inspection,
  t,
}: {
  inspection: SigmaWorkbookInspection;
  t: ReturnType<typeof useT>;
}) {
  const visibleElements = inspection.elements.slice(
    0,
    SIGMA_PREVIEW_ELEMENT_LIMIT,
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">
          {t("dashboardOverview.sigmaPreviewTitle")}
        </h4>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">
            {t("dashboardOverview.sigmaImportableCount", {
              count: inspection.importableCount,
            })}
          </Badge>
          <Badge variant="outline">
            {t("dashboardOverview.sigmaUnsupportedCount", {
              count: inspection.unsupportedCount,
            })}
          </Badge>
          {inspection.reviewRequiredCount > 0 ? (
            <Badge variant="outline">
              {t("dashboardOverview.sigmaReviewRequiredCount", {
                count: inspection.reviewRequiredCount,
              })}
            </Badge>
          ) : null}
        </div>
      </div>
      {inspection.betaRepresentationWarning ? (
        <p className="text-sm text-muted-foreground">
          {t("dashboardOverview.sigmaBetaRepresentationWarning")}
        </p>
      ) : null}
      {inspection.sourceMappingRequiredCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("dashboardOverview.sigmaPreviewOnly")}
        </p>
      ) : null}
      {inspection.elements.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("dashboardOverview.sigmaNoElements")}
        </p>
      ) : (
        <>
          <ul className="max-h-56 divide-y overflow-y-auto rounded-md border border-border/60">
            {visibleElements.map((element) => (
              <li
                key={element.id}
                className="flex min-w-0 items-start justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{element.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {element.type}
                  </p>
                  {element.reason ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(reasonTranslationKey(element.reason))}
                    </p>
                  ) : null}
                </div>
                <Badge
                  variant={element.importable ? "secondary" : "outline"}
                  className="shrink-0"
                >
                  {element.importable
                    ? t("dashboardOverview.sigmaImportable")
                    : t("dashboardOverview.sigmaUnsupported")}
                </Badge>
              </li>
            ))}
          </ul>
          {visibleElements.length < inspection.elements.length ? (
            <p className="text-sm text-muted-foreground">
              {t("dashboardOverview.sigmaPreviewTruncated", {
                shown: visibleElements.length,
                total: inspection.elements.length,
              })}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function reasonTranslationKey(reason: SigmaElementReviewReason) {
  return {
    unsupported_element: "dashboardOverview.sigmaReasonUnsupportedElement",
    unsupported_source: "dashboardOverview.sigmaReasonUnsupportedSource",
    source_unavailable: "dashboardOverview.sigmaReasonSourceUnavailable",
    source_mapping_required:
      "dashboardOverview.sigmaReasonSourceMappingRequired",
    query_unavailable: "dashboardOverview.sigmaReasonQueryUnavailable",
    unsafe_sql: "dashboardOverview.sigmaReasonUnsafeSql",
    visualization_review: "dashboardOverview.sigmaReasonVisualizationReview",
  }[reason];
}

function WorkbookStatusBadge({ status }: { status: SigmaWorkbook["status"] }) {
  const t = useT();
  const labelKey = {
    not_started: "dashboardOverview.sigmaStatusNotImported",
    migrating: "dashboardOverview.sigmaStatusImporting",
    migrated: "dashboardOverview.sigmaStatusImported",
    failed: "dashboardOverview.sigmaStatusFailed",
  }[status];
  const variant = status === "failed" ? "destructive" : "outline";
  return <Badge variant={variant}>{t(labelKey)}</Badge>;
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
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-10 w-full" />
      <div className="space-y-2 rounded-md border p-3">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="space-y-3 rounded-md border border-border/60 p-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
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
        typeof workbook.retryableByCurrentUser === "boolean",
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

function isWorkbookInspection(
  value: unknown,
): value is SigmaWorkbookInspection {
  if (!value || typeof value !== "object") return false;
  const result = value as SigmaWorkbookInspection;
  return (
    Boolean(result.workbook && typeof result.workbook === "object") &&
    typeof result.workbook.id === "string" &&
    typeof result.workbook.name === "string" &&
    typeof result.importableCount === "number" &&
    result.importableCount >= 0 &&
    typeof result.unsupportedCount === "number" &&
    result.unsupportedCount >= 0 &&
    typeof result.reviewRequiredCount === "number" &&
    result.reviewRequiredCount >= 0 &&
    typeof result.sourceMappingRequiredCount === "number" &&
    result.sourceMappingRequiredCount >= 0 &&
    typeof result.betaRepresentationWarning === "boolean" &&
    Array.isArray(result.elements) &&
    result.elements.every(
      (element) =>
        typeof element.id === "string" &&
        typeof element.name === "string" &&
        typeof element.type === "string" &&
        typeof element.importable === "boolean" &&
        typeof element.visualizationPreserved === "boolean" &&
        (element.reason === undefined ||
          [
            "unsupported_element",
            "unsupported_source",
            "source_unavailable",
            "source_mapping_required",
            "query_unavailable",
            "unsafe_sql",
            "visualization_review",
          ].includes(element.reason)),
    )
  );
}

function isMigrationResult(value: unknown): value is SigmaMigrationResult {
  if (!value || typeof value !== "object") return false;
  const result = value as SigmaMigrationResult;
  if (result.status === "in_progress") return true;
  if (result.status === "already_migrated") {
    return (
      (result.dashboardId === undefined ||
        typeof result.dashboardId === "string") &&
      (result.dashboardName === undefined ||
        typeof result.dashboardName === "string") &&
      (result.dashboardUrl === undefined ||
        typeof result.dashboardUrl === "string")
    );
  }
  return (
    result.status === "completed" &&
    typeof result.dashboardId === "string" &&
    result.dashboardId.length > 0 &&
    typeof result.dashboardName === "string" &&
    typeof result.importedCount === "number" &&
    typeof result.unsupportedCount === "number" &&
    typeof result.reviewRequiredCount === "number" &&
    typeof result.flaggedCount === "number" &&
    typeof result.dashboardUrl === "string"
  );
}

function safeDashboardPath(id: string | null) {
  if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) return null;
  return `/dashboards/${encodeURIComponent(id)}`;
}

function dashboardIdFromMigrationResult(
  result: SigmaMigrationResult | null,
): string | null {
  if (result?.status === "completed") return result.dashboardId;
  if (result?.status === "already_migrated") return result.dashboardId ?? null;
  return null;
}
