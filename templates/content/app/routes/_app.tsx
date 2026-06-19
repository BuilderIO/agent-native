import { Outlet } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";

export function meta() {
  const description =
    "Open Source MDX editor for local docs, knowledge bases, and content systems, with custom blocks and agent-assisted editing.";

  return [
    {
      title:
        "Agent-Native Content - Open Source, agent-friendly Obsidian alternative",
    },
    { name: "description", content: description },
    { property: "og:description", content: description },
    { name: "twitter:description", content: description },
  ];
}

// Pathless layout route — wraps all protected routes with AppLayout so the
// agent sidebar and document tree persist across client-side navigations.
export default function AppLayoutRoute() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
