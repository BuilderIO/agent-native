interface ListEmptyStateProps {
  heading: string;
  description: string;
}

export function ListEmptyState({ heading, description }: ListEmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <p className="text-sm font-medium">{heading}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
