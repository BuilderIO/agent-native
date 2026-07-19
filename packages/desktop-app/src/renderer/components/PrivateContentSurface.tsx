import type {
  DesktopPrivateContentApplicationState,
  DesktopPrivateContentDocument,
  DesktopPrivateContentGrantSummary,
  DesktopPrivateContentSummary,
  DesktopPrivateContentVaultMember,
  DesktopPrivateContentVersion,
} from "@shared/ipc-channels";
import {
  IconArrowLeft,
  IconArrowBackUp,
  IconFilePlus,
  IconFolderPlus,
  IconHistory,
  IconLock,
  IconRobot,
  IconRefresh,
  IconSearch,
  IconServerOff,
  IconShieldLock,
  IconUserShield,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { privateContentTree } from "../lib/private-content-tree.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog.js";

type SurfaceState = "locked" | "opening" | "open" | "error";
type BrokerState =
  | "running"
  | "offline"
  | "revoked"
  | "starting"
  | "stopping"
  | "stopped"
  | "closed"
  | "unavailable";
type BrokerOutcome = "idle" | "completed" | "failed" | "retry_wait" | null;

interface PrivateContentHealth {
  readonly brokerState: "online" | "offline";
  readonly broker: {
    readonly state: BrokerState;
    readonly processing: boolean;
    readonly lastOutcome: BrokerOutcome;
  } | null;
}

function privateContentHealth(value: unknown): PrivateContentHealth | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.brokerState !== "online" && record.brokerState !== "offline")
    return null;
  const broker = record.broker;
  if (broker === null) return { brokerState: record.brokerState, broker: null };
  if (!broker || typeof broker !== "object") return null;
  const detail = broker as Record<string, unknown>;
  const states = new Set<BrokerState>([
    "running",
    "offline",
    "revoked",
    "starting",
    "stopping",
    "stopped",
    "closed",
  ]);
  const outcomes = new Set(["idle", "completed", "failed", "retry_wait"]);
  if (
    typeof detail.state !== "string" ||
    !states.has(detail.state as BrokerState) ||
    typeof detail.processing !== "boolean" ||
    (detail.lastOutcome !== null &&
      (typeof detail.lastOutcome !== "string" ||
        !outcomes.has(detail.lastOutcome)))
  )
    return null;
  return {
    brokerState: record.brokerState,
    broker: {
      state: detail.state as BrokerState,
      processing: detail.processing,
      lastOutcome: detail.lastOutcome as BrokerOutcome,
    },
  };
}

function brokerLabel(health: PrivateContentHealth | null): string {
  if (!health?.broker) return "Agent unavailable";
  if (health.broker.state === "revoked") return "Agent revoked";
  if (health.broker.processing) return "Agent working";
  if (health.broker.state === "running") return "Agent ready";
  if (health.broker.state === "offline") return "Agent offline";
  return "Agent locked";
}

function brokerActivity(health: PrivateContentHealth | null): string {
  switch (health?.broker?.lastOutcome) {
    case "completed":
      return "Last encrypted job completed";
    case "retry_wait":
      return "Encrypted work is waiting to retry";
    case "failed":
      return "Last encrypted job failed closed";
    case "idle":
      return "No encrypted work is queued";
    default:
      return "No broker activity reported";
  }
}

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

function privateVersions(value: unknown): DesktopPrivateContentVersion[] {
  if (!value || typeof value !== "object") return [];
  const versions = (value as { versions?: unknown }).versions;
  if (!Array.isArray(versions)) return [];
  return versions.filter(
    (version): version is DesktopPrivateContentVersion =>
      !!version &&
      typeof version === "object" &&
      typeof (version as DesktopPrivateContentVersion).id === "string" &&
      typeof (version as DesktopPrivateContentVersion).revision === "number" &&
      typeof (version as DesktopPrivateContentVersion).content === "string",
  );
}

function privateGrants(value: unknown): DesktopPrivateContentGrantSummary[] {
  if (!value || typeof value !== "object") return [];
  const grants = (value as { grants?: unknown }).grants;
  if (!Array.isArray(grants)) return [];
  return grants.filter((grant): grant is DesktopPrivateContentGrantSummary => {
    if (!grant || typeof grant !== "object" || Array.isArray(grant))
      return false;
    const record = grant as Record<string, unknown>;
    const hasAgent = "subjectAgentId" in record;
    const expectedKeys = hasAgent ? 7 : 6;
    return (
      Object.keys(record).length === expectedKeys &&
      typeof record.grantRef === "string" &&
      /^[0-9a-f]{64}$/u.test(record.grantRef) &&
      typeof record.subjectEndpointId === "string" &&
      /^[0-9a-f]{32}$/u.test(record.subjectEndpointId) &&
      (!hasAgent ||
        (typeof record.subjectAgentId === "string" &&
          /^[0-9a-f]{32}$/u.test(record.subjectAgentId))) &&
      Number.isSafeInteger(record.issuedAt) &&
      (record.issuedAt as number) > 0 &&
      Number.isSafeInteger(record.expiresAt) &&
      (record.expiresAt as number) > (record.issuedAt as number) &&
      typeof record.revoked === "boolean" &&
      typeof record.pendingRevocation === "boolean"
    );
  });
}

function privateMembers(value: unknown): DesktopPrivateContentVaultMember[] {
  if (!value || typeof value !== "object") return [];
  const members = (value as { members?: unknown }).members;
  if (!Array.isArray(members)) return [];
  return members.filter(
    (member): member is DesktopPrivateContentVaultMember => {
      if (!member || typeof member !== "object" || Array.isArray(member))
        return false;
      const record = member as Record<string, unknown>;
      return (
        Object.keys(record).length === 4 &&
        typeof record.endpointId === "string" &&
        /^[0-9a-f]{32}$/u.test(record.endpointId) &&
        (record.role === "endpoint" || record.role === "broker") &&
        typeof record.unattended === "boolean" &&
        record.unattended === (record.role === "broker") &&
        typeof record.current === "boolean" &&
        (!record.current || record.role === "endpoint")
      );
    },
  );
}

function shortIdentity(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function PrivateContentDisclosure({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`private-content-disclosure${compact ? " private-content-disclosure--compact" : ""}`}
    >
      <div>
        <IconServerOff size={16} aria-hidden="true" />
        <p>
          <strong>Hosted Content cannot read your pages.</strong>
          <span>
            It stores ciphertext and opaque routing data. Ciphertext sizes,
            timing, and access patterns remain visible.
          </span>
        </p>
      </div>
      <div>
        <IconRobot size={16} aria-hidden="true" />
        <p>
          <strong>Your chosen agent can read what you ask it to use.</strong>
          <span>
            This Mac decrypts the minimum action input and result. The model
            provider you choose can read that specific text.
          </span>
        </p>
      </div>
    </div>
  );
}

export default function PrivateContentSurface({
  onClose,
}: {
  onClose: () => void;
}) {
  const [state, setState] = useState<SurfaceState>("locked");
  const [health, setHealth] = useState<PrivateContentHealth | null>(null);
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
  const [versions, setVersions] = useState<DesktopPrivateContentVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [grants, setGrants] = useState<DesktopPrivateContentGrantSummary[]>([]);
  const [members, setMembers] = useState<DesktopPrivateContentVaultMember[]>(
    [],
  );
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [revokingGrantRef, setRevokingGrantRef] = useState<string | null>(null);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(
    null,
  );

  const loadList = useCallback(async () => {
    const response = await window.electronAPI.privateContent.list();
    if (!response.ok) throw new Error();
    setDocuments(privateDocuments(response.value));
  }, []);

  const loadGrants = useCallback(async () => {
    setGrantsLoading(true);
    try {
      const response = await window.electronAPI.privateContent.listGrants();
      if (!response.ok) throw new Error();
      setGrants(privateGrants(response.value));
    } catch {
      setMessage("Agent access could not be verified on this device.");
    } finally {
      setGrantsLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    try {
      const response = await window.electronAPI.privateContent.listMembers();
      if (!response.ok) throw new Error();
      setMembers(privateMembers(response.value));
    } catch {
      setMessage("Enrolled devices could not be verified on this device.");
    } finally {
      setMembersLoading(false);
    }
  }, []);

  const syncApplicationState = useCallback(
    async (next: DesktopPrivateContentApplicationState) => {
      const response =
        await window.electronAPI.privateContent.setApplicationState(next);
      if (!response.ok)
        setMessage("Agent context could not be synchronized on this device.");
    },
    [],
  );

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
    setHealth(privateContentHealth(response.value));
    setState("open");
    try {
      await Promise.all([loadList(), loadGrants(), loadMembers()]);
    } catch {
      setState("error");
      setMessage("Private documents could not be verified on this device.");
    }
  }, [loadGrants, loadList, loadMembers]);

  useEffect(() => {
    const refreshHealth = () =>
      window.electronAPI.privateContent.health().then((response) => {
        if (!response.ok || !response.value) return;
        setHealth(privateContentHealth(response.value));
        setState("open");
      });
    void refreshHealth().then(() => loadList());
    const interval = window.setInterval(() => void refreshHealth(), 5_000);
    return () => window.clearInterval(interval);
  }, [loadList]);

  const selectDocument = async (id: string) => {
    setConfirmDelete(false);
    setShowVersions(false);
    setVersions([]);
    const response = await window.electronAPI.privateContent.get(id);
    if (!response.ok) return setMessage(response.error);
    const document = privateDocument(response.value);
    if (!document) return setMessage("Private document is unavailable.");
    setSelected(document);
    setTitle(document.title);
    setContent(document.content);
    setMessage("");
    await syncApplicationState({ view: "editor", documentId: document.id });
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

  const createSubpage = async () => {
    if (!selected) return;
    const response = await window.electronAPI.privateContent.create({
      title: "Untitled",
      content: "",
      parentId: selected.id,
    });
    if (!response.ok) return setMessage(response.error);
    const document = privateDocument(response.value);
    if (!document) return;
    await loadList();
    await selectDocument(document.id);
  };

  const moveToTopLevel = async () => {
    if (!selected || selected.parentId === null) return;
    const response = await window.electronAPI.privateContent.update({
      id: selected.id,
      parentId: null,
    });
    if (!response.ok) return setMessage(response.error);
    const document = privateDocument(response.value);
    if (!document) return;
    setSelected(document);
    setMessage("Moved to the top level in a new encrypted revision.");
    await loadList();
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
    setShowVersions(false);
    setVersions([]);
    await syncApplicationState({ view: "list" });
    await loadList();
  };

  const openVersions = async () => {
    if (!selected) return;
    if (showVersions) {
      setShowVersions(false);
      return;
    }
    const response = await window.electronAPI.privateContent.listVersions(
      selected.id,
    );
    if (!response.ok) return setMessage(response.error);
    setVersions(privateVersions(response.value));
    setShowVersions(true);
    setMessage("");
  };

  const restoreVersion = async (revisionId: string) => {
    if (!selected) return;
    if (restoringVersionId !== revisionId) {
      setRestoringVersionId(revisionId);
      return;
    }
    const response = await window.electronAPI.privateContent.restoreVersion({
      id: selected.id,
      revisionId,
    });
    if (!response.ok) return setMessage(response.error);
    const restored = privateDocument(response.value);
    if (!restored) return setMessage("Private document is unavailable.");
    setSelected(restored);
    setTitle(restored.title);
    setContent(restored.content);
    setRestoringVersionId(null);
    setShowVersions(false);
    setMessage("Restored as a new encrypted version.");
    await loadList();
  };

  const lock = async () => {
    await syncApplicationState({ view: "list" });
    await window.electronAPI.privateContent.stop();
    setDocuments([]);
    setSelected(null);
    setTitle("");
    setContent("");
    setVersions([]);
    setShowVersions(false);
    setHealth(null);
    setGrants([]);
    setMembers([]);
    setState("locked");
  };

  const closePrivateContent = async () => {
    await syncApplicationState({ view: "list" });
    onClose();
  };

  const revokeGrant = async (grantRef: string) => {
    setRevokingGrantRef(grantRef);
    const response =
      await window.electronAPI.privateContent.revokeGrant(grantRef);
    if (!response.ok) {
      setRevokingGrantRef(null);
      setMessage("That agent grant could not be revoked safely.");
      return;
    }
    setMessage("Agent access revoked. Future encrypted jobs will fail closed.");
    await loadGrants();
    setRevokingGrantRef(null);
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
          <PrivateContentDisclosure />
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
              className={`private-content-health private-content-health--${health?.brokerState ?? "offline"}`}
              title={brokerActivity(health)}
            >
              {brokerLabel(health)}
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
          {privateContentTree(documents).map(({ document, depth }) => (
            <button
              className={selected?.id === document.id ? "is-active" : ""}
              key={document.id}
              onClick={() => void selectDocument(document.id)}
              style={{ paddingLeft: `${10 + Math.min(depth, 8) * 14}px` }}
              type="button"
            >
              <strong>{document.title || "Untitled"}</strong>
              <span>{document.contentPreview || "Empty document"}</span>
            </button>
          ))}
        </div>
        <div className="private-content-tree-footer">
          <details
            className="private-content-reader-details"
            onToggle={(event) => {
              if (event.currentTarget.open)
                void Promise.all([loadGrants(), loadMembers()]);
            }}
          >
            <summary>Who can read?</summary>
            <PrivateContentDisclosure compact />
            <div className="private-content-grants">
              <div className="private-content-grants-heading">
                <IconShieldLock size={15} aria-hidden="true" />
                <strong>Enrolled members</strong>
              </div>
              {membersLoading ? (
                <span>Checking signed membership…</span>
              ) : members.length === 0 ? (
                <span>
                  Membership is unavailable while the vault is locked.
                </span>
              ) : (
                members.map((member) => (
                  <div
                    className="private-content-member"
                    key={member.endpointId}
                  >
                    <strong>
                      {member.current
                        ? "This Mac"
                        : member.role === "broker"
                          ? "Personal agent broker"
                          : "Enrolled device"}
                    </strong>
                    <span>
                      {shortIdentity(member.endpointId)} ·{" "}
                      {member.unattended ? "unattended" : "attended"}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="private-content-grants">
              <div className="private-content-grants-heading">
                <IconUserShield size={15} aria-hidden="true" />
                <strong>Agent access</strong>
              </div>
              {grantsLoading ? (
                <span>Checking signed grants…</span>
              ) : grants.filter((grant) => !grant.revoked).length === 0 ? (
                <span>No agent currently has a standing grant.</span>
              ) : (
                grants
                  .filter((grant) => !grant.revoked)
                  .map((grant) => (
                    <div className="private-content-grant" key={grant.grantRef}>
                      <div>
                        <strong>
                          Agent{" "}
                          {shortIdentity(
                            grant.subjectAgentId ?? grant.subjectEndpointId,
                          )}
                        </strong>
                        <span>
                          {grant.pendingRevocation
                            ? "Revocation is being committed"
                            : `Expires ${new Date(
                                grant.expiresAt * 1000,
                              ).toLocaleString()}`}
                        </span>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            disabled={
                              grant.pendingRevocation ||
                              revokingGrantRef === grant.grantRef
                            }
                            type="button"
                          >
                            {grant.pendingRevocation ||
                            revokingGrantRef === grant.grantRef
                              ? "Revoking…"
                              : "Revoke"}
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Revoke this agent’s access?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Future encrypted jobs using this grant will be
                              rejected. Text already handed to the agent or its
                              model provider cannot be pulled back.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep access</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => void revokeGrant(grant.grantRef)}
                            >
                              Revoke access
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ))
              )}
              {grants.some((grant) => grant.revoked) && (
                <span>
                  {grants.filter((grant) => grant.revoked).length} revoked
                  {grants.filter((grant) => grant.revoked).length === 1
                    ? " grant is"
                    : " grants are"}{" "}
                  held only as encrypted authority history.
                </span>
              )}
            </div>
          </details>
          <button onClick={() => void closePrivateContent()} type="button">
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
              <button onClick={() => void createSubpage()} type="button">
                <IconFolderPlus size={14} /> New subpage
              </button>
              {selected.parentId !== null && (
                <button onClick={() => void moveToTopLevel()} type="button">
                  <IconArrowBackUp size={14} /> Move to top
                </button>
              )}
              <button onClick={() => void openVersions()} type="button">
                <IconHistory size={14} />
                {showVersions ? "Close history" : "History"}
              </button>
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
            {showVersions && (
              <aside
                aria-label="Encrypted document history"
                className="private-content-history"
              >
                <div className="private-content-history-heading">
                  <strong>Encrypted history</strong>
                  <span>
                    Restoring creates a new revision; history is never
                    rewritten.
                  </span>
                </div>
                <div className="private-content-history-list">
                  {versions.map((version, index) => (
                    <div key={version.id}>
                      <div>
                        <strong>
                          {index === 0
                            ? `Current · version ${version.revision}`
                            : `Version ${version.revision}`}
                        </strong>
                        <span>
                          {new Date(version.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {index > 0 && (
                        <button
                          className={
                            restoringVersionId === version.id
                              ? "is-confirming"
                              : ""
                          }
                          onClick={() => void restoreVersion(version.id)}
                          type="button"
                        >
                          <IconArrowBackUp size={14} />
                          {restoringVersionId === version.id
                            ? "Confirm restore"
                            : "Restore"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </aside>
            )}
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
