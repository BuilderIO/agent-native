import { useCallback } from "react";
import { Link, useNavigate } from "react-router";
import {
  IconPlus,
  IconPalette,
  IconStar,
  IconStarFilled,
} from "@tabler/icons-react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

interface DesignSystem {
  id: string;
  title: string;
  description?: string | null;
  data: string;
  isDefault: boolean;
  createdAt: string;
}

interface DesignSystemData {
  colors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    background?: string;
  };
  typography?: {
    headingFont?: string;
    bodyFont?: string;
  };
}

export default function DesignSystems() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useActionQuery<{
    designSystems: DesignSystem[];
  }>("list-design-systems");

  const setDefaultMutation = useActionMutation("set-default-design-system");

  const designSystems = data?.designSystems ?? [];

  const handleSetDefault = useCallback(
    (id: string) => {
      // Optimistic update
      queryClient.setQueryData(
        ["action", "list-design-systems", undefined],
        (old: any) => {
          if (!old?.designSystems) return old;
          return {
            ...old,
            designSystems: old.designSystems.map((ds: DesignSystem) => ({
              ...ds,
              isDefault: ds.id === id,
            })),
          };
        },
      );

      setDefaultMutation.mutate({ id } as any, {
        onError: () => {
          queryClient.invalidateQueries({
            queryKey: ["action", "list-design-systems"],
          });
        },
      });
    },
    [queryClient, setDefaultMutation],
  );

  const parseData = (dataStr: string): DesignSystemData | null => {
    try {
      return JSON.parse(dataStr);
    } catch {
      return null;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-semibold text-white/90">
            Design Systems
          </h1>
          <Button
            size="sm"
            onClick={() => navigate("/design-systems/setup")}
            className="cursor-pointer"
          >
            <IconPlus className="w-3.5 h-3.5" />
            New Design System
          </Button>
        </div>
        {isLoading ? (
          <LoadingSkeleton />
        ) : designSystems.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* New design system card */}
              <button
                onClick={() => navigate("/design-systems/setup")}
                className="group relative rounded-xl border border-dashed border-white/[0.08] bg-[hsl(240,5%,8%)] hover:border-white/[0.15] overflow-hidden text-left cursor-pointer"
              >
                <div className="aspect-video flex items-center justify-center bg-white/[0.02]">
                  <div className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center group-hover:bg-white/[0.06]">
                    <IconPlus className="w-6 h-6 text-white/30 group-hover:text-white/50" />
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-medium text-sm text-white/50 group-hover:text-white/70">
                    New Design System
                  </h3>
                  <div className="text-xs text-white/30 mt-1">
                    Set up your brand
                  </div>
                </div>
              </button>

              {/* Design system cards */}
              {designSystems.map((ds) => {
                const parsed = parseData(ds.data);
                const colors = parsed?.colors;
                return (
                  <div
                    key={ds.id}
                    className="group relative rounded-xl border border-white/[0.06] bg-[hsl(240,5%,8%)] overflow-hidden"
                  >
                    <button
                      onClick={() => navigate("/design-systems/setup")}
                      className="block w-full text-left cursor-pointer"
                    >
                      {/* Color preview */}
                      <div className="aspect-video bg-white/[0.03] flex items-center justify-center gap-2 p-4">
                        {colors?.primary && (
                          <div
                            className="w-10 h-10 rounded-lg"
                            style={{ backgroundColor: colors.primary }}
                          />
                        )}
                        {colors?.secondary && (
                          <div
                            className="w-10 h-10 rounded-lg"
                            style={{ backgroundColor: colors.secondary }}
                          />
                        )}
                        {colors?.accent && (
                          <div
                            className="w-10 h-10 rounded-lg"
                            style={{ backgroundColor: colors.accent }}
                          />
                        )}
                        {!colors?.primary &&
                          !colors?.secondary &&
                          !colors?.accent && (
                            <IconPalette className="w-8 h-8 text-white/10" />
                          )}
                      </div>
                      <div className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-sm text-white/80 truncate flex-1">
                            {ds.title}
                          </h3>
                          {ds.isDefault && (
                            <span className="text-[10px] text-[#609FF8] font-medium">
                              Default
                            </span>
                          )}
                        </div>
                        {parsed?.typography?.headingFont && (
                          <div className="text-xs text-white/30">
                            {parsed.typography.headingFont}
                          </div>
                        )}
                      </div>
                    </button>
                    {/* Star button */}
                    <button
                      onClick={() => handleSetDefault(ds.id)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-md bg-black/60 hover:bg-black/80 cursor-pointer"
                      title={
                        ds.isDefault ? "Currently default" : "Set as default"
                      }
                    >
                      {ds.isDefault ? (
                        <IconStarFilled className="w-3.5 h-3.5 text-yellow-400" />
                      ) : (
                        <IconStar className="w-3.5 h-3.5 text-white/50" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="h-5 w-40 rounded-md bg-white/[0.05] animate-pulse" />
        <div className="h-3 w-16 rounded bg-white/[0.05] animate-pulse" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-white/[0.06] bg-[hsl(240,5%,8%)] overflow-hidden"
          >
            <div className="aspect-video bg-white/[0.03] animate-pulse" />
            <div className="p-4 space-y-2">
              <div className="h-4 w-3/4 rounded bg-white/[0.05] animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-white/[0.05] animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#609FF8]/20 to-[#4080E0]/20 border border-[#609FF8]/20 flex items-center justify-center mb-6">
        <IconPalette className="w-7 h-7 text-[#609FF8]" />
      </div>
      <h2 className="text-xl font-semibold text-white/90 mb-2">
        Create your first design system
      </h2>
      <p className="text-sm text-white/40 max-w-sm mb-8 leading-relaxed">
        Maintain consistent branding across all your designs with shared colors,
        typography, and assets.
      </p>
      <Button asChild className="cursor-pointer">
        <Link to="/design-systems/setup">
          <IconPlus className="w-4 h-4" />
          New Design System
        </Link>
      </Button>
    </div>
  );
}
