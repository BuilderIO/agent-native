import messages from "@/i18n/en-US";
import NotFound from "@/pages/NotFound";

export function meta() {
  return [{ title: messages.raw.routeNotFoundTitle }];
}

export default function CatchAllRoute() {
  return <NotFound />;
}
