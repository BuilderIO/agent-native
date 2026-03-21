export function meta() {
  return [{ title: "{{APP_TITLE}}" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function IndexPage() {
  return (
    <div className="flex items-center justify-center h-screen">
      <h1 className="text-2xl font-bold">{{ APP_TITLE }}</h1>
    </div>
  );
}
