import { ResponseInsightsPage } from "@/pages/ResponseInsightsPage";

export function meta() {
  return [
    { title: "Response insights - Forms" },
    {
      name: "description",
      content: "Analyze form submissions with native tables and charts.",
    },
  ];
}

export default function ResponseInsightsRoute() {
  return <ResponseInsightsPage />;
}
