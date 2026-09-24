/**
 * Small, app-owned vocabulary used to demonstrate the framework RBAC surface
 * outside Dispatch. Permissions are intentionally explicit: assignment is
 * not authorization until an action declares and enforces the permission.
 */
export const formsAccessDescriptor = {
  appId: "forms",
  roles: ["editor", "reviewer"] as const,
  defaultRole: "editor",
  roleLabels: {
    editor: "Editor",
    reviewer: "Reviewer",
  },
  permissions: {
    "forms.edit": ["editor"],
    "forms.review": ["reviewer"],
  },
  permissionLabels: {
    "forms.edit": "Edit forms",
    "forms.review": "Review responses",
  },
  label: "Forms role",
} as const;
