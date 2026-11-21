// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  MovePageDestination,
  MovePageSpace,
  MovePageTarget,
} from "./MovePageDialog";

type MoveRequest = {
  variables: Record<string, unknown>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const mocks = vi.hoisted(() => ({
  moves: [] as MoveRequest[],
  mutateAsync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  dialog: undefined as
    | undefined
    | {
        page: MovePageTarget | null;
        spaces: MovePageSpace[];
        onOpenChange: (open: boolean) => void;
        onMove: (
          page: MovePageTarget,
          destination: MovePageDestination,
        ) => void;
      },
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key,
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/hooks/use-documents", () => ({
  useMoveDocument: () => ({ mutateAsync: mocks.mutateAsync }),
}));
vi.mock("@/hooks/use-content-spaces", () => ({
  useContentSpaces: () => ({
    data: {
      spaces: [
        { id: "personal", name: "Personal", kind: "personal" },
        { id: "team", name: "Team", kind: "organization" },
        { id: "repo", name: "Docs repo", kind: "source_backed" },
        {
          id: "locked",
          name: "Locked",
          kind: "organization",
          canCreateDatabase: false,
        },
      ],
    },
  }),
}));
vi.mock("./MovePageDialog", () => ({
  MovePageDialog: (props: NonNullable<typeof mocks.dialog>) => {
    mocks.dialog = props;
    return null;
  },
}));

import { useMovePageDialog } from "./use-move-page-dialog";

const roadmap: MovePageTarget = {
  documentId: "doc-1",
  title: "Roadmap",
  spaceId: "personal",
};

describe("useMovePageDialog", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;
  let startMove: (page: MovePageTarget | null) => void = () => undefined;
  const settle = vi.fn();
  const onMove = vi.fn(() => settle);

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    mocks.dialog = undefined;
    mocks.moves = [];
    vi.clearAllMocks();
  });

  function Harness() {
    const move = useMovePageDialog({ onMove });
    startMove = move.startMove;
    return move.dialog;
  }

  async function render() {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const harnessRoot = createRoot(host);
    container = host;
    root = harnessRoot;
    mocks.mutateAsync.mockImplementation(
      (variables: Record<string, unknown>) =>
        new Promise<void>((resolve, reject) => {
          mocks.moves.push({ variables, resolve, reject });
        }),
    );
    await act(async () => harnessRoot.render(<Harness />));
  }

  function lastMoveCall() {
    const call = [...mocks.moves].pop();
    if (!call) throw new Error("No move was asked for");
    return call;
  }

  it("opens for the chosen page with only the spaces it can move into", async () => {
    await render();
    expect(mocks.dialog?.page).toBeNull();

    act(() => startMove(roadmap));
    expect(mocks.dialog?.page).toEqual(roadmap);
    expect(mocks.dialog?.spaces.map((space) => space.id)).toEqual([
      "personal",
      "team",
    ]);

    act(() => startMove({ ...roadmap, spaceId: "repo" }));
    expect(mocks.dialog?.spaces.map((space) => space.id)).toEqual([
      "personal",
      "team",
      "repo",
    ]);

    act(() => mocks.dialog?.onOpenChange(false));
    expect(mocks.dialog?.page).toBeNull();
  });

  it("moves within a space quietly and says so when it moves to another space", async () => {
    await render();
    act(() => startMove(roadmap));

    act(() =>
      mocks.dialog?.onMove(roadmap, { spaceId: "personal", parentId: "p-1" }),
    );
    // The sidebar hears of the move as it starts, before the server answers.
    expect(onMove).toHaveBeenLastCalledWith(roadmap, {
      spaceId: "personal",
      parentId: "p-1",
    });
    expect(settle).not.toHaveBeenCalled();
    let call = lastMoveCall();
    expect(call.variables).toEqual({ id: "doc-1", parentId: "p-1" });
    await act(async () => call.resolve());
    expect(settle).toHaveBeenLastCalledWith(true);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    act(() =>
      mocks.dialog?.onMove(roadmap, { spaceId: "team", parentId: null }),
    );
    call = lastMoveCall();
    expect(call.variables).toEqual({
      id: "doc-1",
      parentId: null,
      spaceId: "team",
    });
    await act(async () => call.resolve());
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'sidebar.movedToSpace {"title":"Roadmap","space":"Team"}',
    );
  });

  it("shows why a move failed", async () => {
    await render();
    act(() => startMove(roadmap));
    act(() =>
      mocks.dialog?.onMove(roadmap, { spaceId: "personal", parentId: null }),
    );
    const call = lastMoveCall();
    await act(async () => call.reject(new Error("Page is locked")));
    expect(mocks.toastError).toHaveBeenCalledWith("sidebar.failedMovePage", {
      description: "Page is locked",
    });
    expect(settle).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("settles each of two moves made before the first answered", async () => {
    await render();
    act(() => startMove(roadmap));
    act(() =>
      mocks.dialog?.onMove(roadmap, { spaceId: "personal", parentId: "p-1" }),
    );
    act(() =>
      mocks.dialog?.onMove(roadmap, { spaceId: "personal", parentId: "p-2" }),
    );
    expect(mocks.moves).toHaveLength(2);
    const [first, second] = mocks.moves as [MoveRequest, MoveRequest];

    // The first move fails after the second one started.
    await act(async () => first.reject(new Error("Page is locked")));
    await act(async () => second.resolve());

    expect(settle.mock.calls).toEqual([[false], [true]]);
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      "sidebar.failedMovePage",
      { description: "Page is locked" },
    );
  });
});
