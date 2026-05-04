import { CreateAppFlow } from "@/components/create-app-popover";
import { DispatchShell } from "@/components/dispatch-shell";

export function meta() {
  return [{ title: "New App — Dispatch" }];
}

export default function NewAppRoute() {
  return (
    <DispatchShell
      title="New App"
      description="Create a workspace app from a prompt and grant it selected vault keys."
    >
      <div className="mx-auto w-full max-w-xl">
        <CreateAppFlow />
      </div>
    </DispatchShell>
  );
}
