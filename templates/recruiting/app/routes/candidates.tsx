import { CandidatesListPage } from "@/pages/CandidatesListPage";

export function meta() {
  return [{ title: "Candidates — Recruiting" }];
}

export default function CandidatesRoute() {
  return <CandidatesListPage />;
}
