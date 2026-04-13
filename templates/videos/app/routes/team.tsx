import { useState } from "react";
import { StudioHeader } from "@/components/StudioHeader";
import { TeamPage, InvitationBanner } from "@agent-native/core/client/org";

export function meta() {
  return [{ title: "Team — Remotion Studio" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function TeamRoute() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <div className="flex flex-col h-screen bg-background">
      <StudioHeader
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />
      <InvitationBanner />
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto">
          <TeamPage createOrgDescription="Set up a team to share compositions and animations with your colleagues." />
        </div>
      </main>
    </div>
  );
}
