import About from "@/pages/About";

export function meta() {
  return [{ title: "About — Analytics" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function AboutRoute() {
  return <About />;
}
