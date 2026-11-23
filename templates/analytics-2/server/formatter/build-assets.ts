/**
 * Build-time formatter assets. No runtime pip/network is used.
 *
 * Sources are pinned:
 * - Pyodide npm package installed in this app (314.0.7, version-checked).
 * - Pyodide-built wheels referenced by its lock file (sha256 required).
 * - PyPI pure wheels pinned by sha256 below.
 * - CPython / Pyodide / Emscripten license texts pinned by sha256 below.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { transformWithEsbuild } from "vite";

type PyodideLockPackage = {
  version: string;
  file_name: string;
  sha256: string;
};
type PyodideLock = {
  info?: { python?: string; platform?: string; abi_version?: string };
  packages: Record<string, PyodideLockPackage>;
};
type PyPiFile = {
  filename: string;
  url: string;
  digests?: { sha256?: string };
};
type PyPiProject = { urls: PyPiFile[] };
type ManifestFile = { path: string; size: number; sha256: string };
type Manifest = {
  generatedBy: string;
  pyodideVersion: string;
  sqlfluffVersion: string;
  files: ManifestFile[];
};

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "../..");
const outputDir = path.join(appRoot, "server", "assets", "formatter");
const runtimeDir = path.join(outputDir, "runtime");
const pyodideOut = path.join(runtimeDir, "pyodide");
const wheelsOut = path.join(runtimeDir, "wheels");
const pyodideSource = path.join(appRoot, "node_modules", "pyodide");

const PYODIDE_VERSION = "314.0.7";
const CPYTHON_VERSION = "3.14.2";
const EMSCRIPTEN_VERSION = "5.0.3";
const SQLFLUFF_VERSION = "4.5.0";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PYODIDE_LICENSE_URL = `https://raw.githubusercontent.com/pyodide/pyodide/${PYODIDE_VERSION}/LICENSE`;
const PYODIDE_LICENSE_SHA256 =
  "1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5";
const CPYTHON_LICENSE_URL = `https://raw.githubusercontent.com/python/cpython/v${CPYTHON_VERSION}/LICENSE`;
const CPYTHON_LICENSE_SHA256 =
  "b0e25a78cffb43f4d92de8b61ccfa1f1f98ecbc22330b54b5251e7b6ba010231";
const EMSCRIPTEN_LICENSE_URL = `https://raw.githubusercontent.com/emscripten-core/emscripten/${EMSCRIPTEN_VERSION}/LICENSE`;
const EMSCRIPTEN_LICENSE_SHA256 =
  "620a78084fc7ca97c0b5dea9abf891f3ffcadfdbf305276f099c9c4e12fc1d86";

// Bounds for build-time network reads. Metadata is re-validated after fetch.
const FETCH_TIMEOUT_MS = 60_000;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_LICENSE_BYTES = 512 * 1024;
const MAX_WHEEL_BYTES = 32 * 1024 * 1024;

const PYODIDE_FILES = [
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "pyodide-lock.json",
  "pyodide.mjs",
  "python_stdlib.zip",
];
const BUILTINS = [
  "regex",
  "pyyaml",
  "markupsafe",
  "click",
  "jinja2",
  "pygments",
  "platformdirs",
  "tqdm",
  "tblib",
  "typing-extensions",
  "pluggy",
  "micropip",
];
const BUILTIN_LICENSES: Record<string, string> = {
  regex: "Apache-2.0 AND CNRI-Python",
  pyyaml: "MIT",
  markupsafe: "BSD-3-Clause",
  click: "BSD-3-Clause",
  jinja2: "BSD-3-Clause",
  pygments: "BSD-2-Clause",
  platformdirs: "MIT",
  tqdm: "MPL-2.0 AND MIT",
  tblib: "BSD-2-Clause",
  "typing-extensions": "PSF-2.0",
  pluggy: "MIT",
  micropip: "MPL-2.0",
};
const PURE_WHEELS = [
  {
    name: "sqlfluff",
    version: SQLFLUFF_VERSION,
    license: "MIT",
    sha256: "471a9abcad8061e36b69f711a6d89393241e30f9d1e0869f79965c0ae2c889c7",
  },
  {
    name: "chardet",
    version: "7.7.0",
    license: "0BSD",
    sha256: "11cf9b719ea3675a2a7d8a3071bbe4d7ea24b26bfe39a51588d515ddd05cacad",
  },
  {
    name: "colorama",
    version: "0.4.6",
    license: "BSD-3-Clause",
    sha256: "4f1d9991f5acc0ca119f9d443620b77f9d6b33703e51011c16baf57afb285fc6",
  },
  {
    name: "diff-cover",
    version: "11.0.1",
    license: "Apache-2.0",
    sha256: "40d559e47ee9bcec35194fd9726d408a242608c54fbd0cdab244ae4324c1c7da",
  },
  {
    name: "pathspec",
    version: "1.1.1",
    license: "MPL-2.0",
    sha256: "a00ce642f577bf7f473932318056212bc4f8bfdf53128c78bbd5af0b9b20b189",
  },
];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSha256(value: string | undefined, label: string): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} must provide a 64-character sha256 digest.`);
  }
  return normalized;
}

async function fetchBounded(
  url: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`fetch ${url} failed: ${response.status}`);
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    throw new Error(`fetch ${url} exceeded ${maxBytes} bytes.`);
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`fetch ${url} exceeded ${maxBytes} bytes.`);
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`fetch ${url} exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchJson<T>(url: string): Promise<T> {
  const bytes = await fetchBounded(url, MAX_METADATA_BYTES);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function writeVerified(
  filePath: string,
  bytes: Uint8Array,
  expected: string,
): Promise<ManifestFile> {
  const actual = sha256(bytes);
  if (actual !== assertSha256(expected, path.basename(filePath))) {
    throw new Error(`integrity mismatch for ${path.basename(filePath)}`);
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  return {
    path: path.relative(outputDir, filePath),
    size: bytes.byteLength,
    sha256: actual,
  };
}

async function compileChild(): Promise<Uint8Array> {
  const sourcePath = path.join(here, "child.ts");
  const source = await readFile(sourcePath, "utf8");
  const transformed = await transformWithEsbuild(source, sourcePath, {
    loader: "ts",
    format: "esm",
    target: "es2022",
  });
  return Buffer.from(transformed.code);
}

async function extractWheelLicenses(
  wheelPath: string,
  packageName: string,
  files: ManifestFile[],
): Promise<void> {
  const entries = execFileSync("unzip", ["-Z1", wheelPath], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  })
    .split("\n")
    .filter(Boolean);
  const licenses = entries.filter(
    (entry) =>
      /(^|\/)(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(entry) ||
      /\/licenses\//i.test(entry),
  );
  if (licenses.length === 0) {
    throw new Error(`No license files found in ${path.basename(wheelPath)}.`);
  }
  for (const entry of licenses) {
    const bytes = execFileSync("unzip", ["-p", wheelPath, entry], {
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const safeName = entry.replace(/[\\/]/g, "__");
    files.push(
      await writeVerified(
        path.join(outputDir, "licenses", packageName, safeName),
        new Uint8Array(bytes),
        sha256(new Uint8Array(bytes)),
      ),
    );
  }
}

async function readInstalledPyodide(): Promise<PyodideLock> {
  const packageJson = JSON.parse(
    await readFile(path.join(pyodideSource, "package.json"), "utf8"),
  ) as { version?: string };
  if (packageJson.version !== PYODIDE_VERSION) {
    throw new Error(
      `Installed Pyodide is ${packageJson.version ?? "unknown"}, expected ${PYODIDE_VERSION}.`,
    );
  }
  const lock = JSON.parse(
    await readFile(path.join(pyodideSource, "pyodide-lock.json"), "utf8"),
  ) as PyodideLock;
  if (lock.info?.python !== CPYTHON_VERSION) {
    throw new Error(
      `Pyodide lock targets CPython ${lock.info?.python ?? "unknown"}, expected ${CPYTHON_VERSION}.`,
    );
  }
  return lock;
}

async function main() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(pyodideOut, { recursive: true });
  await mkdir(wheelsOut, { recursive: true });
  const files: ManifestFile[] = [];
  const lock = await readInstalledPyodide();

  for (const file of PYODIDE_FILES) {
    const bytes = await readFile(path.join(pyodideSource, file));
    files.push(
      await writeVerified(path.join(pyodideOut, file), bytes, sha256(bytes)),
    );
  }

  for (const name of BUILTINS) {
    const entry = lock.packages[name];
    if (!entry) throw new Error(`Pyodide lock is missing ${name}`);
    const expected = assertSha256(
      entry.sha256,
      `pyodide-lock.json sha256 for ${name}`,
    );
    const bytes = await fetchBounded(
      PYODIDE_CDN + entry.file_name,
      MAX_WHEEL_BYTES,
    );
    const wheelPath = path.join(pyodideOut, entry.file_name);
    files.push(await writeVerified(wheelPath, bytes, expected));
    await extractWheelLicenses(wheelPath, name, files);
  }

  for (const wheel of PURE_WHEELS) {
    const metadata = await fetchJson<PyPiProject>(
      `https://pypi.org/pypi/${wheel.name}/${wheel.version}/json`,
    );
    const candidate = metadata.urls.find(
      (item) =>
        item.filename.endsWith(".whl") && !item.filename.includes("cp3"),
    );
    if (!candidate) {
      throw new Error(`No pure wheel found for ${wheel.name} ${wheel.version}`);
    }
    // PyPI metadata must state the artifact hash; there is no optional
    // self-consistency fallback.
    const published = assertSha256(
      candidate.digests?.sha256,
      `PyPI digests.sha256 for ${wheel.name} ${wheel.version}`,
    );
    if (published !== wheel.sha256) {
      throw new Error(
        `PyPI hash for ${wheel.name} ${wheel.version} does not match the pinned hash.`,
      );
    }
    const bytes = await fetchBounded(candidate.url, MAX_WHEEL_BYTES);
    const wheelPath = path.join(wheelsOut, candidate.filename);
    files.push(await writeVerified(wheelPath, bytes, wheel.sha256));
    await extractWheelLicenses(wheelPath, wheel.name, files);
  }

  const childBytes = await compileChild();
  await writeFile(path.join(outputDir, "child.mjs"), childBytes);
  files.push({
    path: "child.mjs",
    size: childBytes.byteLength,
    sha256: sha256(childBytes),
  });

  const pinnedLicenses = [
    {
      dir: "cpython",
      url: CPYTHON_LICENSE_URL,
      sha256: CPYTHON_LICENSE_SHA256,
    },
    {
      dir: "pyodide",
      url: PYODIDE_LICENSE_URL,
      sha256: PYODIDE_LICENSE_SHA256,
    },
    {
      dir: "emscripten",
      url: EMSCRIPTEN_LICENSE_URL,
      sha256: EMSCRIPTEN_LICENSE_SHA256,
    },
  ];
  for (const license of pinnedLicenses) {
    const bytes = await fetchBounded(license.url, MAX_LICENSE_BYTES);
    files.push(
      await writeVerified(
        path.join(outputDir, "licenses", license.dir, "LICENSE"),
        bytes,
        license.sha256,
      ),
    );
  }

  const thirdPartyNotices =
    `# Pyodide runtime third-party notices\n\n` +
    `This is an index of the third-party components bundled in this formatter's\n` +
    `Pyodide runtime. It is not a complete SPDX inventory and does not replace\n` +
    `the full license texts shipped next to it.\n\n` +
    `- Pyodide ${PYODIDE_VERSION} — MPL-2.0 — \`licenses/pyodide/LICENSE\`\n` +
    `  https://github.com/pyodide/pyodide/blob/${PYODIDE_VERSION}/LICENSE\n` +
    `- CPython ${CPYTHON_VERSION} (shipped as \`runtime/pyodide/python_stdlib.zip\`) — PSF-2.0 — \`licenses/cpython/LICENSE\`\n` +
    `  https://github.com/python/cpython/blob/v${CPYTHON_VERSION}/LICENSE\n` +
    `- Emscripten ${EMSCRIPTEN_VERSION} (wasm/JS toolchain in \`pyodide.asm.*\`) — MIT OR NCSA — \`licenses/emscripten/LICENSE\`\n` +
    `  https://github.com/emscripten-core/emscripten/blob/${EMSCRIPTEN_VERSION}/LICENSE\n` +
    `- Python packages installed in the guest — full texts under \`licenses/<package>/\`, extracted from each wheel's \`dist-info\`.\n\n` +
    `Pyodide-built wheel names and sha256 values come from the installed\n` +
    `Pyodide ${PYODIDE_VERSION} \`pyodide-lock.json\`. Pure Python wheels come from\n` +
    `PyPI; Pyodide-built wheels come from ${PYODIDE_CDN}\n`;
  const noticesBytes = Buffer.from(thirdPartyNotices);
  await writeFile(
    path.join(outputDir, "licenses", "pyodide", "THIRD-PARTY-NOTICES.md"),
    noticesBytes,
  );
  files.push({
    path: "licenses/pyodide/THIRD-PARTY-NOTICES.md",
    size: noticesBytes.byteLength,
    sha256: sha256(noticesBytes),
  });

  const licenses =
    `# Third-party licenses\n\n` +
    `## Python runtime\n` +
    `Pyodide ${PYODIDE_VERSION}: MPL-2.0 (licenses/pyodide/LICENSE)\n` +
    `CPython ${CPYTHON_VERSION}: PSF-2.0 (licenses/cpython/LICENSE)\n` +
    `Emscripten ${EMSCRIPTEN_VERSION}: MIT OR NCSA (licenses/emscripten/LICENSE)\n\n` +
    `## Installed Python packages\n` +
    PURE_WHEELS.map(
      (wheel) => `${wheel.name} ${wheel.version}: ${wheel.license}`,
    ).join("\n") +
    "\n" +
    BUILTINS.map(
      (name) =>
        `${name} ${lock.packages[name]?.version ?? "unknown"}: ${BUILTIN_LICENSES[name] ?? "see wheel metadata"}`,
    ).join("\n") +
    `\n\nFull upstream license texts are included for Pyodide, CPython, Emscripten, and each wheel above under licenses/ (wheel texts are extracted from each wheel's dist-info).\n` +
    `This inventory covers the files listed here; it is not a complete SPDX expression for every native or transitive component. See licenses/pyodide/THIRD-PARTY-NOTICES.md.\n` +
    `Pyodide-built wheel names and sha256 values are taken from pyodide-lock.json.\n` +
    `Source wheels: PyPI and ${PYODIDE_CDN}\n`;
  const licenseBytes = Buffer.from(licenses);
  await writeFile(path.join(outputDir, "LICENSES.md"), licenseBytes);
  files.push({
    path: "LICENSES.md",
    size: licenseBytes.byteLength,
    sha256: sha256(licenseBytes),
  });

  const manifest: Manifest = {
    generatedBy: "server/formatter/build-assets.ts",
    pyodideVersion: PYODIDE_VERSION,
    sqlfluffVersion: SQLFLUFF_VERSION,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(path.join(outputDir, "manifest.json"), manifestText);
  console.log(
    `[formatter] wrote ${files.length} files (${(
      files.reduce((sum, file) => sum + file.size, 0) /
      1024 /
      1024
    ).toFixed(1)} MiB) to ${path.relative(appRoot, outputDir)}`,
  );
}

await main();
