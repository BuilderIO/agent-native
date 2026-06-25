import Studio from "@/pages/Index";
import enUS from "@/i18n/en-US";

export function meta() {
  return [{ title: enUS.raw.routes.studio }];
}

export default function CompositionRoute() {
  return <Studio />;
}
