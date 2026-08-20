import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: APP_TITLE }];
}

export default function IndexPage() {
  return <main className="min-h-screen bg-background" />;
}
