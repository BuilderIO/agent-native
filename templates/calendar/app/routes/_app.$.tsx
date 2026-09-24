import enUSMessages from "@/i18n/en-US";
import NotFound from "@/pages/NotFound";

export function meta() {
  return [{ title: enUSMessages.routeTitles.notFound }];
}

export default function AppCatchAllRoute() {
  return <NotFound />;
}
