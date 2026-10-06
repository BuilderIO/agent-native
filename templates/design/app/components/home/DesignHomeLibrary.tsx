import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type DesignHomeLibraryTab = "templates" | "recent";

interface DesignHomeLibraryProps {
  value: DesignHomeLibraryTab;
  onValueChange: (value: DesignHomeLibraryTab) => void;
  labels: { templates: string; recent: string };
  browseAll?: ReactNode;
  search?: ReactNode;
  recentActions?: ReactNode;
  templates: ReactNode;
  recent?: ReactNode;
  recentVisible: boolean;
}

export function DesignHomeLibrary({
  value,
  onValueChange,
  labels,
  browseAll,
  search,
  recentActions,
  templates,
  recent,
  recentVisible,
}: DesignHomeLibraryProps) {
  const activeValue = recentVisible ? value : "templates";

  return (
    <section
      className="agent-prompt-home-library"
      aria-label={labels.templates}
    >
      <Tabs
        className="agent-prompt-home-tabs"
        value={activeValue}
        onValueChange={(nextValue) => {
          if (nextValue === "templates" || nextValue === "recent") {
            onValueChange(nextValue);
          }
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList variant="line">
            {recentVisible ? (
              <TabsTrigger value="recent" className="flex-none">
                {labels.recent}
              </TabsTrigger>
            ) : null}
            <TabsTrigger
              value="templates"
              className="flex-none"
              onClick={() => {
                if (activeValue === "templates") onValueChange("templates");
              }}
            >
              {labels.templates}
            </TabsTrigger>
          </TabsList>
          {activeValue === "recent" ? (
            <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
              {search}
              {recentActions}
            </div>
          ) : (
            browseAll
          )}
        </div>
        <TabsContent value="templates">{templates}</TabsContent>
        {recentVisible ? (
          <TabsContent value="recent">{recent}</TabsContent>
        ) : null}
      </Tabs>
    </section>
  );
}
