import { useState } from "react";
import { IconPlus, IconPalette } from "@tabler/icons-react";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { DesignSystemCard } from "@/components/design-system/DesignSystemCard";
import { DesignSystemSetup } from "@/components/design-system/DesignSystemSetup";
import { Button } from "@/components/ui/button";
import { agentNativePath } from "@agent-native/core/client";
import type { DesignSystemData } from "../../shared/api";

export default function DesignSystems() {
  const { designSystems, isLoading, refetch } = useDesignSystems();
  const [showSetup, setShowSetup] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleCardClick = (id: string) => {
    setEditingId(id);
    setShowSetup(true);
  };

  const handleSetDefault = async (id: string) => {
    try {
      await fetch(
        agentNativePath("/_agent-native/actions/set-default-design-system"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        },
      );
      refetch();
    } catch (err) {
      console.error("Failed to set default design system:", err);
    }
  };

  const handleComplete = () => {
    setShowSetup(false);
    setEditingId(null);
    refetch();
  };

  const handleClose = () => {
    setShowSetup(false);
    setEditingId(null);
  };

  const parseDesignData = (dataStr: string): DesignSystemData | null => {
    try {
      return JSON.parse(dataStr) as DesignSystemData;
    } catch {
      return null;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-semibold text-foreground">
            Design Systems
          </h1>
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null);
              setShowSetup(true);
            }}
            className="cursor-pointer"
          >
            <IconPlus className="w-3.5 h-3.5" />
            New Design System
          </Button>
        </div>
        {isLoading ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <div className="h-5 w-40 rounded-md bg-muted animate-pulse" />
              <div className="h-3 w-16 rounded bg-muted animate-pulse" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border bg-card overflow-hidden"
                >
                  <div className="aspect-video bg-muted/50 animate-pulse" />
                  <div className="p-4 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : designSystems.length === 0 ? (
          <EmptyState
            onCreateNew={() => {
              setEditingId(null);
              setShowSetup(true);
            }}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* New design system card */}
              <button
                onClick={() => {
                  setEditingId(null);
                  setShowSetup(true);
                }}
                className="group relative rounded-xl border border-dashed border-border bg-card hover:border-foreground/15 overflow-hidden text-left cursor-pointer"
              >
                <div className="aspect-video flex items-center justify-center bg-muted/30">
                  <div className="w-12 h-12 rounded-xl bg-accent/50 flex items-center justify-center group-hover:bg-accent">
                    <IconPlus className="w-6 h-6 text-muted-foreground/70 group-hover:text-muted-foreground" />
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-medium text-sm text-muted-foreground group-hover:text-foreground/70">
                    New Design System
                  </h3>
                  <div className="text-xs text-muted-foreground/70 mt-1">
                    Set up your brand
                  </div>
                </div>
              </button>

              {/* Design system cards */}
              {designSystems.map((ds) => {
                const parsed = parseDesignData(ds.data);
                if (!parsed) return null;
                return (
                  <DesignSystemCard
                    key={ds.id}
                    id={ds.id}
                    title={ds.title}
                    data={parsed}
                    isDefault={ds.isDefault}
                    visibility={ds.visibility}
                    onClick={() => handleCardClick(ds.id)}
                    onSetDefault={() => handleSetDefault(ds.id)}
                  />
                );
              })}
            </div>
          </>
        )}
      </main>

      {/* Setup/Edit Dialog */}
      <DesignSystemSetup
        open={showSetup}
        onClose={handleClose}
        onComplete={handleComplete}
        editingId={editingId ?? undefined}
      />
    </div>
  );
}

function EmptyState({ onCreateNew }: { onCreateNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#609FF8]/20 to-[#4080E0]/20 border border-[#609FF8]/20 flex items-center justify-center mb-6">
        <IconPalette className="w-7 h-7 text-[#609FF8]" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">
        Set up your brand identity
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-8 leading-relaxed">
        Create a design system with your brand colors, typography, and logos.
        Every new deck will follow your visual identity.
      </p>
      <Button onClick={onCreateNew} className="cursor-pointer">
        <IconPlus className="w-4 h-4" />
        New Design System
      </Button>
    </div>
  );
}
