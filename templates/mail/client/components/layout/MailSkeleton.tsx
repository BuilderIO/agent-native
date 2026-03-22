/**
 * Full-page skeleton shown during SSR hydration.
 * Mimics the sidebar + email list layout so the initial load feels seamless.
 */
export function MailSkeleton() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar skeleton */}
      <div className="hidden md:flex w-[220px] flex-col border-r border-border px-3 py-4 gap-2">
        {/* Nav items */}
        <div className="h-8 w-full rounded bg-muted/50 animate-pulse" />
        <div className="h-8 w-3/4 rounded bg-muted/40 animate-pulse" />
        <div className="h-8 w-4/5 rounded bg-muted/40 animate-pulse" />
        <div className="h-8 w-2/3 rounded bg-muted/30 animate-pulse" />
        <div className="h-8 w-3/4 rounded bg-muted/30 animate-pulse" />
      </div>

      {/* Email list skeleton */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab bar area */}
        <div className="h-[49px] border-b border-border flex items-center gap-3 px-4">
          <div className="h-4 w-16 rounded bg-muted/50 animate-pulse" />
          <div className="h-4 w-16 rounded bg-muted/30 animate-pulse" />
          <div className="h-4 w-16 rounded bg-muted/30 animate-pulse" />
        </div>

        {/* Email rows */}
        <div className="flex-1 overflow-hidden">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 h-[38px]">
              <div className="h-2 w-2 rounded-full bg-muted/50 animate-pulse" />
              <div
                className="h-3 rounded bg-muted/50 animate-pulse"
                style={{ width: `${70 + ((i * 17) % 50)}px` }}
              />
              <div className="h-3 rounded bg-muted/40 animate-pulse flex-1" />
              <div className="h-3 w-10 rounded bg-muted/30 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
