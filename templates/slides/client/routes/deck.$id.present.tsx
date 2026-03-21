import Presentation from "@/pages/Presentation";

export function meta() {
  return [{ title: "Presentation" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen bg-black">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
    </div>
  );
}

export default function PresentationRoute() {
  return <Presentation />;
}
