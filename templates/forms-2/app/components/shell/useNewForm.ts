import { useActionMutation } from "@agent-native/core/client/hooks";
import type { TemplateId } from "@shared/form-templates";
import { useNavigate } from "react-router";

import { paths } from "./paths";

/** Creates a blank form, or one from a template, and opens it in the editor. */
export function useNewForm() {
  const navigate = useNavigate();
  const create = useActionMutation("create-form");
  return {
    isPending: create.isPending,
    isError: create.isError,
    createForm: (
      workspaceId?: string,
      templateId?: TemplateId,
      folderId?: string,
    ) =>
      create.mutate(
        { workspaceId, templateId, folderId },
        { onSuccess: (result) => void navigate(paths.edit(result.id)) },
      ),
  };
}
