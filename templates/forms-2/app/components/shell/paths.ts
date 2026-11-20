import { publicFormPath, type FormStatus } from "@shared/form-contract";

export const paths = {
  home: "/",
  workspace: (id: string) => `/workspaces/${id}`,
  folder: (workspaceId: string, folderId: string) =>
    `/workspaces/${workspaceId}/folders/${folderId}`,
  form: (id: string) => `/forms/${id}`,
  formTab: (id: string, tab: "submissions" | "share" | "settings") =>
    `/forms/${id}/${tab}`,
  edit: (id: string) => `/forms/${id}/edit`,
  publicForm: publicFormPath,
};

/** Drafts open the editor; published forms open on results or, with none, Share. */
export function formHref(form: {
  id: string;
  status: FormStatus;
  submissionCount?: number;
}): string {
  if (form.status === "published") {
    return (form.submissionCount ?? 0) > 0
      ? paths.form(form.id)
      : paths.formTab(form.id, "share");
  }
  return paths.edit(form.id);
}
