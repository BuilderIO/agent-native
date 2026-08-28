import { useEffect, useState } from "react";

// Deliberately free of any import of SearchModal: both headers lazy-load that
// chunk, and a header that imported the modal just to read its open state
// would pull the whole docs search index into the initial bundle.
export function useSearchModal() {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setEverOpened(true);
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const openModal = () => {
    setEverOpened(true);
    setOpen(true);
  };

  return { open, setOpen, everOpened, openModal };
}
