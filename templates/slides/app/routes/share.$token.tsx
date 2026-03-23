import SharedPresentation from "@/pages/SharedPresentation";

export function meta() {
  return [{ title: "Shared Presentation" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full bg-black">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
    </div>
  );
}

export default function SharedPresentationRoute() {
  return <SharedPresentation />;
}
