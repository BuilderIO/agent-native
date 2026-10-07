import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: APP_TITLE },
    { name: "description", content: `${APP_TITLE} app canvas` },
  ];
}

export default function HomeRoute() {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Your app here</p>
    </div>
  );
}
