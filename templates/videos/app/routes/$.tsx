import enUS from "@/i18n/en-US";
import NotFound from "@/pages/NotFound";

export function meta() {
  return [{ title: enUS.raw.routes.notFound }];
}

export default function CatchAllRoute() {
  return <NotFound />;
}
