import { TeamPage } from "@agent-native/core/client/org";

export function meta() {
  return [{ title: "Team — Slides" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function TeamRoute() {
  return (
    <div className="min-h-screen bg-[hsl(240,6%,4%)]">
      <header className="border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center">
          <a
            href="/"
            className="text-base font-semibold text-white/90 tracking-tight hover:text-white"
          >
            Slides
          </a>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <TeamPage />
      </main>
    </div>
  );
}
