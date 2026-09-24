import { messagesByLocale } from "@/i18n-data";
import NotFound from "@/pages/NotFound";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.notFound }];
}

export default function CatchAllRoute() {
  return <NotFound />;
}
