import { useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { toast } from "sonner";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import type {
  PlanAuthor,
  PlanBundle,
  PlanCommentKind,
  PlanCommentMention,
  PlanCommentResolutionTarget,
  PlanCommentStatus,
  PlanSectionType,
  PlanSource,
  PlanStatus,
  PlanSummary,
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

function usePlanInvalidation() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["action", "list-visual-plans"] });
    void qc.invalidateQueries({ queryKey: ["action", "get-visual-plan"] });
    void qc.invalidateQueries({ queryKey: ["action", "get-plan-feedback"] });
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

export function usePlan(id?: string) {
  return useActionQuery<PlanBundle & { html?: string }>(
    "get-visual-plan",
    { id: id ?? "" },
    {
      enabled: !!id,
      refetchInterval: 3_000,
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
    onError: showActionError("Failed to visualize plan"),
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

export function useExportPlan(planId?: string) {
  return useActionQuery<{
    markdown: string;
    html: string;
    json: PlanBundle;
    path: string;
    url: string;
  }>("export-visual-plan", { planId: planId ?? "" }, { enabled: false });
}
