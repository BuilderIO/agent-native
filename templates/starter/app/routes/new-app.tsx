import { NewWorkspaceAppFlow } from "@agent-native/core/client";

export function meta() {
  return [
    { title: "New App — Starter" },
    {
      name: "description",
      content:
        "Create a new workspace app from a prompt and grant Dispatch vault keys.",
    },
  ];
}

export default function NewAppPage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Create a workspace app
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Prompt the agent to create a new app, then choose which Dispatch
            vault keys it can access.
          </p>
        </div>
        <NewWorkspaceAppFlow
          sourceApp="starter"
          dispatchBasePath="/dispatch"
          className="px-0 py-0"
        />
      </div>
    </div>
  );
}
