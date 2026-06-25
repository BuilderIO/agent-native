import NotFound from "@/pages/NotFound";
import enUS from "@/i18n/en-US";

export function meta() {
  return [{ title: enUS.raw.routes.notFound }];
}

export default function CatchAllRoute() {
  return <NotFound />;
}
