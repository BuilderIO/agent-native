export const LOCAL_VISUAL_EDIT_PRINCIPAL_DOMAIN =
  "local.visual-edit.agent-native.invalid";

export function isLocalVisualEditPrincipal(email: string | undefined): boolean {
  return (
    email
      ?.trim()
      .toLowerCase()
      .endsWith(`@${LOCAL_VISUAL_EDIT_PRINCIPAL_DOMAIN}`) ?? false
  );
}
