import { TeamPage } from "@agent-native/core/client/org";
import { useSetPageTitle } from "@/components/layout/HeaderActions";

export function meta() {
  return [{ title: "Workspace access — Content" }];
}

export default function TeamRoute() {
  useSetPageTitle(
    <h1 className="text-lg font-semibold tracking-tight truncate">
      Workspace access
    </h1>,
  );
  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8">
        <div className="mb-6 space-y-1">
          <h2 className="text-2xl font-bold tracking-tight">
            Shared document workspace
          </h2>
          <p className="text-sm text-muted-foreground">
            Workspaces are the shared spaces where collaborators can access the
            same Content documents.
          </p>
        </div>
        <TeamPage
          title="People and access"
          createOrgDescription="Create a shared workspace for Content documents. You can invite collaborators after setup."
          className="max-w-3xl"
        />
      </div>
    </div>
  );
}
