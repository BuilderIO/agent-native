import enUS from "@/i18n/en-US";
import DesignSystems from "@/pages/DesignSystems";

export function meta() {
  return [{ title: enUS.raw.routes.designSystems }];
}

export default function DesignSystemsRoute() {
  return <DesignSystems />;
}
