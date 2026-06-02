import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import type {
  ContractBundle,
  ContractItemType,
  ContractSource,
  ContractSummary,
  CreatedBy,
  RiskLevel,
  ReviewState,
  ActedOnState,
  EvidenceSource,
  EvidenceType,
  TrustLevel,
  VerificationStatus,
  VerifiedBy,
  FeedbackKind,
  ContractStatus,
} from "@shared/types";

export type ContractItemInput = {
  id?: string;
  type: ContractItemType;
  title: string;
  body?: string;
  status?: string;
  risk?: RiskLevel;
  reviewState?: ReviewState;
  actedOn?: ActedOnState;
  impactSummary?: string;
  affectedFiles?: string[];
  sourceRefs?: string[];
  linkedItemIds?: string[];
  createdBy?: CreatedBy;
};

export type ContractFeedbackInput = {
  id?: string;
  targetItemId?: string;
  kind: FeedbackKind;
  message: string;
  structuredPatch?: Record<string, unknown>;
};

export type CreateContractInput = {
  title?: string;
  goal: string;
  source?: ContractSource;
  repoPath?: string;
  currentPhase?: string;
  items?: ContractItemInput[];
};

export type EvidenceInput = {
  id?: string;
  linkedItemIds: string[];
  type: EvidenceType;
  source: EvidenceSource;
  trustLevel: TrustLevel;
  summary: string;
  content?: string;
  rawOutputPath?: string;
  cwd?: string;
  command?: string;
  exitCode?: number;
  timestamp?: string;
  attachedBy?: string;
};

export type VerificationInput = {
  criterionItemId: string;
  evidenceIds?: string[];
  status: VerificationStatus;
  verifiedBy?: VerifiedBy;
  note?: string;
};

function useContractInvalidation() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["action", "list-contracts"] });
    void qc.invalidateQueries({ queryKey: ["action", "get-contract"] });
    void qc.invalidateQueries({ queryKey: ["action", "get-review-queue"] });
    void qc.invalidateQueries({ queryKey: ["action", "get-feedback"] });
  };
}

function showActionError(message: string) {
  return (error: Error) => {
    toast.error(
      error.message
        ? error.message.replace(/^Action [\w-]+ failed:\s*/, "")
        : message,
    );
  };
}

export function useContracts() {
  return useActionQuery<ContractSummary[]>("list-contracts", {});
}

export function useContract(id?: string) {
  return useActionQuery<ContractBundle>(
    "get-contract",
    { id: id ?? "" },
    {
      enabled: !!id,
      refetchInterval: 3_000,
    },
  );
}

export function useCreateContract() {
  const invalidate = useContractInvalidation();
  return useActionMutation<
    ContractBundle & { path?: string; url?: string },
    CreateContractInput
  >("create-contract", {
    onSuccess: invalidate,
    onError: showActionError("Failed to create contract"),
  });
}

export function useAnalyzePlan() {
  const invalidate = useContractInvalidation();
  return useActionMutation<
    ContractBundle,
    { contractId: string; planText: string }
  >("analyze-plan", {
    onSuccess: invalidate,
    onError: showActionError("Failed to analyze plan"),
  });
}

export function useUpdateContractItems() {
  const invalidate = useContractInvalidation();
  return useActionMutation<
    ContractBundle,
    {
      contractId: string;
      items?: ContractItemInput[];
      feedback?: ContractFeedbackInput[];
    }
  >("upsert-contract-items", {
    onSuccess: invalidate,
    onError: showActionError("Failed to update contract"),
  });
}

export function useRecordProgress() {
  const invalidate = useContractInvalidation();
  return useActionMutation<
    ContractBundle,
    {
      contractId: string;
      status?: ContractStatus;
      currentPhase?: string;
      items?: ContractItemInput[];
      consumedFeedbackIds?: string[];
      note?: string;
    }
  >("record-progress", {
    onSuccess: invalidate,
    onError: showActionError("Failed to record progress"),
  });
}

export function useRecordEvidence() {
  const invalidate = useContractInvalidation();
  return useActionMutation<
    ContractBundle,
    {
      contractId: string;
      evidence?: EvidenceInput[];
      verifications?: VerificationInput[];
    }
  >("record-evidence", {
    onSuccess: invalidate,
    onError: showActionError("Failed to record evidence"),
  });
}

export function useExportContract(contractId?: string) {
  return useActionQuery<{ markdown: string; json: ContractBundle }>(
    "export-contract",
    { contractId: contractId ?? "" },
    { enabled: false },
  );
}
