import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Link } from "react-router";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
        <div className="bg-destructive/10 p-4 rounded-full">
          <FileQuestion className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Page Not Found</h2>
        <p className="text-muted-foreground max-w-sm">
          The page you are looking for doesn't exist or has been moved.
        </p>
        <Link to="/">
          <Button variant="default">Return to Dashboard</Button>
        </Link>
      </div>
    </Layout>
  );
}
