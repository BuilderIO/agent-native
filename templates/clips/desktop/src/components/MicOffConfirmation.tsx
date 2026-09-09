import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./AlertDialog";

export function MicOffConfirmation({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onBack();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Microphone is off</AlertDialogTitle>
          <AlertDialogDescription>
            This recording won&apos;t include your voice.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onBack}>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={onContinue}>
            Record anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
