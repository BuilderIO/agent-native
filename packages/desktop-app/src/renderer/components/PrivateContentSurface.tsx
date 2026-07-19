import type {
  DesktopPrivateContentDocument,
  DesktopPrivateContentSummary,
} from "@shared/ipc-channels";
import {
  IconArrowLeft,
  IconFilePlus,
  IconLock,
  IconRefresh,
  IconSearch,
  IconShieldLock,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

type SurfaceState = "locked" | "opening" | "open" | "error";

function privateDocuments(value: unknown): DesktopPrivateContentSummary[] {
  if (!value || typeof value !== "object") return [];
  const documents = (value as { documents?: unknown }).documents;
  if (!Array.isArray(documents)) return [];
  return documents.filter(
    (document): document is DesktopPrivateContentSummary =>
      !!document &&
      typeof document === "object" &&
      typeof (document as DesktopPrivateContentSummary).id === "string" &&
      typeof (document as DesktopPrivateContentSummary).title === "string",
  );
}

function privateDocument(value: unknown): DesktopPrivateContentDocument | null {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as DesktopPrivateContentDocument).id !== "string" ||
    typeof (value as DesktopPrivateContentDocument).content !== "string"
  )
    return null;
  return value as DesktopPrivateContentDocument;
}

export default function PrivateContentSurface({
  onClose,
}: {
  onClose: () => void;
}) {
  const [state, setState] = useState<SurfaceState>("locked");
  const [brokerState, setBrokerState] = useState<"online" | "offline">(
    "offline",
  );
  const [documents, setDocuments] = useState<DesktopPrivateContentSummary[]>(
    [],
  );
  const [selected, setSelected] =
    useState<DesktopPrivateContentDocument | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadList = useCallback(async () => {
    const response = await window.electronAPI.privateContent.list();
    if (!response.ok) throw new Error();
    setDocuments(privateDocuments(response.value));
  }, []);

  const open = useCallback(async () => {
    setState("opening");
    setMessage("");
    const response = await window.electronAPI.privateContent.start();
    if (!response.ok) {
      setState("error");
      setMessage(
        "This vault is unavailable here. Create or recover it in Content settings, then unlock it in Desktop.",
      );
      return;
    }
    const health = response.value as { brokerState?: unknown } | null;
    setBrokerState(health?.brokerState === "online" ? "online" : "offline");
    setState("open");
    try {
      await loadList();
    } catch {
      setState("error");
      setMessage("Private documents could not be verified on this device.");
    }
  }, [loadList]);

  useEffect(() => {
    void window.electronAPI.privateContent.health().then((response) => {
      if (!response.ok || !response.value) return;
      const health = response.value as { brokerState?: unknown };
      setBrokerState(health.brokerState === "online" ? "online" : "offline");
      setState("open");
      void loadList();
    });
  }, [loadList]);

  const selectDocument = async (id: string) => {
    setConfirmDelete(false);
    const response = await window.electronAPI.privateContent.get(id);
    if (!response.ok) return setMessage(response.error);
    const document = privateDocument(response.value);
    if (!document) return setMessage("Private document is unavailable.");
    setSelected(document);
    setTitle(document.title);
    setContent(document.content);
    setMessage("");
  };

  const save = async () => {
    if (!selected) return;
    const response = await window.electronAPI.privateContent.update({
      id: selected.id,
      title,
      content,
    });
    if (!response.ok) return setMessage(response.error);
    const document = privateDocument(response.value);
    if (document) setSelected(document);
    setMessage("Saved and encrypted on this device.");
    await loadList();
  };

  const create = async () => {
    const response = await window.electronAPI.privateContent.create({
      title: "Untitled",
      content: "",
    });
    if (!response.ok) return setMessage(response.error);
    const document = privateDocument(response.value);
    if (!document) return;
    await loadList();
    await selectDocument(document.id);
  };

  const search = async () => {
    if (!query.trim()) return loadList();
    const response = await window.electronAPI.privateContent.search(query, 100);
    if (!response.ok) return setMessage(response.error);
    setDocuments(privateDocuments(response.value));
  };

  const remove = async () => {
    if (!selected) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const response = await window.electronAPI.privateContent.delete(
      selected.id,
    );
    if (!response.ok) return setMessage(response.error);
    setSelected(null);
    setTitle("");
    setContent("");
    setConfirmDelete(false);
    await loadList();
  };

  const lock = async () => {
    await window.electronAPI.privateContent.stop();
    setDocuments([]);
    setSelected(null);
    setTitle("");
    setContent("");
    setState("locked");
  };

  if (state !== "open") {
    return (
      <section className="private-content private-content--locked">
        <button
          className="private-content-back"
          onClick={onClose}
          type="button"
        >
          <IconArrowLeft size={16} /> Standard Cloud
        </button>
        <div className="private-content-lock-card">
          <IconShieldLock size={34} strokeWidth={1.5} />
          <h1>Private Vault</h1>
          <p>
            Titles and document bodies are decrypted only inside this signed
            Desktop app. Agent Native’s hosted Content service stores
            ciphertext.
          </p>
          <button
            className="private-content-primary"
            disabled={state === "opening"}
            onClick={() => void open()}
            type="button"
          >
            <IconLock size={16} />
            {state === "opening" ? "Opening…" : "Unlock on this device"}
          </button>
          {message && <p className="private-content-message">{message}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="private-content">
      <aside className="private-content-tree">
        <div className="private-content-tree-header">
          <div>
            <strong>Private Vault</strong>
            <span
              className={`private-content-health private-content-health--${brokerState}`}
            >
              Agent {brokerState}
            </span>
          </div>
          <button
            onClick={() => void create()}
            title="New private document"
            type="button"
          >
            <IconFilePlus size={17} />
          </button>
        </div>
        <div className="private-content-search">
          <IconSearch size={14} />
          <input
            aria-label="Search private documents"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
            placeholder="Search on this device"
            value={query}
          />
          <button onClick={() => void search()} title="Search" type="button">
            <IconRefresh size={14} />
          </button>
        </div>
        <div className="private-content-document-list">
          {documents.map((document) => (
            <button
              className={selected?.id === document.id ? "is-active" : ""}
              key={document.id}
              onClick={() => void selectDocument(document.id)}
              type="button"
            >
              <strong>{document.title || "Untitled"}</strong>
              <span>{document.contentPreview || "Empty document"}</span>
            </button>
          ))}
        </div>
        <div className="private-content-tree-footer">
          <button onClick={onClose} type="button">
            Standard Cloud
          </button>
          <button onClick={() => void lock()} type="button">
            <IconLock size={14} /> Lock
          </button>
        </div>
      </aside>
      <main className="private-content-editor">
        {selected ? (
          <>
            <input
              aria-label="Private document title"
              className="private-content-title"
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
            <textarea
              aria-label="Private document content"
              onChange={(event) => setContent(event.target.value)}
              value={content}
            />
            <div className="private-content-editor-footer">
              <span>{message}</span>
              <button
                className={confirmDelete ? "is-confirming" : ""}
                onClick={() => void remove()}
                type="button"
              >
                <IconTrash size={14} />
                {confirmDelete ? "Delete this page and children" : "Delete"}
              </button>
              <button
                className="private-content-primary"
                onClick={() => void save()}
                type="button"
              >
                Save encrypted
              </button>
            </div>
          </>
        ) : (
          <div className="private-content-empty">
            <IconShieldLock size={30} strokeWidth={1.5} />
            <p>Select a private document or create a new one.</p>
          </div>
        )}
      </main>
    </section>
  );
}
