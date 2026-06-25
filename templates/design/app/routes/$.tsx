import NotFound from "@/pages/NotFound";
import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.notFound }];
}

export default function CatchAllRoute() {
  return <NotFound />;
}
