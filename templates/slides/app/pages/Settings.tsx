import { Link } from "react-router";
import { ApiKeySettings, AgentToggleButton } from "@agent-native/core/client";
import { IconArrowLeft } from "@tabler/icons-react";

export default function Settings() {
  return (
    <div className="min-h-screen bg-[hsl(240,6%,4%)] text-white/90">
      <header className="border-b border-white/[0.06] px-4 sm:px-6 h-14 flex items-center gap-3">
        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 py-2"
        >
          <IconArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <span className="text-base font-semibold">Settings</span>
        <div className="ml-auto">
          <AgentToggleButton />
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <ApiKeySettings />
      </main>
    </div>
  );
}
