import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/database-adapters")({
  beforeLoad: () => {
    throw redirect({ to: "/docs/file-sync" });
  },
  component: () => null,
});
