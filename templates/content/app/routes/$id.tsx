import { useParams, Navigate } from "react-router";

export default function LegacyDocumentRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/page/${id}`} replace />;
}
