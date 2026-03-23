import { useBuilderAuth } from "./BuilderAuthContext";

export function ConnectScreen() {
  const { connect } = useBuilderAuth();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-8 max-w-md px-8 text-center">
        {/* Builder logo / branding */}
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10">
          <svg
            width="32"
            height="32"
            viewBox="0 0 256 256"
            fill="none"
            className="text-primary"
          >
            <rect width="256" height="256" rx="32" fill="currentColor" />
            <path
              d="M80 64h96v32H80V64zm0 48h96v32H80v-32zm0 48h64v32H80v-32z"
              fill="var(--background)"
            />
          </svg>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Content Workspace
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Connect your Builder.io space to start writing and uploading
            articles.
          </p>
        </div>

        <button
          onClick={connect}
          className="px-8 py-3 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Connect to Builder.io
        </button>

        <p className="text-[11px] text-muted-foreground/60">
          You'll be redirected to Builder.io to log in and select a space.
        </p>
      </div>
    </div>
  );
}
