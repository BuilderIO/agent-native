import { IconMovie, IconLoader2 } from "@tabler/icons-react";

type NewCompositionProps = {
  isGenerating?: boolean;
};

export default function NewComposition({ isGenerating }: NewCompositionProps) {
  if (isGenerating) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-8 min-w-0 bg-background h-full">
        <div className="flex flex-col items-center gap-4">
          <IconLoader2 size={32} className="text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Generating...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-8 min-w-0 bg-background h-full">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 border border-primary/15 flex items-center justify-center">
          <IconMovie size={24} className="text-primary" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground/90">
            Create a New Composition
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Use the{" "}
            <span className="font-medium text-foreground/70">
              + New Composition
            </span>{" "}
            button in the sidebar to describe the video you want to create.
          </p>
        </div>
      </div>
    </div>
  );
}
