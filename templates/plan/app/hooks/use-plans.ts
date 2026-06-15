import { useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import type { RefObject } from "react";
import { toast } from "sonner";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import type { PlanMdxFolder } from "@/lib/desktop-plan-files";
import type {
  PlanAuthor,
  PlanBundle,
  PlanCommentKind,
  PlanCommentMention,
  PlanCommentResolutionTarget,
  PlanCommentStatus,
  PlanKind,
  PlanReportReason,
  PlanSectionType,
  PlanSource,
  PlanStatus,
  PlanSummary,
  PlanVersionDetail,
  PlanVersionListResponse,
} from "@shared/types";
import type { PlanContent, PlanContentPatch } from "@shared/plan-content";

export type PlanSectionInput = {
  id?: string;
  type?: PlanSectionType;
  title: string;
  body?: string;
  html?: string;
  order?: number;
  createdBy?: PlanAuthor;
};

export type PlanCommentInput = {
  id?: string;
  parentCommentId?: string;
  sectionId?: string;
  kind?: PlanCommentKind;
  status?: PlanCommentStatus;
  anchor?: string;
  message: string;
  createdBy?: PlanAuthor;
  authorEmail?: string;
  authorName?: string;
  resolutionTarget?: PlanCommentResolutionTarget;
  mentions?: PlanCommentMention[];
  resolvedBy?: string | null;
  resolvedAt?: string | null;
};

export type CreatePlanInput = {
  title?: string;
  brief?: string;
  goal?: string;
  source?: PlanSource;
  repoPath?: string;
  currentFocus?: string;
  status?: PlanStatus;
  html?: string;
  content?: PlanContent;
  contentPatches?: PlanContentPatch[];
  markdown?: string;
  sections?: PlanSectionInput[];
  comments?: PlanCommentInput[];
};

export type CreateUiPlanInput = CreatePlanInput & {
  states?: Array<{ name: string; description: string }>;
  components?: Array<{ name: string; description: string }>;
  sketchiness?: number;
  implementationNotes?: string;
};

export type CreatePrototypePlanInput = CreatePlanInput & {
  screens?: Array<{
    id?: string;
    title: string;
    summary?: string;
    surface?: "desktop" | "mobile" | "popover" | "panel" | "browser";
    renderMode?: "wireframe" | "design";
    html?: string;
    css?: string;
    state?: Array<{ id?: string; label: string; value: string }>;
  }>;
  transitions?: Array<{
    id?: string;
    from: string;
    to: string;
    label?: string;
    trigger?: string;
  }>;
  implementationNotes?: string;
};

export type CreatePlanDesignInput = CreatePrototypePlanInput & {
  designMd?: string;
  brandKit?: Record<string, unknown>;
  codebaseStyles?: Record<string, unknown>;
  designNotes?: string;
};

export type VisualQuestionOptionInput = {
  value?: string;
  label: string;
  description?: string;
  recommended?: boolean;
  preview?: "desktop" | "mobile" | "split" | "flow" | "diagram";
  bullets?: string[];
};

export type VisualQuestionInput = {
  id: string;
  type: "single" | "multi" | "freeform" | "visual";
  title: string;
  subtitle?: string;
  options?: VisualQuestionOptionInput[];
  allowOther?: boolean;
  placeholder?: string;
  required?: boolean;
};

export type CreateVisualQuestionsInput = CreatePlanInput & {
  questions?: VisualQuestionInput[];
};

export type VisualizePlanInput = {
  title?: string;
  brief?: string;
  goal?: string;
  planText: string;
  source?: PlanSource;
  repoPath?: string;
  currentFocus?: string;
};

export type UpdatePlanInput = {
  planId: string;
  title?: string;
  brief?: string;
  status?: PlanStatus;
  currentFocus?: string;
  html?: string;
  content?: PlanContent;
  contentPatches?: PlanContentPatch[];
  markdown?: string;
  sections?: PlanSectionInput[];
  comments?: PlanCommentInput[];
  consumedCommentIds?: string[];
  note?: string;
};

export type ConvertVisualPlanToPrototypeInput = {
  planId: string;
  title?: string;
  brief?: string;
  removeCanvas?: boolean;
};

export type ReportVisualPlanInput = {
  planId: string;
  reason: PlanReportReason;
  details?: string;
  pageUrl?: string;
};

export type ReportVisualPlanResult = {
  ok: true;
  reportId: string;
  duplicate: boolean;
  message: string;
};

export type DeletePlanCommentInput = {
  planId: string;
  commentId: string;
};

export type DeletePlanCommentResult = {
  planId: string;
  commentId: string;
  deletedCommentIds: string[];
  deletedCount: number;
  deletedAt: string;
};

function usePlanInvalidation() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["action", "list-visual-plans"] });
    void qc.invalidateQueries({ queryKey: ["action", "get-visual-plan"] });
    void qc.invalidateQueries({ queryKey: ["action", "get-plan-feedback"] });
    void qc.invalidateQueries({ queryKey: ["action", "list-plan-versions"] });
    void qc.invalidateQueries({ queryKey: ["action", "get-plan-version"] });
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

type UsePlansOptions = Omit<
  UseQueryOptions<PlanSummary[]>,
  "queryKey" | "queryFn"
>;

export function usePlans(options?: UsePlansOptions) {
  return useActionQuery<PlanSummary[]>("list-visual-plans", {}, options);
}

export function usePlan(
  id?: string,
  pausePollRef?: RefObject<boolean> | { current: boolean },
) {
  return useActionQuery<PlanBundle & { html?: string }>(
    "get-visual-plan",
    { id: id ?? "", includeMdx: false, includeHtml: true },
    {
      enabled: !!id,
      // Pause the 3-second poll while a comment mutation is in-flight so
      // an optimistic comment inserted into the cache isn't evicted before
      // the server write commits (Issue 4a).
      refetchInterval: (query: { state: { status: string } }) => {
        if (query.state.status === "error") return false;
        if (pausePollRef?.current) return false;
        return 3_000;
      },
    },
  );
}

export type PlanAccessStatusResponse = {
  exists: boolean;
  hasAccess: boolean;
  signedIn: boolean;
  viewerEmail: string | null;
  viewerName: string | null;
  role: "owner" | "viewer" | "editor" | "admin" | null;
  visibility: "private" | "org" | "public" | null;
};

export function usePlanAccessStatus(planId?: string, enabled = true) {
  return useActionQuery<PlanAccessStatusResponse>(
    "get-plan-access-status",
    { planId: planId ?? "" },
    {
      enabled: Boolean(planId && enabled),
      retry: false,
    },
  );
}

export type RequestPlanAccessResult = {
  ok: true;
  alreadyHasAccess: boolean;
  notifiedOwner: boolean;
  requestId?: string;
  message: string;
};

export function useRequestPlanAccess() {
  return useActionMutation<RequestPlanAccessResult, { planId: string }>(
    "request-plan-access",
    {
      onError: showActionError("Failed to request access"),
    },
  );
}

export function useCreatePlan() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<
    PlanBundle & { path?: string; url?: string; html?: string },
    CreatePlanInput
  >("create-visual-plan", {
    onSuccess: invalidate,
    onError: showActionError("Failed to create visual plan"),
  });
}

export function useCreateUiPlan() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<
    PlanBundle & { path?: string; url?: string; html?: string },
    CreateUiPlanInput
  >("create-ui-plan", {
    onSuccess: invalidate,
    onError: showActionError("Failed to create UI plan"),
  });
}

export function useCreatePrototypePlan() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<
    PlanBundle & { path?: string; url?: string; html?: string },
    CreatePrototypePlanInput
  >("create-prototype-plan", {
    onSuccess: invalidate,
    onError: showActionError("Failed to create prototype plan"),
  });
}

export function useCreatePlanDesign() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<
    PlanBundle & { path?: string; url?: string; html?: string },
    CreatePlanDesignInput
  >("create-plan-design", {
    onSuccess: invalidate,
    onError: showActionError("Failed to create plan design"),
  });
}

export function useCreateVisualQuestions() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<
    PlanBundle & { path?: string; url?: string; html?: string },
    CreateVisualQuestionsInput
  >("create-visual-questions", {
    onSuccess: invalidate,
    onError: showActionError("Failed to create visual questions"),
  });
}

export function useVisualizePlan() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<
    PlanBundle & { path?: string; url?: string; html?: string },
    VisualizePlanInput
  >("visualize-plan", {
    onSuccess: invalidate,
    onError: showActionError("Failed to import plan"),
  });
}

export function useUpdatePlan() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<PlanBundle & { html?: string }, UpdatePlanInput>(
    "update-visual-plan",
    {
      onSuccess: invalidate,
      onError: showActionError("Failed to update visual plan"),
    },
  );
}

/**
 * A separate mutation instance used exclusively for status changes
 * (draft / review / approved / in_progress / complete). Keeping it separate
 * from the prose-autosave `useUpdatePlan` instance avoids any bleed between
 * save-pending and status-pending states.
 */
export function useUpdatePlanStatus() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<PlanBundle & { html?: string }, UpdatePlanInput>(
    "update-visual-plan",
    {
      onSuccess: invalidate,
      onError: showActionError("Failed to update plan status"),
    },
  );
}

/**
 * A separate mutation instance used exclusively for comment writes
 * (reply, resolve, reopen). Keeping it separate from the prose-autosave
 * `useUpdatePlan` instance means the autosave `isPending` state cannot
 * bleed into comment button disabled states (Issue 3).
 */
export function useUpdatePlanComments() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<PlanBundle & { html?: string }, UpdatePlanInput>(
    "update-visual-plan",
    {
      onSuccess: invalidate,
      onError: showActionError("Failed to update visual plan"),
    },
  );
}

export function useDeletePlanComment() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<DeletePlanCommentResult, DeletePlanCommentInput>(
    "delete-plan-comment",
    {
      onSuccess: invalidate,
      onError: showActionError("Failed to delete comment"),
    },
  );
}

export function usePlanVersions(planId: string | null, open = true) {
  return useActionQuery<PlanVersionListResponse>(
    "list-plan-versions",
    planId && open ? { planId } : undefined,
    {
      enabled: Boolean(planId && open),
      placeholderData: (prev) => prev,
    } as any,
  );
}

export function usePlanVersion(
  planId: string | null,
  versionId: string | null,
) {
  return useActionQuery<PlanVersionDetail>(
    "get-plan-version",
    planId && versionId ? { planId, versionId } : undefined,
    {
      enabled: Boolean(planId && versionId),
      placeholderData: (prev) => prev,
    } as any,
  );
}

export function useRestorePlanVersion() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<
    PlanBundle & { html?: string; restoredVersionId?: string },
    { planId: string; versionId: string }
  >("restore-plan-version", {
    onSuccess: invalidate,
    onError: showActionError("Failed to restore plan version"),
  });
}

export function useConvertVisualPlanToPrototype() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<
    PlanBundle & { html?: string; path?: string; url?: string },
    ConvertVisualPlanToPrototypeInput
  >("convert-visual-plan-to-prototype", {
    onSuccess: invalidate,
    onError: showActionError("Failed to convert plan to prototype"),
  });
}

/**
 * Result of the `publish-visual-plan` action (owned by the plan server stream).
 * Either the plan is hosted and we get a shareable URL, or the user is in
 * local/no-account mode and must create an account / sign in first.
 */
export type PublishVisualPlanResult =
  | {
      needsAuth?: false | undefined;
      url: string;
      hostedPlanId: string;
      hostedPlanUrl?: string;
      hostedUrl?: string;
    }
  | {
      needsAuth: true;
      url?: undefined;
      hostedPlanId?: undefined;
      hostedPlanUrl?: undefined;
      hostedUrl?: undefined;
      /** CLI command that connects an account (shown for terminal users). */
      connectCommand?: string;
      /** Browser sign-in / account-creation URL to open and then retry. */
      authUrl?: string;
    };

export function usePublishVisualPlan() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<PublishVisualPlanResult, { planId: string }>(
    "publish-visual-plan",
    {
      onSuccess: invalidate,
      onError: showActionError("Failed to publish plan"),
    },
  );
}

export function useReportVisualPlan() {
  return useActionMutation<ReportVisualPlanResult, ReportVisualPlanInput>(
    "report-visual-plan",
    {
      onError: showActionError("Failed to report plan"),
    },
  );
}

export type ImportPlanSourceInput = {
  planId?: string;
  expectedUpdatedAt?: string;
  title?: string;
  brief?: string;
  kind?: PlanKind;
  source?: PlanSource;
  repoPath?: string;
  currentFocus?: string;
  status?: PlanStatus;
  mdx: PlanMdxFolder;
};

export function useImportPlanSource() {
  const invalidate = usePlanInvalidation();
  return useActionMutation<
    PlanBundle & { path?: string; url?: string; html?: string },
    ImportPlanSourceInput
  >("import-visual-plan-source", {
    onSuccess: invalidate,
    onError: showActionError("Failed to import plan source"),
  });
}

export function useExportPlan(planId?: string) {
  return useActionQuery<{
    markdown: string;
    html: string;
    json: PlanBundle;
    mdx: PlanMdxFolder;
    path: string;
    url: string;
  }>("export-visual-plan", { planId: planId ?? "" }, { enabled: false });
}
