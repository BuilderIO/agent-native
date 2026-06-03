import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  IconAdjustmentsHorizontal,
  IconBrowser,
  IconBulb,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconCircleDot,
  IconCircleX,
  IconClipboardCheck,
  IconCode,
  IconCopy,
  IconDots,
  IconEdit,
  IconEyeCheck,
  IconFileExport,
  IconFileText,
  IconGitBranch,
  IconHtml,
  IconInfoCircle,
  IconLayoutBoard,
  IconListCheck,
  IconMap2,
  IconMessageCircle,
  IconPalette,
  IconPhoto,
  IconPlus,
  IconPrompt,
  IconRefresh,
  IconRoute,
  IconShieldCheck,
  IconStack,
  IconSubtask,
  IconTimeline,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@/components/layout/HeaderActions";
import {
  useAnalyzePlan,
  useContract,
  useContracts,
  useCreateContract,
  useExportContract,
  useRecordEvidence,
  useRecordProgress,
  useUpdateContractItems,
  type ContractItemInput,
} from "@/hooks/use-contracts";
import { cn } from "@/lib/utils";
import type {
  ContractBundle,
  ContractItem,
  ContractSource,
  ContractSummary,
  Evidence,
  ReviewState,
  RiskLevel,
  Verification,
  VerificationStatus,
} from "@shared/types";

type ReviewFilter = "needs_review" | "assumptions" | "criteria" | "all";
type ReviewAction = "accepted" | "rejected" | "needs_evidence";
type HtmlPlanMode = "brief" | "map" | "prototype";
type PrototypeOption = "ship-plan" | "prototype-first" | "proof-first";

type PrototypeKnobs = {
  visualDepth: number;
  interactionDepth: number;
  proofStrictness: number;
};

const SOURCE_OPTIONS: Array<{ value: ContractSource; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "pi", label: "Pi" },
  { value: "manual", label: "Manual" },
  { value: "imported", label: "Imported" },
];

const FILTERS: Array<{ value: ReviewFilter; label: string }> = [
  { value: "needs_review", label: "Needs Review" },
  { value: "assumptions", label: "Assumptions" },
  { value: "criteria", label: "Criteria" },
  { value: "all", label: "All" },
];

const itemTypeLabels: Record<string, string> = {
  assumption: "Assumption",
  decision: "Decision",
  constraint: "Constraint",
  task: "Task",
  acceptance_criterion: "Criterion",
  risk: "Risk",
  deviation: "Deviation",
  open_question: "Question",
  amendment: "Amendment",
};

const reviewStateLabels: Record<ReviewState, string> = {
  unreviewed: "Unreviewed",
  accepted: "Accepted",
  rejected: "Rejected",
  corrected: "Corrected",
  waived: "Waived",
  needs_evidence: "Needs evidence",
};

const verificationLabels: Record<VerificationStatus, string> = {
  missing: "Missing",
  evidence_attached: "Evidence attached",
  verified: "Verified",
  failed: "Failed",
  waived: "Waived",
  inconclusive: "Inconclusive",
};

function riskClass(risk: RiskLevel) {
  switch (risk) {
    case "critical":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    default:
      return "border-border/80 bg-muted/25 text-muted-foreground";
  }
}

function reviewStateClass(state: ReviewState) {
  switch (state) {
    case "rejected":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    default:
      return "border-border/80 bg-muted/25 text-muted-foreground";
  }
}

function statusClass(status: string) {
  switch (status) {
    case "complete":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "blocked":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function verificationClass(status: VerificationStatus) {
  switch (status) {
    case "verified":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    default:
      return "border-border/80 bg-muted/25 text-muted-foreground";
  }
}

function shouldShowRisk(risk: RiskLevel) {
  return risk === "high" || risk === "critical";
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function sentence(value?: string | null) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

function itemInputFromItem(
  item: ContractItem,
  patch: Partial<ContractItemInput> = {},
): ContractItemInput {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body,
    status: item.status,
    risk: item.risk,
    reviewState: item.reviewState,
    actedOn: item.actedOn,
    impactSummary: item.impactSummary ?? undefined,
    affectedFiles: item.affectedFiles,
    sourceRefs: item.sourceRefs,
    linkedItemIds: item.linkedItemIds,
    createdBy: item.createdBy,
    ...patch,
  };
}

function evidenceForItem(itemId: string, evidence: Evidence[]) {
  return evidence.filter((item) => item.linkedItemIds.includes(itemId));
}

function isTrustedEvidence(item: Evidence) {
  return (
    item.source !== "agent_attestation" &&
    (item.trustLevel === "high" || item.trustLevel === "human_confirmed")
  );
}

function latestVerification(
  itemId: string,
  verifications: Verification[],
): Verification | undefined {
  return verifications
    .filter((item) => item.criterionItemId === itemId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .pop();
}

function proofStatus(
  criterion: ContractItem,
  bundle: ContractBundle,
): VerificationStatus {
  const latest = latestVerification(criterion.id, bundle.verifications);
  if (latest) return latest.status;
  return evidenceForItem(criterion.id, bundle.evidence).length > 0
    ? "evidence_attached"
    : "missing";
}

function finalStatus(bundle: ContractBundle) {
  const unresolvedHighRisk = bundle.items.filter(
    (item) =>
      (item.risk === "high" || item.risk === "critical") &&
      item.reviewState === "unreviewed",
  ).length;
  const failed = bundle.verifications.filter(
    (item) => item.status === "failed",
  ).length;
  if (unresolvedHighRisk > 0) return "Needs assumption review";
  if (failed > 0) return "Has failed proof";
  if (bundle.summary.missingEvidenceCount > 0) return "Needs proof";
  if (bundle.summary.reviewCount > 0) return "Needs review";
  return "Ready";
}

export function ContractsPage() {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ReviewFilter>("needs_review");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [contractRailCollapsed, setContractRailCollapsed] = useState(false);
  const [correctionTarget, setCorrectionTarget] = useState<ContractItem | null>(
    null,
  );
  const [evidenceTarget, setEvidenceTarget] = useState<ContractItem | null>(
    null,
  );

  const contractsQuery = useContracts();
  const contracts = contractsQuery.data ?? [];
  const selectedId = params.id ?? contracts[0]?.id;
  const contractQuery = useContract(selectedId);
  const bundle = contractQuery.data;
  const createContract = useCreateContract();
  const analyzePlan = useAnalyzePlan();
  const updateItems = useUpdateContractItems();
  const recordProgress = useRecordProgress();
  const recordEvidence = useRecordEvidence();
  const exportContract = useExportContract(selectedId);

  useSetPageTitle("Visual Plans");

  const headerActions = useMemo(
    () => (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={() => contractsQuery.refetch()}
              disabled={contractsQuery.isFetching}
              aria-label="Refresh"
            >
              <IconRefresh className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh visual plans</TooltipContent>
        </Tooltip>
        <Button
          variant="outline"
          onClick={() => setCreateOpen(true)}
          size="sm"
          className="shrink-0"
        >
          <IconPlus className="h-4 w-4" />
          <span className="hidden sm:inline">New Visual Plan</span>
          <span className="sm:hidden">New</span>
        </Button>
      </>
    ),
    [contractsQuery],
  );
  useSetHeaderActions(headerActions);

  useEffect(() => {
    if (!params.id) return;
    if (contractQuery.error) {
      toast.error("Visual plan not found");
      navigate("/plans", { replace: true });
    }
  }, [contractQuery.error, navigate, params.id]);

  async function handleCreate(input: {
    title: string;
    goal: string;
    repoPath: string;
    source: ContractSource;
    planText: string;
  }) {
    const created = await createContract.mutateAsync({
      title: input.title || "Untitled visual plan",
      goal: input.goal,
      repoPath: input.repoPath || undefined,
      source: input.source,
      currentPhase: "review",
    });
    const contractId = created.contract.id;
    if (input.planText.trim()) {
      await analyzePlan.mutateAsync({
        contractId,
        planText: input.planText.trim(),
      });
    }
    navigate(`/plans/${contractId}`);
    setCreateOpen(false);
    toast.success("Visual plan created");
  }

  async function handleReviewAction(item: ContractItem, action: ReviewAction) {
    if (!bundle) return;
    const feedbackKind =
      action === "needs_evidence"
        ? "request_evidence"
        : action === "accepted"
          ? "accept"
          : "reject";
    await updateItems.mutateAsync({
      contractId: bundle.contract.id,
      items: [
        itemInputFromItem(item, {
          reviewState: action,
          status: action,
          actedOn: action === "rejected" ? "false" : item.actedOn,
        }),
      ],
      feedback: [
        {
          targetItemId: item.id,
          kind: feedbackKind,
          message: `${reviewStateLabels[action]}: ${item.title}`,
        },
      ],
    });
    toast.success(reviewStateLabels[action]);
  }

  async function handleCorrect(input: {
    item: ContractItem;
    title: string;
    body: string;
    message: string;
  }) {
    if (!bundle) return;
    await updateItems.mutateAsync({
      contractId: bundle.contract.id,
      items: [
        itemInputFromItem(input.item, {
          title: input.title,
          body: input.body,
          status: "corrected",
          reviewState: "corrected",
        }),
      ],
      feedback: [
        {
          targetItemId: input.item.id,
          kind: "correct",
          message: input.message || `Corrected: ${input.title}`,
          structuredPatch: { title: input.title, body: input.body },
        },
      ],
    });
    setCorrectionTarget(null);
    toast.success("Correction sent");
  }

  async function handleAddEvidence(input: {
    item: ContractItem;
    summary: string;
    content: string;
  }) {
    if (!bundle) return;
    await recordEvidence.mutateAsync({
      contractId: bundle.contract.id,
      evidence: [
        {
          linkedItemIds: [input.item.id],
          type: "human_note",
          source: "human",
          trustLevel: "human_confirmed",
          summary: input.summary,
          content: input.content || undefined,
          attachedBy: "human",
        },
      ],
    });
    setEvidenceTarget(null);
    toast.success("Evidence attached");
  }

  async function handleSendFeedback(input: {
    targetItemId?: string;
    message: string;
  }) {
    if (!bundle || !input.message.trim()) return;
    await updateItems.mutateAsync({
      contractId: bundle.contract.id,
      feedback: [
        {
          targetItemId: input.targetItemId,
          kind: "ask_question",
          message: input.message.trim(),
        },
      ],
    });
    toast.success("Feedback sent to agent");
  }

  async function handleVerifyCriterion(item: ContractItem) {
    if (!bundle) return;
    const evidenceIds = evidenceForItem(item.id, bundle.evidence).map(
      (evidence) => evidence.id,
    );
    await recordEvidence.mutateAsync({
      contractId: bundle.contract.id,
      evidence: [],
      verifications: [
        {
          criterionItemId: item.id,
          evidenceIds,
          status: "verified",
          verifiedBy: "human",
          note: "Verified in Visual Plans UI.",
        },
      ],
    });
    toast.success("Criterion verified");
  }

  async function handleWaiveCriterion(item: ContractItem) {
    if (!bundle) return;
    await recordEvidence.mutateAsync({
      contractId: bundle.contract.id,
      evidence: [],
      verifications: [
        {
          criterionItemId: item.id,
          evidenceIds: [],
          status: "waived",
          verifiedBy: "human",
          note: "Waived in Visual Plans UI.",
        },
      ],
    });
    await updateItems.mutateAsync({
      contractId: bundle.contract.id,
      items: [
        itemInputFromItem(item, {
          reviewState: "waived",
          status: "waived",
        }),
      ],
    });
    toast.success("Criterion waived");
  }

  async function handleApproveContract() {
    if (!bundle) return;
    await recordProgress.mutateAsync({
      contractId: bundle.contract.id,
      status: "approved",
      currentPhase: "implementing",
      note: "Visual plan approved for implementation.",
    });
    toast.success("Visual plan approved");
  }

  async function handleExport() {
    const result = await exportContract.refetch();
    if (!result.data) return;
    await navigator.clipboard.writeText(
      result.data.html ?? result.data.markdown,
    );
    toast.success(
      result.data.html ? "HTML plan copied" : "Markdown receipt copied",
    );
  }

  if (contractsQuery.isLoading) {
    return <ContractsSkeleton />;
  }

  if (contracts.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-start justify-center overflow-y-auto px-4 py-8">
        <EmptyContracts onCreate={() => setCreateOpen(true)} />
        <CreateContractDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreate={handleCreate}
          pending={createContract.isPending || analyzePlan.isPending}
        />
      </div>
    );
  }

  const filteredQueue = filterQueue(bundle, filter);

  return (
    <div className="contracts-dashboard flex h-full min-h-0 flex-col bg-background">
      <div
        className="contracts-grid grid min-h-0 grid-cols-1"
        data-rail={contractRailCollapsed ? "collapsed" : "expanded"}
      >
        <ContractsList
          contracts={contracts}
          selectedId={selectedId}
          collapsed={contractRailCollapsed}
          onCollapsedChange={setContractRailCollapsed}
        />

        <section className="min-w-0 overflow-y-auto">
          {bundle ? (
            <>
              <ContractTopBar
                bundle={bundle}
                onApprove={handleApproveContract}
                onExport={handleExport}
                onOpenDetails={() => setDetailsOpen(true)}
                approving={recordProgress.isPending}
                exporting={exportContract.isFetching}
              />
              <PlanWorkspace
                bundle={bundle}
                filter={filter}
                filteredQueue={filteredQueue}
                onFilterChange={setFilter}
                onReviewAction={handleReviewAction}
                onCorrect={setCorrectionTarget}
                onFeedback={handleSendFeedback}
                onAddEvidence={setEvidenceTarget}
                onVerifyCriterion={handleVerifyCriterion}
                onWaiveCriterion={handleWaiveCriterion}
                pending={
                  updateItems.isPending ||
                  recordEvidence.isPending ||
                  recordProgress.isPending
                }
              />
            </>
          ) : (
            <ContractDetailSkeleton />
          )}
        </section>
      </div>

      {bundle && (
        <ContractDetailsSheet
          bundle={bundle}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          onAddEvidence={setEvidenceTarget}
          onRequestProof={(item) => handleReviewAction(item, "needs_evidence")}
          onVerifyCriterion={handleVerifyCriterion}
          onWaiveCriterion={handleWaiveCriterion}
          pending={updateItems.isPending || recordEvidence.isPending}
        />
      )}

      <CreateContractDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
        pending={createContract.isPending || analyzePlan.isPending}
      />
      <CorrectItemDialog
        item={correctionTarget}
        onOpenChange={(open) => !open && setCorrectionTarget(null)}
        onSubmit={handleCorrect}
        pending={updateItems.isPending}
      />
      <EvidenceDialog
        item={evidenceTarget}
        onOpenChange={(open) => !open && setEvidenceTarget(null)}
        onSubmit={handleAddEvidence}
        pending={recordEvidence.isPending}
      />
    </div>
  );
}

function filterQueue(bundle: ContractBundle | undefined, filter: ReviewFilter) {
  if (!bundle) return [];
  if (filter === "needs_review") return bundle.reviewQueue;
  if (filter === "assumptions") {
    return bundle.items.filter((item) => item.type === "assumption");
  }
  if (filter === "criteria") {
    return bundle.items.filter((item) => item.type === "acceptance_criterion");
  }
  return bundle.items;
}

function ContractsList({
  contracts,
  selectedId,
  collapsed,
  onCollapsedChange,
}: {
  contracts: ContractSummary[];
  selectedId?: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  return (
    <aside className="contracts-list-pane flex min-h-0 flex-col border-b border-border bg-muted/20 transition-[width]">
      <div
        className={cn(
          "flex h-12 items-center border-b border-border px-3",
          collapsed ? "justify-center px-2" : "justify-between",
        )}
      >
        {!collapsed && (
          <div className="flex min-w-0 items-center gap-2">
            <IconClipboardCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-semibold">Visual Plans</span>
            <Badge variant="outline" className="shrink-0">
              {contracts.length}
            </Badge>
          </div>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={() => onCollapsedChange(!collapsed)}
              aria-label={collapsed ? "Expand plans" : "Collapse plans"}
            >
              {collapsed ? (
                <IconChevronRight className="h-4 w-4" />
              ) : (
                <IconChevronLeft className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? "Expand plans" : "Collapse plans"}
          </TooltipContent>
        </Tooltip>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className={cn("space-y-1 p-2", collapsed && "px-1.5")}>
          {contracts.map((contract) => {
            const openCount =
              contract.reviewCount + contract.missingEvidenceCount;
            return (
              <Tooltip key={contract.id}>
                <TooltipTrigger asChild>
                  <Link
                    to={`/plans/${contract.id}`}
                    className={cn(
                      "block rounded-md border text-left transition-colors",
                      collapsed
                        ? "flex h-10 items-center justify-center px-0 py-0"
                        : "px-3 py-2.5",
                      selectedId === contract.id
                        ? "border-foreground/20 bg-background shadow-sm"
                        : "border-transparent hover:border-border hover:bg-background/70",
                    )}
                    aria-label={contract.title}
                  >
                    {collapsed ? (
                      <RailStatusDot contract={contract} />
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {contract.title}
                            </p>
                            <p className="mt-1 line-clamp-1 text-xs leading-5 text-muted-foreground">
                              {contract.goal}
                            </p>
                          </div>
                          <IconChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">
                          {sentence(contract.status)}
                          {openCount > 0 && ` / ${openCount} open`}
                        </p>
                      </>
                    )}
                  </Link>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right" className="max-w-72">
                    <p className="font-medium">{contract.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {openCount} open item{openCount === 1 ? "" : "s"}
                    </p>
                  </TooltipContent>
                )}
              </Tooltip>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}

function RailStatusDot({ contract }: { contract: ContractSummary }) {
  const needsAttention =
    contract.reviewCount > 0 || contract.missingEvidenceCount > 0;
  return (
    <span
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-semibold",
        needsAttention
          ? "border-border bg-background text-foreground"
          : "border-border bg-background text-muted-foreground",
      )}
    >
      {needsAttention
        ? contract.reviewCount + contract.missingEvidenceCount
        : contract.title.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ContractTopBar({
  bundle,
  onApprove,
  onExport,
  onOpenDetails,
  approving,
  exporting,
}: {
  bundle: ContractBundle;
  onApprove: () => void;
  onExport: () => void;
  onOpenDetails: () => void;
  approving: boolean;
  exporting: boolean;
}) {
  const assumptionCounts = useMemo(() => assumptionSummary(bundle), [bundle]);
  const status = finalStatus(bundle);
  return (
    <div className="border-b border-border bg-background px-4 py-4 lg:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">
                {bundle.contract.title}
              </h1>
              <Badge
                variant="outline"
                className={cn("shrink-0", statusClass(bundle.contract.status))}
              >
                {sentence(bundle.contract.status)}
              </Badge>
              <Badge variant="outline" className="shrink-0">
                {status}
              </Badge>
            </div>
            <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-muted-foreground">
              {bundle.contract.goal}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                {SOURCE_OPTIONS.find(
                  (item) => item.value === bundle.contract.source,
                )?.label ?? bundle.contract.source}
              </span>
              {bundle.contract.repoPath && (
                <>
                  <span aria-hidden="true">/</span>
                  <span className="max-w-full truncate font-mono">
                    {bundle.contract.repoPath}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={onOpenDetails}>
              <IconEyeCheck className="h-4 w-4" />
              Proof
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onExport}
              disabled={exporting}
            >
              <IconFileExport className="h-4 w-4" />
              Export
            </Button>
            {bundle.contract.status === "review" && (
              <Button
                variant="outline"
                size="sm"
                onClick={onApprove}
                disabled={approving}
              >
                <IconCheck className="h-4 w-4" />
                Approve plan
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <SummaryText label="review" value={bundle.summary.reviewCount} />
          <SummaryText label="corrected" value={assumptionCounts.corrected} />
          <SummaryText
            label="proof verified"
            value={bundle.summary.verifiedCount}
          />
          <SummaryText
            label="proof missing"
            value={bundle.summary.missingEvidenceCount}
          />
        </div>
      </div>
    </div>
  );
}

function SummaryText({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>{" "}
      {label}
    </span>
  );
}

type PlanSectionId = "approach" | "assumptions" | "proof" | "changes";

type PlanSectionModel = {
  id: PlanSectionId;
  title: string;
  description: string;
  emptyLabel: string;
  items: ContractItem[];
};

function PlanWorkspace({
  bundle,
  filter,
  filteredQueue,
  onFilterChange,
  onReviewAction,
  onCorrect,
  onFeedback,
  onAddEvidence,
  onVerifyCriterion,
  onWaiveCriterion,
  pending,
}: {
  bundle: ContractBundle;
  filter: ReviewFilter;
  filteredQueue: ContractItem[];
  onFilterChange: (filter: ReviewFilter) => void;
  onReviewAction: (item: ContractItem, action: ReviewAction) => void;
  onCorrect: (item: ContractItem) => void;
  onFeedback: (input: { targetItemId?: string; message: string }) => void;
  onAddEvidence: (item: ContractItem) => void;
  onVerifyCriterion: (item: ContractItem) => void;
  onWaiveCriterion: (item: ContractItem) => void;
  pending: boolean;
}) {
  const sections = useMemo(() => buildPlanSections(bundle), [bundle]);
  return (
    <section className="px-4 py-5 lg:px-6">
      <div className="mx-auto grid w-full max-w-6xl gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0">
          <PlanDocument
            bundle={bundle}
            sections={sections}
            onReviewAction={onReviewAction}
            onCorrect={onCorrect}
            onFeedback={onFeedback}
            onAddEvidence={onAddEvidence}
            onVerifyCriterion={onVerifyCriterion}
            onWaiveCriterion={onWaiveCriterion}
            pending={pending}
          />
        </main>

        <aside className="min-w-0 xl:sticky xl:top-5 xl:self-start">
          <AttentionPanel
            bundle={bundle}
            filter={filter}
            filteredQueue={filteredQueue}
            onFilterChange={onFilterChange}
            onReviewAction={onReviewAction}
            onCorrect={onCorrect}
            onAddEvidence={onAddEvidence}
            onVerifyCriterion={onVerifyCriterion}
            onWaiveCriterion={onWaiveCriterion}
            pending={pending}
          />
        </aside>
      </div>
    </section>
  );
}

function PlanDocument({
  bundle,
  sections,
  onReviewAction,
  onCorrect,
  onFeedback,
  onAddEvidence,
  onVerifyCriterion,
  onWaiveCriterion,
  pending,
}: {
  bundle: ContractBundle;
  sections: PlanSectionModel[];
  onReviewAction: (item: ContractItem, action: ReviewAction) => void;
  onCorrect: (item: ContractItem) => void;
  onFeedback: (input: { targetItemId?: string; message: string }) => void;
  onAddEvidence: (item: ContractItem) => void;
  onVerifyCriterion: (item: ContractItem) => void;
  onWaiveCriterion: (item: ContractItem) => void;
  pending: boolean;
}) {
  const [mode, setMode] = useState<HtmlPlanMode>("brief");
  const [selectedOption, setSelectedOption] =
    useState<PrototypeOption>("ship-plan");
  const [knobs, setKnobs] = useState<PrototypeKnobs>({
    visualDepth: 70,
    interactionDepth: 56,
    proofStrictness: 82,
  });
  const [annotationDraft, setAnnotationDraft] = useState("");
  const scopeFiles = useMemo(
    () =>
      Array.from(new Set(bundle.items.flatMap((item) => item.affectedFiles)))
        .filter(Boolean)
        .slice(0, 4),
    [bundle.items],
  );
  const planPrompt = useMemo(
    () => buildPlanPrompt(bundle, selectedOption, knobs),
    [bundle, selectedOption, knobs],
  );

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(planPrompt);
    toast.success("Plan feedback copied");
  }

  function handleSendAnnotation(message?: string, targetItemId?: string) {
    const feedback = (message ?? annotationDraft).trim();
    if (!feedback) return;
    onFeedback({ targetItemId, message: feedback });
    if (!message) setAnnotationDraft("");
  }

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <header className="border-b border-border px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <IconHtml className="h-4 w-4" />
              HTML plan mode
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">
              Visual plan
            </h2>
            <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-muted-foreground">
              React to the wireframe, flow, and proof gates first. The text plan
              is underneath when you need the fine print.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="w-fit">
              {finalStatus(bundle)}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyPrompt}
            >
              <IconCopy className="h-4 w-4" />
              Copy agent prompt
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <PlanMetaItem
            label="Phase"
            value={sentence(
              bundle.contract.currentPhase || bundle.contract.status,
            )}
          />
          <PlanMetaItem
            label="Approved"
            value={
              bundle.contract.approvedAt
                ? shortDate(bundle.contract.approvedAt)
                : "Pending"
            }
          />
          <PlanMetaItem
            label="Source"
            value={
              SOURCE_OPTIONS.find(
                (item) => item.value === bundle.contract.source,
              )?.label ?? bundle.contract.source
            }
          />
          <PlanMetaItem
            label="Scope"
            value={
              scopeFiles.length > 0
                ? `${scopeFiles.length} file hint${scopeFiles.length === 1 ? "" : "s"}`
                : "Unspecified"
            }
          />
        </div>

        {scopeFiles.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {scopeFiles.map((file) => (
              <span
                key={file}
                className="max-w-full truncate rounded border border-border bg-muted/30 px-2 py-1 font-mono text-xs text-muted-foreground"
              >
                {file}
              </span>
            ))}
          </div>
        )}
      </header>

      <section className="border-b border-border p-5">
        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as HtmlPlanMode)}
          className="w-full"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-semibold">React visually</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Snapshot for quick review, flow for logic, prototype for feel.
              </p>
            </div>
            <TabsList className="grid h-9 w-full grid-cols-3 md:w-auto">
              <TabsTrigger value="brief" className="gap-1.5 text-xs">
                <IconBrowser className="h-3.5 w-3.5" />
                Snapshot
              </TabsTrigger>
              <TabsTrigger value="map" className="gap-1.5 text-xs">
                <IconMap2 className="h-3.5 w-3.5" />
                Flow
              </TabsTrigger>
              <TabsTrigger value="prototype" className="gap-1.5 text-xs">
                <IconAdjustmentsHorizontal className="h-3.5 w-3.5" />
                Prototype
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="brief" className="mt-4">
            <VisualSnapshot
              bundle={bundle}
              sections={sections}
              selectedOption={selectedOption}
              onSelectOption={setSelectedOption}
              onFeedback={handleSendAnnotation}
            />
          </TabsContent>
          <TabsContent value="map" className="mt-4">
            <VisualFlow
              bundle={bundle}
              sections={sections}
              onFeedback={handleSendAnnotation}
            />
          </TabsContent>
          <TabsContent value="prototype" className="mt-4">
            <PrototypeLab
              bundle={bundle}
              selectedOption={selectedOption}
              onSelectOption={setSelectedOption}
              knobs={knobs}
              onKnobsChange={setKnobs}
              onCopyPrompt={handleCopyPrompt}
              onFeedback={handleSendAnnotation}
            />
          </TabsContent>
        </Tabs>
      </section>

      <AnnotationComposer
        value={annotationDraft}
        onChange={setAnnotationDraft}
        onSend={() => handleSendAnnotation()}
        onCopy={handleCopyPrompt}
      />

      <PlanArtifacts bundle={bundle} />

      <Accordion type="multiple" className="px-5">
        <AccordionItem value="details">
          <AccordionTrigger className="py-4 text-left hover:no-underline">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground">
                <IconFileText className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">
                  Text fallback
                </span>
                <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                  Full clauses for when you want the exact plan.
                </span>
              </span>
            </div>
            <Badge variant="outline" className="ml-3 shrink-0">
              {bundle.items.length}
            </Badge>
          </AccordionTrigger>
          <AccordionContent>
            <div className="divide-y divide-border/70">
              {sections.map((section) => (
                <section key={section.id} className="py-4 first:pt-0">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <PlanSectionIcon id={section.id} />
                      <h4 className="truncate text-sm font-semibold">
                        {section.title}
                      </h4>
                    </div>
                    <Badge variant="outline">{section.items.length}</Badge>
                  </div>
                  {section.items.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
                      {section.emptyLabel}
                    </div>
                  ) : (
                    <div className="divide-y divide-border/70">
                      {section.items.map((item) => (
                        <PlanClause
                          key={item.id}
                          item={item}
                          bundle={bundle}
                          onReviewAction={onReviewAction}
                          onCorrect={onCorrect}
                          onAddEvidence={onAddEvidence}
                          onVerifyCriterion={onVerifyCriterion}
                          onWaiveCriterion={onWaiveCriterion}
                          pending={pending}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </article>
  );
}

function PlanMetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

function VisualSnapshot({
  bundle,
  sections,
  selectedOption,
  onSelectOption,
  onFeedback,
}: {
  bundle: ContractBundle;
  sections: PlanSectionModel[];
  selectedOption: PrototypeOption;
  onSelectOption: (option: PrototypeOption) => void;
  onFeedback: (message: string, targetItemId?: string) => void;
}) {
  const assumptions =
    sections.find((section) => section.id === "assumptions")?.items ?? [];
  const proof = sections.find((section) => section.id === "proof")?.items ?? [];
  const primaryAssumption = assumptions[0];
  const primaryCriterion = proof[0];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(17rem,0.75fr)]">
      <VisualWireframe
        bundle={bundle}
        selectedOption={selectedOption}
        onFeedback={onFeedback}
        targetItemId={primaryAssumption?.id ?? primaryCriterion?.id}
      />
      <div className="space-y-3">
        <VisualReactionCard
          icon={<IconBulb className="h-4 w-4" />}
          label="Assumption to check"
          title={primaryAssumption?.title ?? "No material assumption captured"}
          detail={
            primaryAssumption?.impactSummary ??
            "Ask the agent to make assumptions visible before coding."
          }
          actionLabel="Comment"
          onAction={() =>
            onFeedback(
              primaryAssumption
                ? `This assumption needs a clearer visual explanation: ${primaryAssumption.title}`
                : "Add the key assumptions to the visual plan before implementation.",
              primaryAssumption?.id,
            )
          }
        />
        <VisualReactionCard
          icon={<IconShieldCheck className="h-4 w-4" />}
          label="Proof gate"
          title={primaryCriterion?.title ?? "No acceptance criterion captured"}
          detail={
            primaryCriterion
              ? `Current proof status: ${verificationLabels[proofStatus(primaryCriterion, bundle)]}`
              : "Ask the agent to add concrete proof obligations."
          }
          actionLabel="Require proof"
          onAction={() =>
            onFeedback(
              primaryCriterion
                ? `Show exactly how this will be verified: ${primaryCriterion.title}`
                : "Add acceptance criteria and visual proof gates before coding.",
              primaryCriterion?.id,
            )
          }
        />
        <OptionChooser
          selectedOption={selectedOption}
          onSelectOption={onSelectOption}
        />
      </div>
    </div>
  );
}

function VisualWireframe({
  bundle,
  selectedOption,
  onFeedback,
  targetItemId,
}: {
  bundle: ContractBundle;
  selectedOption: PrototypeOption;
  onFeedback: (message: string, targetItemId?: string) => void;
  targetItemId?: string;
}) {
  const report = finalReport(bundle);
  const optionLabel = prototypeOptionLabel(selectedOption);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-muted/10">
      <div className="flex items-center justify-between border-b border-border bg-background px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="truncate text-xs text-muted-foreground">
          interactive-plan.html
        </div>
      </div>

      <div className="grid gap-0 md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-b border-border bg-background p-3 md:border-b-0 md:border-r">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground">Goal</p>
            <p className="mt-2 line-clamp-4 text-sm font-semibold leading-5">
              {bundle.contract.goal}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <MiniMetric label="Review" value={bundle.summary.reviewCount} />
            <MiniMetric
              label="Proof"
              value={bundle.summary.missingEvidenceCount}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 w-full"
            onClick={() =>
              onFeedback(
                "This plan needs a clearer first-screen visual/wireframe before I can approve it.",
                targetItemId,
              )
            }
          >
            <IconMessageCircle className="h-4 w-4" />
            Comment on visual
          </Button>
        </aside>

        <div className="p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_13rem]">
            <div className="rounded-md border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="h-3 w-28 rounded bg-foreground/80" />
                  <div className="mt-2 h-2 w-48 max-w-full rounded bg-muted" />
                </div>
                <Badge variant="outline">{optionLabel}</Badge>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {["Primary path", "Decision point", "Proof state"].map(
                  (label, index) => (
                    <div
                      key={label}
                      className="rounded-md border border-border bg-muted/20 p-3"
                    >
                      <div className="h-16 rounded border border-dashed border-border bg-background" />
                      <p className="mt-2 text-xs font-medium">{label}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {index === 0
                          ? "What changes for the user"
                          : index === 1
                            ? "What the agent assumed"
                            : "How done is proven"}
                      </p>
                    </div>
                  ),
                )}
              </div>
              <div className="mt-4 rounded-md border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium">Final report preview</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {report.missingEvidence > 0
                        ? "Cannot call done until proof is attached."
                        : "Criteria have trusted proof."}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <span
                        key={index}
                        className={cn(
                          "h-7 w-7 rounded border border-border",
                          index < report.verifiedCriteria
                            ? "bg-emerald-500/15"
                            : "bg-background",
                        )}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border bg-background p-3">
              <p className="text-xs font-medium">Annotation pins</p>
              <div className="mt-3 space-y-2">
                {[
                  ["1", "Wrong assumption?"],
                  ["2", "Need mockup"],
                  ["3", "Proof missing"],
                ].map(([number, label]) => (
                  <button
                    key={number}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md border border-border bg-muted/20 px-2 py-2 text-left text-xs transition-colors hover:bg-muted/40"
                    onClick={() =>
                      onFeedback(
                        `Annotation ${number}: ${label}. Please revise the visual plan around this point.`,
                        targetItemId,
                      )
                    }
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] text-background">
                      {number}
                    </span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background px-2 py-2">
      <p className="font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-muted-foreground">{label}</p>
    </div>
  );
}

function VisualReactionCard({
  icon,
  label,
  title,
  detail,
  actionLabel,
  onAction,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  detail: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5">
            {title}
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {detail}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-7 px-2"
            onClick={onAction}
          >
            <IconMessageCircle className="h-4 w-4" />
            {actionLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}

function OptionChooser({
  selectedOption,
  onSelectOption,
}: {
  selectedOption: PrototypeOption;
  onSelectOption: (option: PrototypeOption) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-2">
        <IconPalette className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Pick a plan feel</p>
      </div>
      <div className="mt-3 grid gap-2">
        {prototypeOptions().map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelectOption(option.id)}
            className={cn(
              "rounded-md border px-3 py-2 text-left transition-colors",
              selectedOption === option.id
                ? "border-foreground/30 bg-muted/40"
                : "border-border bg-background hover:bg-muted/20",
            )}
          >
            <p className="text-sm font-medium">{option.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {option.description}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

function VisualFlow({
  bundle,
  sections,
  onFeedback,
}: {
  bundle: ContractBundle;
  sections: PlanSectionModel[];
  onFeedback: (message: string, targetItemId?: string) => void;
}) {
  const assumptions =
    sections.find((section) => section.id === "assumptions")?.items ?? [];
  const proof = sections.find((section) => section.id === "proof")?.items ?? [];
  const changes =
    sections.find((section) => section.id === "changes")?.items ?? [];
  const nodes = [
    {
      title: "User intent",
      detail: bundle.contract.goal,
      icon: <IconPrompt className="h-4 w-4" />,
    },
    {
      title: "Agent choices",
      detail:
        assumptions[0]?.title ??
        "No explicit assumption yet. Ask the agent to expose one.",
      icon: <IconBulb className="h-4 w-4" />,
      targetItemId: assumptions[0]?.id,
    },
    {
      title: "Implementation path",
      detail:
        sections.find((section) => section.id === "approach")?.items[0]
          ?.title ?? "Approach should be visualized before coding.",
      icon: <IconCode className="h-4 w-4" />,
    },
    {
      title: "Proof before done",
      detail: proof[0]?.title ?? "No proof gate captured.",
      icon: <IconShieldCheck className="h-4 w-4" />,
      targetItemId: proof[0]?.id,
    },
  ];
  return (
    <div className="rounded-lg border border-border bg-muted/10 p-4">
      <div className="grid gap-3 lg:grid-cols-4">
        {nodes.map((node, index) => (
          <div key={node.title} className="relative">
            {index < nodes.length - 1 && (
              <div className="absolute left-[calc(100%+0.25rem)] top-10 hidden h-px w-2 bg-border lg:block" />
            )}
            <button
              type="button"
              className="h-full w-full rounded-md border border-border bg-background p-3 text-left transition-colors hover:bg-muted/20"
              onClick={() =>
                onFeedback(
                  `Explain or revise this flow node visually: ${node.title}. Current text: ${node.detail}`,
                  node.targetItemId,
                )
              }
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground">
                {node.icon}
              </span>
              <p className="mt-3 text-sm font-semibold">{node.title}</p>
              <p className="mt-2 line-clamp-4 text-xs leading-5 text-muted-foreground">
                {node.detail}
              </p>
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <FlowMiniPanel
          label="Assumptions"
          value={assumptions.length}
          description="Click any node above to push feedback to the agent."
        />
        <FlowMiniPanel
          label="Proof gates"
          value={proof.length}
          description="Missing proof blocks the final done claim."
        />
        <FlowMiniPanel
          label="Plan changes"
          value={changes.length}
          description="Amendments/deviations appear here as drift."
        />
      </div>
    </div>
  );
}

function FlowMiniPanel({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function PrototypeLab({
  bundle,
  selectedOption,
  onSelectOption,
  knobs,
  onKnobsChange,
  onCopyPrompt,
  onFeedback,
}: {
  bundle: ContractBundle;
  selectedOption: PrototypeOption;
  onSelectOption: (option: PrototypeOption) => void;
  knobs: PrototypeKnobs;
  onKnobsChange: (knobs: PrototypeKnobs) => void;
  onCopyPrompt: () => void;
  onFeedback: (message: string, targetItemId?: string) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <InteractivePrototypePreview
        bundle={bundle}
        selectedOption={selectedOption}
        knobs={knobs}
        onFeedback={onFeedback}
      />
      <div className="space-y-3">
        <OptionChooser
          selectedOption={selectedOption}
          onSelectOption={onSelectOption}
        />
        <section className="rounded-lg border border-border bg-background p-3">
          <div className="flex items-center gap-2">
            <IconAdjustmentsHorizontal className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Tune plan output</p>
          </div>
          <div className="mt-4 space-y-4">
            <KnobSlider
              label="Visual depth"
              value={knobs.visualDepth}
              onChange={(value) =>
                onKnobsChange({ ...knobs, visualDepth: value })
              }
            />
            <KnobSlider
              label="Interactivity"
              value={knobs.interactionDepth}
              onChange={(value) =>
                onKnobsChange({ ...knobs, interactionDepth: value })
              }
            />
            <KnobSlider
              label="Proof strictness"
              value={knobs.proofStrictness}
              onChange={(value) =>
                onKnobsChange({ ...knobs, proofStrictness: value })
              }
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4 w-full"
            onClick={onCopyPrompt}
          >
            <IconCopy className="h-4 w-4" />
            Copy settings
          </Button>
        </section>
      </div>
    </div>
  );
}

function InteractivePrototypePreview({
  bundle,
  selectedOption,
  knobs,
  onFeedback,
}: {
  bundle: ContractBundle;
  selectedOption: PrototypeOption;
  knobs: PrototypeKnobs;
  onFeedback: (message: string, targetItemId?: string) => void;
}) {
  const visualRows = Math.max(2, Math.round(knobs.visualDepth / 20));
  const interactiveControls = Math.max(
    1,
    Math.round(knobs.interactionDepth / 28),
  );
  const proofBlocks = Math.max(1, Math.round(knobs.proofStrictness / 28));
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">
              {prototypeOptionLabel(selectedOption)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              A throwaway HTML prototype the agent should generate before
              implementation.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              onFeedback(
                `Use the ${prototypeOptionLabel(selectedOption)} direction, with visual depth ${knobs.visualDepth}, interactivity ${knobs.interactionDepth}, and proof strictness ${knobs.proofStrictness}.`,
              )
            }
          >
            <IconMessageCircle className="h-4 w-4" />
            Use this
          </Button>
        </div>
      </div>
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="p-4">
          <div className="rounded-lg border border-border bg-muted/10 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="h-3 w-32 rounded bg-foreground/80" />
                <div className="mt-2 h-2 w-48 max-w-full rounded bg-muted" />
              </div>
              <span className="rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                live preview
              </span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {Array.from({ length: visualRows }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-md border border-border bg-background p-3"
                >
                  <div className="h-20 rounded border border-dashed border-border bg-muted/20" />
                  <div className="mt-3 h-2 w-3/4 rounded bg-muted" />
                  <div className="mt-2 h-2 w-1/2 rounded bg-muted" />
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {Array.from({ length: interactiveControls }).map((_, index) => (
                <button
                  key={index}
                  type="button"
                  className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium"
                >
                  Option {index + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
        <aside className="border-t border-border bg-muted/10 p-4 md:border-l md:border-t-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Proof gates
          </p>
          <div className="mt-3 space-y-2">
            {Array.from({ length: proofBlocks }).map((_, index) => (
              <div
                key={index}
                className="rounded-md border border-border bg-background px-3 py-2"
              >
                <p className="text-xs font-medium">
                  Gate {index + 1}: verified output
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Agent cannot mark this complete by assertion.
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 line-clamp-4 text-xs leading-5 text-muted-foreground">
            {bundle.contract.goal}
          </p>
        </aside>
      </div>
    </section>
  );
}

function KnobSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value}
        </span>
      </div>
      <Slider
        value={[value]}
        min={0}
        max={100}
        step={1}
        onValueChange={(next) => onChange(next[0] ?? value)}
      />
    </div>
  );
}

function AnnotationComposer({
  value,
  onChange,
  onSend,
  onCopy,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCopy: () => void;
}) {
  return (
    <section className="border-b border-border bg-muted/10 p-5">
      <div className="grid gap-3 lg:grid-cols-[12rem_minmax(0,1fr)_auto] lg:items-start">
        <div>
          <div className="flex items-center gap-2">
            <IconMessageCircle className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Annotate</h3>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            React in plain English. The agent gets structured feedback.
          </p>
        </div>
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="This wireframe is missing the admin rollback path. Show that visually and add proof."
          className="min-h-20 resize-y bg-background text-sm"
        />
        <div className="flex gap-2 lg:flex-col">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!value.trim()}
            onClick={onSend}
          >
            <IconMessageCircle className="h-4 w-4" />
            Send
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCopy}>
            <IconCopy className="h-4 w-4" />
            Copy
          </Button>
        </div>
      </div>
    </section>
  );
}

function prototypeOptions(): Array<{
  id: PrototypeOption;
  label: string;
  description: string;
}> {
  return [
    {
      id: "ship-plan",
      label: "Visual implementation plan",
      description: "Show the intended behavior, assumptions, and proof gates.",
    },
    {
      id: "prototype-first",
      label: "Prototype first",
      description: "Make clickable/wireframe options before implementation.",
    },
    {
      id: "proof-first",
      label: "Proof-first plan",
      description: "Start with verification, rollback, and failure states.",
    },
  ];
}

function prototypeOptionLabel(option: PrototypeOption) {
  return (
    prototypeOptions().find((item) => item.id === option)?.label ??
    "Visual implementation plan"
  );
}

function buildPlanPrompt(
  bundle: ContractBundle,
  option: PrototypeOption,
  knobs: PrototypeKnobs,
) {
  const assumptions = bundle.items
    .filter((item) => item.type === "assumption")
    .slice(0, 4)
    .map((item) => `- ${item.title}`)
    .join("\n");
  const criteria = bundle.items
    .filter((item) => item.type === "acceptance_criterion")
    .slice(0, 4)
    .map((item) => `- ${item.title}`)
    .join("\n");
  return [
    "Revise this plan as a visual HTML plan, not Markdown.",
    "",
    `Goal: ${bundle.contract.goal}`,
    `Preferred mode: ${prototypeOptionLabel(option)}`,
    `Visual depth: ${knobs.visualDepth}/100`,
    `Interactivity: ${knobs.interactionDepth}/100`,
    `Proof strictness: ${knobs.proofStrictness}/100`,
    "",
    "Make it useful for an impatient reviewer: visual first, terse text, clear annotation points.",
    "Include diagrams, wireframes/mockups, option cards, and copy-back feedback controls where useful.",
    "",
    "Assumptions to make visible:",
    assumptions ||
      "- None captured yet; infer material assumptions and mark them explicitly.",
    "",
    "Proof gates to show visually:",
    criteria ||
      "- None captured yet; add concrete acceptance criteria and verification states.",
  ].join("\n");
}

function PlanMap({
  bundle,
  sections,
}: {
  bundle: ContractBundle;
  sections: PlanSectionModel[];
}) {
  const nodes = [
    {
      label: "Intent",
      value: sentence(bundle.contract.status),
      meta: "Goal",
      attention: bundle.contract.status === "draft" ? 1 : 0,
    },
    ...sections.map((section) => ({
      label:
        section.id === "approach"
          ? "Approach"
          : section.id === "assumptions"
            ? "Assumptions"
            : section.id === "proof"
              ? "Proof"
              : "Changes",
      value: `${section.items.length} ${section.items.length === 1 ? "item" : "items"}`,
      meta:
        sectionAttentionCount(section.items, bundle) > 0
          ? "Needs review"
          : "Settled",
      attention: sectionAttentionCount(section.items, bundle),
    })),
  ];
  return (
    <section className="border-b border-border px-5 py-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <IconMap2 className="h-4 w-4 text-muted-foreground" />
        Plan map
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
        {nodes.map((node) => (
          <div
            key={node.label}
            className={cn(
              "relative rounded-md border px-3 py-3",
              node.attention > 0
                ? "border-foreground/20 bg-muted/30"
                : "border-border bg-background",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs text-muted-foreground">
                {node.label}
              </p>
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  node.attention > 0
                    ? "bg-foreground"
                    : "bg-muted-foreground/40",
                )}
              />
            </div>
            <p className="mt-2 truncate text-sm font-medium">{node.value}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {node.meta}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlanArtifacts({ bundle }: { bundle: ContractBundle }) {
  const artifacts = bundle.evidence.filter((item) =>
    ["artifact", "screenshot", "diff"].includes(item.type),
  );
  return (
    <section className="border-b border-border px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <IconLayoutBoard className="h-4 w-4 text-muted-foreground" />
            Diagrams & designs
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {artifacts.length > 0
              ? `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"} attached`
              : "No generated plan artifacts attached"}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {artifacts.length}
        </Badge>
      </div>

      {artifacts.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {artifacts.slice(0, 4).map((item) => (
            <div
              key={item.id}
              className="min-w-0 rounded-md border border-border bg-muted/20 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <IconPhoto className="h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="truncate text-sm font-medium">{item.summary}</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {sentence(item.type)} / {sentence(item.trustLevel)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {["Architecture map", "UI sketch", "Evidence artifact"].map(
            (label) => (
              <div
                key={label}
                className="rounded-md border border-dashed border-border bg-muted/10 px-3 py-3 text-xs text-muted-foreground"
              >
                {label}
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function PlanClause({
  item,
  bundle,
  onReviewAction,
  onCorrect,
  onAddEvidence,
  onVerifyCriterion,
  onWaiveCriterion,
  pending,
}: {
  item: ContractItem;
  bundle: ContractBundle;
  onReviewAction: (item: ContractItem, action: ReviewAction) => void;
  onCorrect: (item: ContractItem) => void;
  onAddEvidence: (item: ContractItem) => void;
  onVerifyCriterion: (item: ContractItem) => void;
  onWaiveCriterion: (item: ContractItem) => void;
  pending: boolean;
}) {
  const isCriterion = item.type === "acceptance_criterion";
  const itemEvidence = evidenceForItem(item.id, bundle.evidence);
  const criterionStatus = isCriterion ? proofStatus(item, bundle) : undefined;
  const needsAttention = itemNeedsAttention(item, bundle);
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto]">
      <div className="pt-1">
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full border",
            needsAttention
              ? "border-foreground/30 bg-muted text-foreground"
              : "border-border bg-background text-muted-foreground",
          )}
        >
          <PlanClauseIcon item={item} />
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className="border-border bg-muted/30 text-muted-foreground"
          >
            {itemTypeLabels[item.type] ?? item.type}
          </Badge>
          {shouldShowRisk(item.risk) && (
            <Badge variant="outline" className={riskClass(item.risk)}>
              {sentence(item.risk)}
            </Badge>
          )}
          <Badge
            variant="outline"
            className={reviewStateClass(item.reviewState)}
          >
            {reviewStateLabels[item.reviewState]}
          </Badge>
          {criterionStatus && (
            <Badge
              variant="outline"
              className={verificationClass(criterionStatus)}
            >
              {verificationLabels[criterionStatus]}
            </Badge>
          )}
        </div>

        <p className="mt-2 break-words text-sm font-medium leading-6">
          {item.title}
        </p>
        {item.body && item.body !== item.title && (
          <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">
            {item.body}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {item.impactSummary && <span>Impact: {item.impactSummary}</span>}
          {itemEvidence.length > 0 && (
            <span>
              {itemEvidence.length} evidence artifact
              {itemEvidence.length === 1 ? "" : "s"}
            </span>
          )}
          {item.affectedFiles.slice(0, 2).map((file) => (
            <span key={file} className="max-w-full truncate font-mono">
              {file}
            </span>
          ))}
        </div>
      </div>

      <PlanItemActionsMenu
        item={item}
        bundle={bundle}
        onReviewAction={onReviewAction}
        onCorrect={onCorrect}
        onAddEvidence={onAddEvidence}
        onVerifyCriterion={onVerifyCriterion}
        onWaiveCriterion={onWaiveCriterion}
        pending={pending}
      />
    </div>
  );
}

function AttentionPanel({
  bundle,
  filter,
  filteredQueue,
  onFilterChange,
  onReviewAction,
  onCorrect,
  onAddEvidence,
  onVerifyCriterion,
  onWaiveCriterion,
  pending,
}: {
  bundle: ContractBundle;
  filter: ReviewFilter;
  filteredQueue: ContractItem[];
  onFilterChange: (filter: ReviewFilter) => void;
  onReviewAction: (item: ContractItem, action: ReviewAction) => void;
  onCorrect: (item: ContractItem) => void;
  onAddEvidence: (item: ContractItem) => void;
  onVerifyCriterion: (item: ContractItem) => void;
  onWaiveCriterion: (item: ContractItem) => void;
  pending: boolean;
}) {
  const report = useMemo(() => finalReport(bundle), [bundle]);
  const criteriaCount = bundle.items.filter(
    (item) => item.type === "acceptance_criterion",
  ).length;
  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-background shadow-sm">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Needs attention</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {filteredQueue.length} item
                {filteredQueue.length === 1 ? "" : "s"}
              </p>
            </div>
            <Badge variant="outline">{bundle.summary.reviewCount}</Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/30 p-1">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => onFilterChange(item.value)}
                className={cn(
                  "h-8 rounded px-2 text-xs font-medium transition-colors",
                  filter === item.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[28rem] overflow-y-auto p-2">
          {filteredQueue.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/10 px-3 py-8 text-center">
              <IconCircleCheck className="mx-auto h-7 w-7 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Clear</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No plan clauses need review.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredQueue.map((item) => (
                <AttentionItem
                  key={item.id}
                  item={item}
                  bundle={bundle}
                  onReviewAction={onReviewAction}
                  onCorrect={onCorrect}
                  onAddEvidence={onAddEvidence}
                  onVerifyCriterion={onVerifyCriterion}
                  onWaiveCriterion={onWaiveCriterion}
                  pending={pending}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <IconShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Proof check</h2>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <ProofMetric label="Verified" value={report.verifiedCriteria} />
          <ProofMetric label="Missing" value={report.missingEvidence} />
          <ProofMetric label="Total" value={criteriaCount} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <IconTimeline className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Recent activity</h2>
        </div>
        <div className="mt-3 space-y-3">
          {bundle.events
            .slice(-3)
            .reverse()
            .map((event) => (
              <div
                key={event.id}
                className="grid grid-cols-[0.75rem_1fr] gap-2"
              >
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                <div className="min-w-0">
                  <p className="line-clamp-2 text-xs leading-5">
                    {event.message}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {shortDate(event.createdAt)}
                  </p>
                </div>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}

function AttentionItem({
  item,
  bundle,
  onReviewAction,
  onCorrect,
  onAddEvidence,
  onVerifyCriterion,
  onWaiveCriterion,
  pending,
}: {
  item: ContractItem;
  bundle: ContractBundle;
  onReviewAction: (item: ContractItem, action: ReviewAction) => void;
  onCorrect: (item: ContractItem) => void;
  onAddEvidence: (item: ContractItem) => void;
  onVerifyCriterion: (item: ContractItem) => void;
  onWaiveCriterion: (item: ContractItem) => void;
  pending: boolean;
}) {
  const isCriterion = item.type === "acceptance_criterion";
  const criterionStatus = isCriterion ? proofStatus(item, bundle) : undefined;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {itemTypeLabels[item.type] ?? item.type}
            </span>
            {criterionStatus && (
              <span className="text-[11px] text-muted-foreground">
                {verificationLabels[criterionStatus]}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-sm font-medium leading-5">
            {item.title}
          </p>
        </div>
        <PlanItemActionsMenu
          item={item}
          bundle={bundle}
          triggerLabel="Review"
          onReviewAction={onReviewAction}
          onCorrect={onCorrect}
          onAddEvidence={onAddEvidence}
          onVerifyCriterion={onVerifyCriterion}
          onWaiveCriterion={onWaiveCriterion}
          pending={pending}
        />
      </div>
    </div>
  );
}

function PlanItemActionsMenu({
  item,
  bundle,
  triggerLabel,
  onReviewAction,
  onCorrect,
  onAddEvidence,
  onVerifyCriterion,
  onWaiveCriterion,
  pending,
}: {
  item: ContractItem;
  bundle: ContractBundle;
  triggerLabel?: string;
  onReviewAction: (item: ContractItem, action: ReviewAction) => void;
  onCorrect: (item: ContractItem) => void;
  onAddEvidence: (item: ContractItem) => void;
  onVerifyCriterion: (item: ContractItem) => void;
  onWaiveCriterion: (item: ContractItem) => void;
  pending: boolean;
}) {
  const isCriterion = item.type === "acceptance_criterion";
  const hasTrustedEvidence = evidenceForItem(item.id, bundle.evidence).some(
    isTrustedEvidence,
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant={triggerLabel ? "outline" : "ghost"}
          disabled={pending}
          className={triggerLabel ? "h-8 shrink-0 px-2.5" : "h-8 w-8 shrink-0"}
        >
          {triggerLabel ? (
            triggerLabel
          ) : (
            <>
              <IconDots className="h-4 w-4" />
              <span className="sr-only">Plan item actions</span>
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!isCriterion && (
          <>
            <DropdownMenuItem onClick={() => onReviewAction(item, "accepted")}>
              <IconCheck className="h-4 w-4" />
              Accept
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCorrect(item)}>
              <IconEdit className="h-4 w-4" />
              Correct
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onReviewAction(item, "rejected")}>
              <IconX className="h-4 w-4" />
              Reject
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onReviewAction(item, "needs_evidence")}
            >
              <IconEyeCheck className="h-4 w-4" />
              Require evidence
            </DropdownMenuItem>
          </>
        )}
        {isCriterion && (
          <>
            <DropdownMenuItem onClick={() => onAddEvidence(item)}>
              <IconEyeCheck className="h-4 w-4" />
              Add evidence
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!hasTrustedEvidence}
              onClick={() => onVerifyCriterion(item)}
            >
              <IconShieldCheck className="h-4 w-4" />
              Mark verified
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onReviewAction(item, "needs_evidence")}
            >
              <IconMessageCircle className="h-4 w-4" />
              Request proof
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onWaiveCriterion(item)}>
              <IconCircleX className="h-4 w-4" />
              Waive
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProofMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-2 py-2">
      <p className="font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-muted-foreground">{label}</p>
    </div>
  );
}

function PlanSectionIcon({ id }: { id: PlanSectionId }) {
  if (id === "approach") return <IconRoute className="h-4 w-4" />;
  if (id === "assumptions") return <IconBulb className="h-4 w-4" />;
  if (id === "proof") return <IconListCheck className="h-4 w-4" />;
  return <IconGitBranch className="h-4 w-4" />;
}

function PlanClauseIcon({ item }: { item: ContractItem }) {
  if (item.type === "task") return <IconSubtask className="h-3.5 w-3.5" />;
  if (item.type === "decision")
    return <IconCircleCheck className="h-3.5 w-3.5" />;
  if (item.type === "constraint") return <IconStack className="h-3.5 w-3.5" />;
  if (item.type === "acceptance_criterion") {
    return <IconShieldCheck className="h-3.5 w-3.5" />;
  }
  if (item.type === "deviation" || item.type === "amendment") {
    return <IconGitBranch className="h-3.5 w-3.5" />;
  }
  if (item.type === "open_question") {
    return <IconInfoCircle className="h-3.5 w-3.5" />;
  }
  return <IconCircleDot className="h-3.5 w-3.5" />;
}

function buildPlanSections(bundle: ContractBundle): PlanSectionModel[] {
  return [
    {
      id: "approach",
      title: "Approved approach",
      description: "Decisions, constraints, and implementation tasks",
      emptyLabel: "No approach clauses recorded",
      items: bundle.items.filter((item) =>
        ["decision", "constraint", "task"].includes(item.type),
      ),
    },
    {
      id: "assumptions",
      title: "Assumptions & questions",
      description: "Material assumptions the agent is relying on",
      emptyLabel: "No assumptions or questions recorded",
      items: bundle.items.filter((item) =>
        ["assumption", "open_question", "risk"].includes(item.type),
      ),
    },
    {
      id: "proof",
      title: "Acceptance criteria",
      description: "Requirements that need evidence before completion",
      emptyLabel: "No acceptance criteria recorded",
      items: bundle.items.filter(
        (item) => item.type === "acceptance_criterion",
      ),
    },
    {
      id: "changes",
      title: "Amendments & deviations",
      description: "Changes from the approved plan",
      emptyLabel: "No amendments or deviations recorded",
      items: bundle.items.filter((item) =>
        ["amendment", "deviation"].includes(item.type),
      ),
    },
  ];
}

function itemNeedsAttention(item: ContractItem, bundle: ContractBundle) {
  if (
    item.reviewState === "unreviewed" ||
    item.reviewState === "needs_evidence" ||
    item.reviewState === "rejected"
  ) {
    return true;
  }
  if (item.type !== "acceptance_criterion") return false;
  const status = proofStatus(item, bundle);
  return (
    status === "missing" || status === "failed" || status === "inconclusive"
  );
}

function sectionAttentionCount(items: ContractItem[], bundle: ContractBundle) {
  return items.filter((item) => itemNeedsAttention(item, bundle)).length;
}

function ReviewInbox({
  bundle,
  filter,
  filteredQueue,
  onFilterChange,
  onReviewAction,
  onCorrect,
  onAddEvidence,
  onVerifyCriterion,
  onWaiveCriterion,
  pending,
}: {
  bundle: ContractBundle;
  filter: ReviewFilter;
  filteredQueue: ContractItem[];
  onFilterChange: (filter: ReviewFilter) => void;
  onReviewAction: (item: ContractItem, action: ReviewAction) => void;
  onCorrect: (item: ContractItem) => void;
  onAddEvidence: (item: ContractItem) => void;
  onVerifyCriterion: (item: ContractItem) => void;
  onWaiveCriterion: (item: ContractItem) => void;
  pending: boolean;
}) {
  return (
    <section className="px-4 py-5 lg:px-5">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Review queue</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {filteredQueue.length} item{filteredQueue.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-md border border-border bg-muted/40 p-1">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => onFilterChange(item.value)}
                className={cn(
                  "h-8 shrink-0 rounded px-2.5 text-xs font-medium transition-colors",
                  filter === item.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {filteredQueue.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
              <IconCircleCheck className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">Nothing needs review</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Details and proof history are available from the top bar.
              </p>
            </div>
          ) : (
            filteredQueue.map((item) => (
              <ReviewItemCard
                key={item.id}
                item={item}
                bundle={bundle}
                onReviewAction={onReviewAction}
                onCorrect={onCorrect}
                onAddEvidence={onAddEvidence}
                onVerifyCriterion={onVerifyCriterion}
                onWaiveCriterion={onWaiveCriterion}
                pending={pending}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ReviewItemCard({
  item,
  bundle,
  onReviewAction,
  onCorrect,
  onAddEvidence,
  onVerifyCriterion,
  onWaiveCriterion,
  pending,
}: {
  item: ContractItem;
  bundle: ContractBundle;
  onReviewAction: (item: ContractItem, action: ReviewAction) => void;
  onCorrect: (item: ContractItem) => void;
  onAddEvidence: (item: ContractItem) => void;
  onVerifyCriterion: (item: ContractItem) => void;
  onWaiveCriterion: (item: ContractItem) => void;
  pending: boolean;
}) {
  const isCriterion = item.type === "acceptance_criterion";
  const itemEvidence = evidenceForItem(item.id, bundle.evidence);
  const hasTrustedEvidence = itemEvidence.some(isTrustedEvidence);
  const criterionStatus = isCriterion ? proofStatus(item, bundle) : undefined;
  const needsAttention =
    item.reviewState === "unreviewed" ||
    item.reviewState === "needs_evidence" ||
    criterionStatus === "missing" ||
    criterionStatus === "failed";
  return (
    <article
      className={cn(
        "rounded-md border bg-background p-3 transition-colors hover:bg-muted/20",
        needsAttention ? "border-border shadow-sm" : "border-border/70",
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="border-border bg-muted/40 text-muted-foreground"
            >
              {itemTypeLabels[item.type] ?? item.type}
            </Badge>
            {shouldShowRisk(item.risk) && (
              <Badge variant="outline" className={riskClass(item.risk)}>
                {sentence(item.risk)}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={reviewStateClass(item.reviewState)}
            >
              {reviewStateLabels[item.reviewState]}
            </Badge>
            {criterionStatus && (
              <Badge
                variant="outline"
                className={verificationClass(criterionStatus)}
              >
                {verificationLabels[criterionStatus]}
              </Badge>
            )}
          </div>
          <div>
            <h3 className="break-words text-sm font-semibold leading-6">
              {item.title}
            </h3>
            {item.body && item.body !== item.title && (
              <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">
                {item.body}
              </p>
            )}
            {item.impactSummary && (
              <p className="mt-2 max-w-3xl break-words text-xs leading-5 text-muted-foreground">
                Impact: {item.impactSummary}
              </p>
            )}
            {itemEvidence.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {itemEvidence.length} evidence artifact
                {itemEvidence.length === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </div>
        <ReviewActions
          item={item}
          isCriterion={isCriterion}
          hasTrustedEvidence={hasTrustedEvidence}
          onReviewAction={onReviewAction}
          onCorrect={onCorrect}
          onAddEvidence={onAddEvidence}
          onVerifyCriterion={onVerifyCriterion}
          onWaiveCriterion={onWaiveCriterion}
          pending={pending}
        />
      </div>
    </article>
  );
}

function ReviewActions({
  item,
  isCriterion,
  hasTrustedEvidence,
  onReviewAction,
  onCorrect,
  onAddEvidence,
  onVerifyCriterion,
  onWaiveCriterion,
  pending,
}: {
  item: ContractItem;
  isCriterion: boolean;
  hasTrustedEvidence: boolean;
  onReviewAction: (item: ContractItem, action: ReviewAction) => void;
  onCorrect: (item: ContractItem) => void;
  onAddEvidence: (item: ContractItem) => void;
  onVerifyCriterion: (item: ContractItem) => void;
  onWaiveCriterion: (item: ContractItem) => void;
  pending: boolean;
}) {
  const criterionPrimary = hasTrustedEvidence ? "verify" : "evidence";
  return (
    <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
      {!isCriterion && (
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => onCorrect(item)}
          >
            <IconEdit className="h-4 w-4" />
            Correct
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => onReviewAction(item, "accepted")}
          >
            <IconCheck className="h-4 w-4" />
            Accept
          </Button>
        </>
      )}
      {isCriterion && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            criterionPrimary === "verify"
              ? onVerifyCriterion(item)
              : onAddEvidence(item)
          }
        >
          {criterionPrimary === "verify" ? (
            <IconShieldCheck className="h-4 w-4" />
          ) : (
            <IconEyeCheck className="h-4 w-4" />
          )}
          {criterionPrimary === "verify" ? "Verify" : "Evidence"}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" disabled={pending}>
            <IconDots className="h-4 w-4" />
            <span className="sr-only">More actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!isCriterion && (
            <DropdownMenuItem onClick={() => onReviewAction(item, "rejected")}>
              <IconX className="h-4 w-4" />
              Reject
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => onReviewAction(item, "needs_evidence")}
          >
            <IconEyeCheck className="h-4 w-4" />
            Require evidence
          </DropdownMenuItem>
          {isCriterion && (
            <>
              {hasTrustedEvidence && (
                <DropdownMenuItem onClick={() => onAddEvidence(item)}>
                  <IconEyeCheck className="h-4 w-4" />
                  Add evidence
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={!hasTrustedEvidence}
                onClick={() => onVerifyCriterion(item)}
              >
                <IconShieldCheck className="h-4 w-4" />
                Mark verified
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onWaiveCriterion(item)}>
                <IconCircleX className="h-4 w-4" />
                Waive
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ContractDetailsSheet({
  bundle,
  open,
  onOpenChange,
  onAddEvidence,
  onRequestProof,
  onVerifyCriterion,
  onWaiveCriterion,
  pending,
}: {
  bundle: ContractBundle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddEvidence: (item: ContractItem) => void;
  onRequestProof: (item: ContractItem) => void;
  onVerifyCriterion: (item: ContractItem) => void;
  onWaiveCriterion: (item: ContractItem) => void;
  pending: boolean;
}) {
  const criteria = bundle.items.filter(
    (item) => item.type === "acceptance_criterion",
  );
  const ledgerItems = bundle.items.filter(
    (item) => item.type !== "acceptance_criterion",
  );
  const report = useMemo(() => finalReport(bundle), [bundle]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        <div className="p-5">
          <SheetHeader>
            <SheetTitle>Evidence & history</SheetTitle>
            <SheetDescription>
              {bundle.contract.title} / {finalStatus(bundle)}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-5 rounded-md border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Final report</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Assumptions, criteria, evidence, and recent activity.
                </p>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  report.missingEvidence > 0
                    ? verificationClass("missing")
                    : verificationClass("verified"),
                )}
              >
                {report.missingEvidence > 0 ? "Needs proof" : "Ready"}
              </Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <ReportMetric
                label="Accepted"
                value={report.acceptedAssumptions}
              />
              <ReportMetric
                label="Corrected"
                value={report.correctedAssumptions}
              />
              <ReportMetric label="Verified" value={report.verifiedCriteria} />
              <ReportMetric label="Missing" value={report.missingEvidence} />
            </div>
          </div>

          <Separator className="my-5" />

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Acceptance Criteria</h2>
              <Badge variant="outline">{criteria.length}</Badge>
            </div>
            {criteria.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-background px-3 py-6 text-center text-sm text-muted-foreground">
                No criteria recorded
              </div>
            ) : (
              criteria.map((criterion) => {
                const status = proofStatus(criterion, bundle);
                const linkedEvidence = evidenceForItem(
                  criterion.id,
                  bundle.evidence,
                );
                const hasTrustedEvidence =
                  linkedEvidence.some(isTrustedEvidence);
                return (
                  <article
                    key={criterion.id}
                    className="rounded-md border border-border bg-background p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Badge
                          variant="outline"
                          className={verificationClass(status)}
                        >
                          {verificationLabels[status]}
                        </Badge>
                        <p className="mt-2 break-words text-sm font-medium leading-6">
                          {criterion.title}
                        </p>
                        {linkedEvidence.length > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {linkedEvidence.length} evidence artifact
                            {linkedEvidence.length === 1 ? "" : "s"}
                          </p>
                        )}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" disabled={pending}>
                            <IconDots className="h-4 w-4" />
                            <span className="sr-only">Criterion actions</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => onAddEvidence(criterion)}
                          >
                            <IconEyeCheck className="h-4 w-4" />
                            Add evidence
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!hasTrustedEvidence}
                            onClick={() => onVerifyCriterion(criterion)}
                          >
                            <IconShieldCheck className="h-4 w-4" />
                            Mark verified
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onRequestProof(criterion)}
                          >
                            <IconMessageCircle className="h-4 w-4" />
                            Request proof
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onWaiveCriterion(criterion)}
                          >
                            <IconCircleX className="h-4 w-4" />
                            Waive
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </article>
                );
              })
            )}
          </section>

          <Separator className="my-5" />

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Assumptions</h2>
              <Badge variant="outline">{ledgerItems.length}</Badge>
            </div>
            {ledgerItems.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-background px-3 py-6 text-center text-sm text-muted-foreground">
                No assumptions recorded
              </div>
            ) : (
              ledgerItems.slice(0, 12).map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-border bg-background p-3"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    {shouldShowRisk(item.risk) && (
                      <Badge variant="outline" className={riskClass(item.risk)}>
                        {sentence(item.risk)}
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={reviewStateClass(item.reviewState)}
                    >
                      {reviewStateLabels[item.reviewState]}
                    </Badge>
                  </div>
                  <p className="mt-2 break-words text-sm font-medium leading-6">
                    {item.title}
                  </p>
                </div>
              ))
            )}
          </section>

          <Separator className="my-5" />

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Evidence</h2>
              <Badge variant="outline">{bundle.evidence.length}</Badge>
            </div>
            {bundle.evidence.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-background px-3 py-6 text-center text-sm text-muted-foreground">
                No evidence attached
              </div>
            ) : (
              bundle.evidence.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-border bg-background p-3"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{sentence(item.type)}</Badge>
                    <Badge
                      variant="outline"
                      className={
                        isTrustedEvidence(item)
                          ? verificationClass("verified")
                          : verificationClass("inconclusive")
                      }
                    >
                      {sentence(item.trustLevel)}
                    </Badge>
                  </div>
                  <p className="mt-2 break-words text-sm font-medium">
                    {item.summary}
                  </p>
                  {item.command && (
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {item.command}
                    </p>
                  )}
                </div>
              ))
            )}
          </section>

          <Separator className="my-5" />

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">History</h2>
            <div className="space-y-2">
              {bundle.events
                .slice(-8)
                .reverse()
                .map((event) => (
                  <div
                    key={event.id}
                    className="rounded-md border border-border bg-background px-3 py-2"
                  >
                    <p className="break-words text-sm">{event.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {shortDate(event.createdAt)}
                    </p>
                  </div>
                ))}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ReportMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function assumptionSummary(bundle: ContractBundle) {
  const assumptions = bundle.items.filter((item) => item.type === "assumption");
  return {
    accepted: assumptions.filter((item) => item.reviewState === "accepted")
      .length,
    corrected: assumptions.filter((item) => item.reviewState === "corrected")
      .length,
  };
}

function finalReport(bundle: ContractBundle) {
  const assumptions = bundle.items.filter((item) => item.type === "assumption");
  const criteria = bundle.items.filter(
    (item) => item.type === "acceptance_criterion",
  );
  const deviations = bundle.items.filter((item) => item.type === "deviation");
  return {
    acceptedAssumptions: assumptions.filter(
      (item) => item.reviewState === "accepted",
    ).length,
    correctedAssumptions: assumptions.filter(
      (item) => item.reviewState === "corrected",
    ).length,
    unresolvedHighRisk: assumptions.filter(
      (item) =>
        (item.risk === "high" || item.risk === "critical") &&
        item.reviewState === "unreviewed",
    ).length,
    verifiedCriteria: criteria.filter(
      (item) => proofStatus(item, bundle) === "verified",
    ).length,
    missingEvidence: criteria.filter(
      (item) => proofStatus(item, bundle) === "missing",
    ).length,
    deviations: deviations.length,
  };
}

function CreateContractDialog({
  open,
  onOpenChange,
  onCreate,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    title: string;
    goal: string;
    repoPath: string;
    source: ContractSource;
    planText: string;
  }) => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [source, setSource] = useState<ContractSource>("codex");
  const [planText, setPlanText] = useState("");

  useEffect(() => {
    if (open) return;
    setTitle("");
    setGoal("");
    setRepoPath("");
    setSource("codex");
    setPlanText("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Visual Plan</DialogTitle>
          <DialogDescription>
            Create a visual review surface for an agent run.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="contract-title">Title</Label>
            <Input
              id="contract-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Invite limits plan"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="contract-goal">Goal</Label>
            <Textarea
              id="contract-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Implement invite limits with billing-safe behavior and verified tests."
              className="min-h-24"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_180px]">
            <div className="grid gap-2">
              <Label htmlFor="contract-repo">Repo path</Label>
              <Input
                id="contract-repo"
                value={repoPath}
                onChange={(event) => setRepoPath(event.target.value)}
                placeholder="/path/to/repo"
              />
            </div>
            <div className="grid gap-2">
              <Label>Source</Label>
              <Select
                value={source}
                onValueChange={(value) => setSource(value as ContractSource)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="contract-plan">Plan text</Label>
            <Textarea
              id="contract-plan"
              value={planText}
              onChange={(event) => setPlanText(event.target.value)}
              placeholder="Paste an agent plan, TODO list, or notes to visualize."
              className="min-h-40 font-mono text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() =>
              onCreate({ title, goal, repoPath, source, planText })
            }
            disabled={pending || !goal.trim()}
          >
            <IconPlus className="h-4 w-4" />
            Create Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CorrectItemDialog({
  item,
  onOpenChange,
  onSubmit,
  pending,
}: {
  item: ContractItem | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    item: ContractItem;
    title: string;
    body: string;
    message: string;
  }) => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!item) return;
    setTitle(item.title);
    setBody(item.body);
    setMessage("");
  }, [item]);

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Correct Plan Item</DialogTitle>
          <DialogDescription>
            Send structured feedback for the agent to consume.
          </DialogDescription>
        </DialogHeader>
        {item && (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="correction-title">Title</Label>
              <Input
                id="correction-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="correction-body">Body</Label>
              <Textarea
                id="correction-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-32"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="correction-message">Feedback</Label>
              <Textarea
                id="correction-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Use the organization plan field instead of Stripe quantity."
                className="min-h-24"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() =>
              item && onSubmit({ item, title, body, message: message.trim() })
            }
            disabled={pending || !item || !title.trim()}
          >
            <IconEdit className="h-4 w-4" />
            Send Correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EvidenceDialog({
  item,
  onOpenChange,
  onSubmit,
  pending,
}: {
  item: ContractItem | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    item: ContractItem;
    summary: string;
    content: string;
  }) => void;
  pending: boolean;
}) {
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!item) return;
    setSummary("");
    setContent("");
  }, [item]);

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add Proof</DialogTitle>
          <DialogDescription>
            Attach a human-confirmed artifact to this item.
          </DialogDescription>
        </DialogHeader>
        {item && (
          <div className="grid gap-4">
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <p className="break-words text-sm font-medium">{item.title}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="evidence-summary">Summary</Label>
              <Input
                id="evidence-summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="Test run passed locally"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="evidence-content">Artifact</Label>
              <Textarea
                id="evidence-content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="Command output, notes, link, or excerpt."
                className="min-h-32 font-mono text-xs"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => item && onSubmit({ item, summary, content })}
            disabled={pending || !item || !summary.trim()}
          >
            <IconEyeCheck className="h-4 w-4" />
            Attach
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyContracts({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="w-full max-w-xl rounded-md border border-border bg-background p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <IconClipboardCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight">
            No visual plans
          </h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Create a visual plan from a goal, pasted plan, or agent run.
          </p>
          <Button className="mt-4" onClick={onCreate}>
            <IconPlus className="h-4 w-4" />
            New Visual Plan
          </Button>
        </div>
      </div>
    </div>
  );
}

function ContractsSkeleton() {
  return (
    <div className="contracts-dashboard h-full min-h-0">
      <div className="contracts-grid grid min-h-0 grid-cols-1">
        <div className="border-r border-border p-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="mb-2 h-24 w-full" />
          ))}
        </div>
        <ContractDetailSkeleton />
      </div>
    </div>
  );
}

function ContractDetailSkeleton() {
  return (
    <div className="p-4 lg:p-5">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-3/4" />
      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
      <Skeleton className="mt-6 h-32 w-full" />
      <Skeleton className="mt-3 h-32 w-full" />
    </div>
  );
}
