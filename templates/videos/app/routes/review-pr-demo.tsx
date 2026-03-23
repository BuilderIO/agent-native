import ReviewPRDemo from "@/pages/ReviewPRDemo";

export function meta() {
  return [{ title: "Review PR Demo — Remotion Studio" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function ReviewPRDemoRoute() {
  return <ReviewPRDemo />;
}
