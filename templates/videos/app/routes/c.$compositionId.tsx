import enUS from "@/i18n/en-US";
import Studio from "@/pages/Index";

export function meta() {
  return [{ title: enUS.raw.routes.studio }];
}

export default function CompositionRoute() {
  return <Studio />;
}
