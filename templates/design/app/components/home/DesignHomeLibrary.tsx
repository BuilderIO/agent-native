import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TAB_CLASS =
  "h-auto px-0 py-0 text-lg leading-[27px] font-medium group-data-[variant=line]/tabs-list:h-auto group-data-[variant=line]/tabs-list:border-b group-data-[variant=line]/tabs-list:text-muted-foreground";

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
}: DesignHomeLibraryProps) {
  const activeValue = value;

  return (
    <section
      className="agent-prompt-home-library mx-auto w-full max-w-[63rem]"
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
          <TabsList variant="line" className="gap-2 border-b-0">
            <TabsTrigger
              value="templates"
              className={TAB_CLASS}
              onClick={() => {
                if (activeValue === "templates") onValueChange("templates");
              }}
            >
              {labels.templates}
            </TabsTrigger>
            <TabsTrigger value="recent" className={TAB_CLASS}>
              {labels.recent}
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
        <TabsContent value="templates" className="mt-4">
          {templates}
        </TabsContent>
        <TabsContent value="recent" className="mt-4">
          {recent}
        </TabsContent>
      </Tabs>
    </section>
  );
}
