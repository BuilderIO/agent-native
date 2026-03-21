import Index from "@/pages/Index";

export function meta() {
  return [{ title: "Image Gen — Content Workspace" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function ImageGenRoute() {
  return <Index />;
}
