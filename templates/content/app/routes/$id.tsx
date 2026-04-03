import { useParams, Navigate } from "react-router";

/**
 * Redirect legacy `/:id` URLs to `/page/:id`.
 * Preserves existing bookmarks and shared links after the route migration.
 */
export default function LegacyDocumentRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/page/${id}`} replace />;
}
