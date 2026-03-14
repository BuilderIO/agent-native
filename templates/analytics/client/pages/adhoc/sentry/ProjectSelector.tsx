import { useSentryProjects } from "./hooks";

interface Props {
  selected: string[];
  onChange: (projects: string[]) => void;
}

export function ProjectSelector({ selected, onChange }: Props) {
  const { data: projects, isLoading } = useSentryProjects();

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">Loading projects...</div>
    );
  }

  if (!projects?.length) {
    return (
      <div className="text-sm text-muted-foreground">No projects found</div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onChange([])}
        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
          selected.length === 0
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/80"
        }`}
      >
        All Projects
      </button>
      {projects.map((p) => {
        const isSelected = selected.includes(p.slug);
        return (
          <button
            key={p.id}
            onClick={() => {
              if (isSelected) {
                onChange(selected.filter((s) => s !== p.slug));
              } else {
                onChange([...selected, p.slug]);
              }
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              isSelected
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}
