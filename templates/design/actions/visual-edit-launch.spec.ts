import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: mocks.exec }));
vi.mock("@agent-native/core/server", () => ({
  DESKTOP_DEEP_LINK_PROTOCOLS: ["agentnative", "agentnative-nightly"],
  toDesktopOpenUrl: (value: string, protocol = "agentnative") =>
    `${protocol}://open?${value.split("?")[1]}`,
}));
import { launchVisualEdit } from "./visual-edit-launch.js";

const options = {
  target: "desktop" as const,
  openUrl: "/_agent-native/open?app=design&view=editor",
  origin: "https://design.example.test",
  localCli: false,
  navigate: true,
};
beforeEach(() => {
  mocks.exec.mockReset();
});
describe("visual-edit launch contract", () => {
  it("returns host-required URLs without pretending a hosted launch succeeded", async () => {
    expect(await launchVisualEdit(options)).toEqual({
      target: "desktop",
      status: "host-required",
      browserUrl:
        "https://design.example.test/_agent-native/open?app=design&view=editor",
      desktopUrl: "agentnative://open?app=design&view=editor",
    });
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it("keeps inline as a local navigation and navigate false side effect free", async () => {
    expect(
      (
        await launchVisualEdit({
          ...options,
          target: "inline-browser",
          localCli: true,
        })
      ).status,
    ).toBe("inline");
    expect(
      (await launchVisualEdit({ ...options, navigate: false, localCli: true }))
        .status,
    ).toBe("host-required");
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it("reports desktop absence with browser fallback", async () => {
    mocks.exec.mockImplementation((_command, _args, _opts, cb) =>
      cb(new Error("not installed")),
    );
    expect(
      await launchVisualEdit({ ...options, localCli: true }),
    ).toMatchObject({
      status: "desktop-not-detected",
      browserUrl: expect.stringContaining("https://design.example.test/"),
    });
  });
  it("dispatches system browser locally and reports opener failure", async () => {
    mocks.exec.mockImplementation((_command, _args, _opts, cb) =>
      cb(null, "", ""),
    );
    expect(
      (
        await launchVisualEdit({
          ...options,
          target: "system-browser",
          localCli: true,
        })
      ).status,
    ).toBe("dispatched");
    mocks.exec.mockImplementation((_command, _args, _opts, cb) =>
      cb(new Error("failed")),
    );
    expect(
      (
        await launchVisualEdit({
          ...options,
          target: "system-browser",
          localCli: true,
        })
      ).status,
    ).toBe("failed");
  });
  describe.each(["darwin", "linux", "win32"] as const)(
    "desktop channel detection on %s",
    (platform) => {
      const original = process.platform;
      beforeEach(() => {
        Object.defineProperty(process, "platform", { value: platform });
        return () =>
          Object.defineProperty(process, "platform", { value: original });
      });
      const installed = (schemes: string[]) =>
        mocks.exec.mockImplementation(
          (command: string, args: string[], _opts, cb) => {
            const query = args.join(" ");
            const scheme = schemes.find((name) =>
              command === "osascript" || command === "xdg-mime"
                ? query.includes(`${name}://`) ||
                  query.endsWith(`x-scheme-handler/${name}`)
                : command === "reg"
                  ? query.endsWith(`\\${name}`)
                  : true,
            );
            if (command === "reg" && !scheme) cb(new Error("missing"));
            else
              cb(null, {
                stdout: scheme ? "/Applications/Agent-Native.app\n" : "",
                stderr: "",
              });
          },
        );
      it("dispatches the nightly scheme when only nightly is installed", async () => {
        installed(["agentnative-nightly"]);
        const launch = await launchVisualEdit({ ...options, localCli: true });
        expect(launch).toMatchObject({
          status: "dispatched",
          desktopProtocol: "agentnative-nightly",
          desktopUrl: "agentnative-nightly://open?app=design&view=editor",
        });
        const opened = mocks.exec.mock.calls.at(-1)?.[1] as string[];
        expect(opened.at(-1)).toBe(
          "agentnative-nightly://open?app=design&view=editor",
        );
      });
      it("prefers stable when both channels are installed", async () => {
        installed(["agentnative", "agentnative-nightly"]);
        expect(
          await launchVisualEdit({ ...options, localCli: true }),
        ).toMatchObject({
          status: "dispatched",
          desktopProtocol: "agentnative",
          desktopUrl: "agentnative://open?app=design&view=editor",
        });
      });
      it("reports no desktop app when neither channel is registered", async () => {
        installed([]);
        expect(
          await launchVisualEdit({ ...options, localCli: true }),
        ).toMatchObject({ status: "desktop-not-detected" });
      });
    },
  );
});
