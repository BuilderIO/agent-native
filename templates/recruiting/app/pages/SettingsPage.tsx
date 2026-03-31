import {
  useGreenhouseStatus,
  useGreenhouseDisconnect,
} from "@/hooks/use-greenhouse";
import { ThemeToggle } from "@/components/ThemeToggle";
import { IconPlant2, IconCheck, IconLoader2 } from "@tabler/icons-react";

export function SettingsPage() {
  const { data: status } = useGreenhouseStatus();
  const disconnect = useGreenhouseDisconnect();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center border-b border-border px-6 h-14 flex-shrink-0">
        <h1 className="text-sm font-semibold text-foreground">Settings</h1>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-lg mx-auto px-6 py-8 space-y-8">
          {/* Connection */}
          <div>
            <h2 className="text-sm font-medium text-foreground mb-4">
              Greenhouse Connection
            </h2>
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-600/10">
                    <IconPlant2 className="h-4.5 w-4.5 text-green-600" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Greenhouse Harvest API
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      {status?.connected ? (
                        <>
                          <IconCheck className="h-3 w-3 text-green-600" />
                          <span className="text-green-600">Connected</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          Not connected
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {status?.connected && (
                  <button
                    onClick={() => disconnect.mutate()}
                    disabled={disconnect.isPending}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/30"
                  >
                    {disconnect.isPending ? (
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Disconnect"
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Appearance */}
          <div>
            <h2 className="text-sm font-medium text-foreground mb-4">
              Appearance
            </h2>
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Theme
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Toggle between light and dark mode
                  </div>
                </div>
                <ThemeToggle />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
