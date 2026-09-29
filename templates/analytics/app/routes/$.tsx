import { data } from "react-router";

import enUSMessages from "@/i18n/en-US";
import NotFound from "@/pages/NotFound";

export function meta() {
  return [{ title: enUSMessages.routeTitles.notFound }];
}

export function loader() {
  return data(null, { status: 404 });
}

export default function CatchAllRoute() {
  return <NotFound />;
}
