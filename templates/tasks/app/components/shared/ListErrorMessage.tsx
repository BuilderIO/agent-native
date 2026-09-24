type ListErrorMessageProps = {
  error: unknown;
  fallbackMessage: string;
};

export function ListErrorMessage({
  error,
  fallbackMessage,
}: ListErrorMessageProps) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      {(error as Error)?.message ?? fallbackMessage}
    </div>
  );
}
