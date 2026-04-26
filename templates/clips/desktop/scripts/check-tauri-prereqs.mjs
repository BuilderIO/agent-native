#!/usr/bin/env node
// Preflight: verify Tauri's native prerequisites before invoking `tauri dev` /
// `tauri build`. Without this, devs see a cryptic
// `failed to run 'cargo metadata' command` error from the Tauri CLI.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

function has(cmd) {
  try {
    execFileSync(platform() === "win32" ? "where" : "which", [cmd], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function cargoOnDisk() {
  // rustup installs to ~/.cargo/bin but the shell PATH update only takes effect
  // in new shells — detect this case so we can give a clearer "restart shell" hint.
  const bin = platform() === "win32" ? "cargo.exe" : "cargo";
  const candidate = join(homedir(), ".cargo", "bin", bin);
  return existsSync(candidate) ? candidate : null;
}

function fail(lines) {
  process.stderr.write("\n");
  process.stderr.write(
    `${RED}${BOLD}Clips Desktop — missing prerequisites${RESET}\n`,
  );
  process.stderr.write(`${DIM}${"─".repeat(60)}${RESET}\n`);
  for (const line of lines) process.stderr.write(line + "\n");
  process.stderr.write(`${DIM}${"─".repeat(60)}${RESET}\n`);
  process.stderr.write(
    `${DIM}Full Tauri prerequisites: https://tauri.app/start/prerequisites/${RESET}\n\n`,
  );
  process.exit(1);
}

if (!has("cargo")) {
  const stranded = cargoOnDisk();
  if (stranded) {
    fail([
      "",
      `${YELLOW}Rust is installed but ${BOLD}not on your PATH${RESET}${YELLOW} in this shell.${RESET}`,
      "",
      `Found: ${DIM}${stranded}${RESET}`,
      "",
      `${BOLD}Fix:${RESET} either open a new terminal, or run:`,
      "",
      `  ${CYAN}source "$HOME/.cargo/env"${RESET}`,
      "",
      "Then re-run this command.",
    ]);
  }

  const os = platform();
  const installLines = [
    "",
    `${YELLOW}Tauri needs the Rust toolchain (${BOLD}cargo${RESET}${YELLOW}), and it isn't installed.${RESET}`,
    "",
    `${BOLD}Install Rust:${RESET}`,
    "",
  ];

  if (os === "win32") {
    installLines.push(
      `  ${CYAN}1.${RESET} Download and run ${CYAN}https://win.rustup.rs/x86_64${RESET}`,
      `  ${CYAN}2.${RESET} You'll also need the ${BOLD}Microsoft C++ Build Tools${RESET}:`,
      `     ${DIM}https://visualstudio.microsoft.com/visual-cpp-build-tools/${RESET}`,
      `  ${CYAN}3.${RESET} Open a new terminal, then re-run this command.`,
    );
  } else {
    installLines.push(
      `  ${CYAN}curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y${RESET}`,
      "",
      `Then load it into the current shell:`,
      "",
      `  ${CYAN}source "$HOME/.cargo/env"${RESET}`,
      "",
      `…and re-run this command.`,
    );
    if (os === "darwin") {
      installLines.push(
        "",
        `${DIM}macOS also needs Xcode Command Line Tools. If they aren't installed,`,
        `the next \`cargo build\` will prompt you — or run \`xcode-select --install\`.${RESET}`,
      );
    } else {
      installLines.push(
        "",
        `${DIM}Linux also needs system libs (webkit2gtk, libssl, etc.). See the Tauri prerequisites link below.${RESET}`,
      );
    }
  }

  fail(installLines);
}
