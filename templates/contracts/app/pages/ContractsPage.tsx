import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconCircleCheck,
  IconCircleX,
  IconClipboardCheck,
  IconDots,
  IconEdit,
  IconEyeCheck,
  IconFileExport,
  IconMessageCircle,
  IconPlus,
  IconRefresh,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
    case "high":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "medium":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    default:
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
}

function reviewStateClass(state: ReviewState) {
  switch (state) {
    case "accepted":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "corrected":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "rejected":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    case "waived":
      return "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300";
    case "needs_evidence":
      return "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300";
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
}

function statusClass(status: string) {
  switch (status) {
    case "complete":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "blocked":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    case "implementing":
    case "verifying":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "approved":
      return "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300";
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
}

function verificationClass(status: VerificationStatus) {
  switch (status) {
    case "verified":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    case "waived":
      return "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300";
    case "evidence_attached":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "inconclusive":
      return "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300";
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
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

  useSetPageTitle("Needs Review");

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
          <TooltipContent>Refresh contracts</TooltipContent>
        </Tooltip>
        <Button
          onClick={() => setCreateOpen(true)}
          size="sm"
          className="shrink-0"
        >
          <IconPlus className="h-4 w-4" />
          <span className="hidden sm:inline">New Contract</span>
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
      toast.error("Contract not found");
      navigate("/", { replace: true });
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
      title: input.title || "Untitled contract",
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
    navigate(`/contracts/${contractId}`);
    setCreateOpen(false);
    toast.success("Contract created");
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
          note: "Verified in Contracts UI.",
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
          note: "Waived in Contracts UI.",
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
      note: "Contract approved for implementation.",
    });
    toast.success("Contract approved");
  }

  async function handleExport() {
    const result = await exportContract.refetch();
    if (!result.data) return;
    await navigator.clipboard.writeText(result.data.markdown);
    toast.success("Markdown receipt copied");
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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
        <ContractsList contracts={contracts} selectedId={selectedId} />

        <section className="min-w-0 overflow-y-auto">
          {bundle ? (
            <>
              <ContractTopBar
                bundle={bundle}
                onApprove={handleApproveContract}
                onExport={handleExport}
                approving={recordProgress.isPending}
                exporting={exportContract.isFetching}
              />
              <ReviewInbox
                bundle={bundle}
                filter={filter}
                filteredQueue={filteredQueue}
                onFilterChange={setFilter}
                onReviewAction={handleReviewAction}
                onCorrect={setCorrectionTarget}
                onAddEvidence={setEvidenceTarget}
                onVerifyCriterion={handleVerifyCriterion}
                onWaiveCriterion={handleWaiveCriterion}
                pending={
                  updateItems.isPending ||
                  recordEvidence.isPending ||
                  recordProgress.isPending
                }
              />
              <AssumptionLedger
                bundle={bundle}
                onReviewAction={handleReviewAction}
                onCorrect={setCorrectionTarget}
                pending={updateItems.isPending}
              />
            </>
          ) : (
            <ContractDetailSkeleton />
          )}
        </section>

        <aside className="min-h-0 border-t border-border bg-muted/20 lg:border-l lg:border-t-0">
          {bundle ? (
            <ProofPanel
              bundle={bundle}
              onAddEvidence={setEvidenceTarget}
              onRequestProof={(item) =>
                handleReviewAction(item, "needs_evidence")
              }
              onVerifyCriterion={handleVerifyCriterion}
              onWaiveCriterion={handleWaiveCriterion}
              pending={updateItems.isPending || recordEvidence.isPending}
            />
          ) : (
            <div className="p-4">
              <Skeleton className="h-28 w-full" />
            </div>
          )}
        </aside>
      </div>

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
}: {
  contracts: ContractSummary[];
  selectedId?: string;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-b border-border bg-muted/20 lg:border-b-0 lg:border-r">
      <div className="flex h-12 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <IconClipboardCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">Contracts</span>
        </div>
        <Badge variant="outline" className="shrink-0">
          {contracts.length}
        </Badge>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          {contracts.map((contract) => (
            <Link
              key={contract.id}
              to={`/contracts/${contract.id}`}
              className={cn(
                "block rounded-md border px-3 py-2.5 text-left transition-colors",
                selectedId === contract.id
                  ? "border-foreground/20 bg-background shadow-sm"
                  : "border-transparent hover:border-border hover:bg-background/70",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {contract.title}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {contract.goal}
                  </p>
                </div>
                <IconChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={cn("text-[11px]", statusClass(contract.status))}
                >
                  {sentence(contract.status)}
                </Badge>
                {contract.reviewCount > 0 && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-300"
                  >
                    {contract.reviewCount} review
                  </Badge>
                )}
                {contract.missingEvidenceCount > 0 && (
                  <Badge
                    variant="outline"
                    className="border-violet-500/30 bg-violet-500/10 text-[11px] text-violet-700 dark:text-violet-300"
                  >
                    {contract.missingEvidenceCount} proof
                  </Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}

function ContractTopBar({
  bundle,
  onApprove,
  onExport,
  approving,
  exporting,
}: {
  bundle: ContractBundle;
  onApprove: () => void;
  onExport: () => void;
  approving: boolean;
  exporting: boolean;
}) {
  const assumptionCounts = useMemo(() => assumptionSummary(bundle), [bundle]);
  return (
    <div className="border-b border-border px-4 py-4 lg:px-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words text-xl font-semibold tracking-tight">
              {bundle.contract.title}
            </h1>
            <Badge
              variant="outline"
              className={cn("shrink-0", statusClass(bundle.contract.status))}
            >
              {sentence(bundle.contract.status)}
            </Badge>
            <Badge variant="outline" className="shrink-0">
              {SOURCE_OPTIONS.find(
                (item) => item.value === bundle.contract.source,
              )?.label ?? bundle.contract.source}
            </Badge>
          </div>
          <p className="max-w-3xl break-words text-sm leading-6 text-muted-foreground">
            {bundle.contract.goal}
          </p>
          {bundle.contract.repoPath && (
            <p className="truncate text-xs text-muted-foreground">
              {bundle.contract.repoPath}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={exporting}
          >
            <IconFileExport className="h-4 w-4" />
            Export
          </Button>
          {bundle.contract.status === "review" && (
            <Button size="sm" onClick={onApprove} disabled={approving}>
              <IconCheck className="h-4 w-4" />
              Approve
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCell
          label="Needs review"
          value={bundle.summary.reviewCount}
          icon={<IconAlertTriangle className="h-4 w-4" />}
        />
        <SummaryCell
          label="Corrected"
          value={assumptionCounts.corrected}
          icon={<IconEdit className="h-4 w-4" />}
        />
        <SummaryCell
          label="Verified"
          value={bundle.summary.verifiedCount}
          icon={<IconShieldCheck className="h-4 w-4" />}
        />
        <SummaryCell
          label="Missing proof"
          value={bundle.summary.missingEvidenceCount}
          icon={<IconEyeCheck className="h-4 w-4" />}
        />
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex min-h-16 items-center gap-3 rounded-md border border-border bg-background px-3 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
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
    <section className="border-b border-border px-4 py-4 lg:px-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Needs Review</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {filteredQueue.length} item{filteredQueue.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-md bg-muted p-1">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onFilterChange(item.value)}
              className={cn(
                "h-8 shrink-0 rounded px-2.5 text-xs font-medium transition-colors",
                filter === item.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {filteredQueue.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
            <IconCircleCheck className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-400" />
            <p className="mt-3 text-sm font-medium">No open review items</p>
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
  return (
    <article className="rounded-md border border-border bg-background p-3 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">
              {itemTypeLabels[item.type] ?? item.type}
            </Badge>
            <Badge variant="outline" className={riskClass(item.risk)}>
              {sentence(item.risk)}
            </Badge>
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
              <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                Impact: {item.impactSummary}
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
  return (
    <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
      {!isCriterion && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onReviewAction(item, "accepted")}
          >
            <IconCheck className="h-4 w-4" />
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onCorrect(item)}
          >
            <IconEdit className="h-4 w-4" />
            Correct
          </Button>
        </>
      )}
      {isCriterion && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onAddEvidence(item)}
          >
            <IconEyeCheck className="h-4 w-4" />
            Evidence
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !hasTrustedEvidence}
            onClick={() => onVerifyCriterion(item)}
          >
            <IconShieldCheck className="h-4 w-4" />
            Verify
          </Button>
        </>
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
            <DropdownMenuItem onClick={() => onWaiveCriterion(item)}>
              <IconCircleX className="h-4 w-4" />
              Waive
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AssumptionLedger({
  bundle,
  onReviewAction,
  onCorrect,
  pending,
}: {
  bundle: ContractBundle;
  onReviewAction: (item: ContractItem, action: ReviewAction) => void;
  onCorrect: (item: ContractItem) => void;
  pending: boolean;
}) {
  const ledgerItems = bundle.items.filter(
    (item) => item.type !== "acceptance_criterion",
  );
  return (
    <section className="px-4 py-4 lg:px-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Assumption Ledger</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {ledgerItems.length} reviewable item
            {ledgerItems.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-md border border-border">
        {ledgerItems.length === 0 ? (
          <div className="bg-background px-4 py-8 text-center text-sm text-muted-foreground">
            No assumptions recorded
          </div>
        ) : (
          ledgerItems.map((item, index) => (
            <div
              key={item.id}
              className={cn(
                "flex flex-col gap-3 bg-background px-3 py-3 md:flex-row md:items-center md:justify-between",
                index > 0 && "border-t border-border",
              )}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">
                    {itemTypeLabels[item.type] ?? item.type}
                  </Badge>
                  <Badge variant="outline" className={riskClass(item.risk)}>
                    {sentence(item.risk)}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={reviewStateClass(item.reviewState)}
                  >
                    {reviewStateLabels[item.reviewState]}
                  </Badge>
                </div>
                <p className="mt-2 break-words text-sm font-medium">
                  {item.title}
                </p>
                {item.impactSummary && (
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {item.impactSummary}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => onReviewAction(item, "accepted")}
                >
                  <IconCheck className="h-4 w-4" />
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => onCorrect(item)}
                >
                  <IconEdit className="h-4 w-4" />
                  Correct
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ProofPanel({
  bundle,
  onAddEvidence,
  onRequestProof,
  onVerifyCriterion,
  onWaiveCriterion,
  pending,
}: {
  bundle: ContractBundle;
  onAddEvidence: (item: ContractItem) => void;
  onRequestProof: (item: ContractItem) => void;
  onVerifyCriterion: (item: ContractItem) => void;
  onWaiveCriterion: (item: ContractItem) => void;
  pending: boolean;
}) {
  const criteria = bundle.items.filter(
    (item) => item.type === "acceptance_criterion",
  );
  const report = useMemo(() => finalReport(bundle), [bundle]);
  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <section className="rounded-md border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {bundle.contract.title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {finalStatus(bundle)}
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
            <ReportMetric label="Accepted" value={report.acceptedAssumptions} />
            <ReportMetric
              label="Corrected"
              value={report.correctedAssumptions}
            />
            <ReportMetric label="Verified" value={report.verifiedCriteria} />
            <ReportMetric label="Missing" value={report.missingEvidence} />
          </div>
        </section>

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
              const hasTrustedEvidence = linkedEvidence.some(isTrustedEvidence);
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
    </ScrollArea>
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
          <DialogTitle>New Contract</DialogTitle>
          <DialogDescription>
            Create a local review queue for an agent run.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="contract-title">Title</Label>
            <Input
              id="contract-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Invite limits contract"
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
              placeholder="Paste an agent plan, TODO list, or draft contract."
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
            Create
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
          <DialogTitle>Correct Item</DialogTitle>
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
          <DialogTitle>Add Evidence</DialogTitle>
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
          <h1 className="text-lg font-semibold tracking-tight">No contracts</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Create a contract from a goal or pasted agent plan.
          </p>
          <Button className="mt-4" onClick={onCreate}>
            <IconPlus className="h-4 w-4" />
            New Contract
          </Button>
        </div>
      </div>
    </div>
  );
}

function ContractsSkeleton() {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
      <div className="border-r border-border p-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="mb-2 h-24 w-full" />
        ))}
      </div>
      <ContractDetailSkeleton />
      <div className="border-l border-border p-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="mt-4 h-48 w-full" />
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
