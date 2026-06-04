import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import type {
  PlanAuthor,
  PlanBundle,
  PlanCommentKind,
  PlanCommentStatus,
  PlanSectionType,
  PlanSource,
  PlanStatus,
  PlanSummary,
} from "@shared/types";

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
  sectionId?: string;
  kind?: PlanCommentKind;
  status?: PlanCommentStatus;
  anchor?: string;
  message: string;
  createdBy?: PlanAuthor;
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
  markdown?: string;
  sections?: PlanSectionInput[];
  comments?: PlanCommentInput[];
  consumedCommentIds?: string[];
  note?: string;
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

export function usePlans() {
  return useActionQuery<PlanSummary[]>("list-visual-plans", {});
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

export function useExportPlan(planId?: string) {
  return useActionQuery<{
    markdown: string;
    html: string;
    json: PlanBundle;
  }>("export-visual-plan", { planId: planId ?? "" }, { enabled: false });
}
