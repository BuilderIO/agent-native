import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type SlidesHomeLibraryTab = "templates" | "recent";

interface SlidesHomeLibraryProps {
  value: SlidesHomeLibraryTab;
  onValueChange: (value: SlidesHomeLibraryTab) => void;
  labels: { templates: string; recent: string };
  browseAll?: ReactNode;
  search?: ReactNode;
  recentActions?: ReactNode;
  templates: ReactNode;
  recent?: ReactNode;
}

export function SlidesHomeLibrary({
  value,
  onValueChange,
  labels,
  browseAll,
  search,
  recentActions,
  templates,
  recent,
}: SlidesHomeLibraryProps) {
  const activeValue = value;

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
            <TabsTrigger
              value="recent"
              className="flex-none"
              onClick={() => {
                if (activeValue === "recent") onValueChange("recent");
              }}
            >
              {labels.recent}
            </TabsTrigger>
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
        <TabsContent value="recent">{recent}</TabsContent>
      </Tabs>
    </section>
  );
}
