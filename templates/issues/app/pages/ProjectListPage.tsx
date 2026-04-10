import { Link } from "react-router";
import { IconFolder } from "@tabler/icons-react";
import { useProjects } from "@/hooks/use-projects";
import { Skeleton } from "@/components/ui/skeleton";

export function ProjectListPage() {
  const { data, isLoading } = useProjects();
  const projects = data?.values || [];

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <h1 className="mb-4 text-lg font-semibold text-foreground sm:mb-6">
        Projects
      </h1>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
              <Skeleton className="mt-3 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-sm text-muted-foreground">No projects found.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project: any) => (
            <Link
              key={project.key}
              to={`/projects/${project.key}`}
              className="group rounded-lg border border-border p-4 hover:border-border/80 hover:bg-accent/50"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                  <IconFolder className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-foreground">
                    {project.name}
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {project.key}
                    {project.projectTypeKey && ` · ${project.projectTypeKey}`}
                  </div>
                </div>
              </div>
              {project.lead && (
                <div className="mt-3 text-[11px] text-muted-foreground">
                  Lead: {project.lead.displayName}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
