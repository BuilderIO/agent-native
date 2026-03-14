import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4 text-foreground">404</h1>
        <p className="text-lg text-muted-foreground mb-6">Page not found</p>
        <Link
          to="/"
          className="text-sm font-medium text-primary hover:text-primary/80 underline underline-offset-4"
        >
          Back to Content Workspace
        </Link>
      </div>
    </div>
  );
}
