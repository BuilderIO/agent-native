/**
 * Credentialless SQLFluff worker (TypeScript source; compiled to child.mjs).
 *
 * The parent sends one JSON request at a time over IPC. This process owns a
 * private Pyodide MEMFS and never mounts the host filesystem into Python. The
 * only host files read are the bundled Pyodide runtime and wheels below the
 * asset directory passed as argv[2].
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PyodideAPI, PyodideConfig } from "pyodide";

type WorkerError = { code: string; message: string };
type WorkerResponse =
  | {
      id?: number | undefined;
      valid: true;
      error: null;
      dialect: string;
      templater: string;
      formattedSource?: string;
      changed?: boolean;
    }
  | { id?: number | undefined; valid: false; error: WorkerError };
type WorkerRequest = {
  id?: number;
  type: "validate" | "format";
  config?: string;
  source?: string;
  fallbackDialect?: string;
};

type ManifestFile = { path: string; size: number; sha256: string };
type Manifest = { files: ManifestFile[] };

const assetDir = path.resolve(
  process.argv[2] || fileURLToPath(new URL(".", import.meta.url)),
);
const pyodideDir = path.join(assetDir, "runtime", "pyodide");
const wheelsDir = path.join(assetDir, "runtime", "wheels");

const BUILTIN_PACKAGES = [
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

const PYTHON_BOOTSTRAP = String.raw`
import configparser
import json
import os
import re

# Pyodide's os has getuid but not geteuid. SQLFluff 4.5 imports
# platformdirs.macos, whose module-level "from os import geteuid" otherwise
# fails on the Pyodide guest. This is a guest compatibility shim only.
if not hasattr(os, "geteuid"):
    os.geteuid = os.getuid

from sqlfluff.core import FluffConfig, Linter
from sqlfluff.core.errors import SQLParseError, SQLTemplaterError, SQLLintError

ALLOWED_TEMPLATERS = {"raw", "jinja", "placeholder"}
PATH_KEYS = {"library_path", "load_macros_from_path"}
INTEGER_CORE_KEYS = {
    "large_file_skip_byte_limit",
    "large_file_skip_char_limit",
    "max_line_length",
    "max_parse_depth",
    "max_parse_nodes",
    "output_line_length",
    "processes",
    "recursion_limit",
    "render_variant_limit",
    "runaway_limit",
    "rust_parser_max_iterations",
    "rust_parser_warn_threshold",
}
RULE_LIST_KEYS = {"rules", "exclude_rules", "rule_allowlist", "rule_denylist"}


class FormatterConfigError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def _error(code, message):
    return {"valid": False, "error": {"code": code, "message": message}}


def _read_parser(config):
    parser = configparser.ConfigParser(
        interpolation=None,
        strict=True,
        allow_no_value=True,
    )
    parser.read_string(config)
    return parser


def _core_values(parser):
    if not parser.has_section("sqlfluff"):
        return {}
    return {key.strip().lower(): value for key, value in parser.items("sqlfluff")}


def _rule_names(base):
    return {rule.name for rule in Linter(config=base).rule_tuples()}


def _validate_rule_refs(value, names, label):
    if value is None:
        return
    for raw in re.split(r"[,\s]+", value.strip()):
        if not raw:
            continue
        if raw not in names:
            raise FormatterConfigError(
                "unknown_rule",
                "Unsupported rule reference in " + label + ": " + raw +
                ". Use a SQLFluff 4 rule name.",
            )


def _validate_config(config, fallback_dialect):
    if not isinstance(config, str):
        raise FormatterConfigError("invalid_config", "The SQLFluff config must be text.")
    if len(config.encode("utf-8")) > 65536:
        raise FormatterConfigError(
            "config_too_large",
            "The SQLFluff config must be 64 KiB or smaller.",
        )
    try:
        parser = _read_parser(config)
    except Exception as exc:
        raise FormatterConfigError(
            "invalid_config",
            "The SQLFluff config is not valid INI: " + type(exc).__name__,
        ) from None

    core = _core_values(parser)
    try:
        base = FluffConfig.from_string("", overrides={"dialect": fallback_dialect})
    except KeyError as exc:
        if "Unknown dialect" in str(exc):
            raise FormatterConfigError(
                "invalid_dialect",
                "Unknown SQLFluff fallback dialect: " + fallback_dialect + ".",
            ) from None
        raise
    known_core = set(base.get_section(("core",)).keys())
    unknown_core = sorted(set(core) - known_core)
    if unknown_core:
        raise FormatterConfigError(
            "unknown_config_key",
            "Unsupported SQLFluff core option: " + unknown_core[0],
        )

    templater = (core.get("templater") or "jinja").strip().lower()
    if templater not in ALLOWED_TEMPLATERS:
        raise FormatterConfigError(
            "unsupported_templater",
            "Templater " + templater + " is not supported. Use raw, jinja, or placeholder.",
        )
    if (core.get("processes") or "1").strip() != "1":
        raise FormatterConfigError(
            "unsupported_config",
            "Parallel SQLFluff processes are not supported.",
        )
    if (core.get("use_rust_parser") or "").strip().lower() in {"1", "true", "yes", "on"}:
        raise FormatterConfigError(
            "unsupported_config",
            "The Rust parser is not bundled in this runtime.",
        )
    if (core.get("use_rust_rules") or "").strip().lower() in {"1", "true", "yes", "on"}:
        raise FormatterConfigError(
            "unsupported_config",
            "Rust rules are not bundled in this runtime.",
        )

    for key in INTEGER_CORE_KEYS:
        if key in core and core[key] not in (None, ""):
            try:
                int(core[key])
            except ValueError:
                raise FormatterConfigError(
                    "invalid_config",
                    "SQLFluff option " + key + " must be an integer.",
                ) from None

    names = _rule_names(base)
    for key in RULE_LIST_KEYS:
        _validate_rule_refs(core.get(key), names, key)

    jinja_keys = {"apply_dbt_builtins", "macros", "context", "library_path", "load_macros_from_path"}
    for section in parser.sections():
        values = {key.strip().lower(): value for key, value in parser.items(section)}
        for key in values:
            if key in PATH_KEYS:
                raise FormatterConfigError(
                    "unsupported_config",
                    "File/path templater options are not supported: " + key,
                )
        if section == "sqlfluff":
            continue
        if section == "sqlfluff:rules":
            unknown = sorted(set(values) - set(base.get_section(("rules",)) or {}))
            if unknown:
                raise FormatterConfigError(
                    "unknown_config_key",
                    "Unsupported SQLFluff rules option: " + unknown[0],
                )
            continue
        if section.startswith("sqlfluff:rules:"):
            name = section.split(":", 2)[2]
            if name not in names:
                raise FormatterConfigError(
                    "unknown_rule",
                    "Unsupported SQLFluff rule section: " + name,
                )
            known_values = set(base.get_section(("rules", name)) or {})
            unknown = sorted(set(values) - known_values)
            if unknown:
                raise FormatterConfigError(
                    "unknown_rule_option",
                    "Unsupported option for " + name + ": " + unknown[0],
                )
            continue
        if section == "sqlfluff:indentation":
            unknown = sorted(set(values) - set(base.get_section(("indentation",)) or {}))
            if unknown:
                raise FormatterConfigError(
                    "unknown_config_key",
                    "Unsupported indentation option: " + unknown[0],
                )
            continue
        if section == "sqlfluff:templater:jinja":
            unknown = sorted(set(values) - jinja_keys)
            if unknown:
                raise FormatterConfigError(
                    "unknown_config_key",
                    "Unsupported Jinja option: " + unknown[0],
                )
            continue
        if section in ("sqlfluff:templater:jinja:context", "sqlfluff:templater:jinja:macros"):
            continue
        if section == "sqlfluff:templater:placeholder":
            continue
        if section == "sqlfluff:layout" or section.startswith("sqlfluff:layout:"):
            # SQLFluff validates layout structure and values itself.
            continue
        raise FormatterConfigError(
            "unknown_config_section",
            "Unsupported SQLFluff section: " + section,
        )

    overrides = {"dialect": fallback_dialect} if not core.get("dialect") else None
    try:
        conf = FluffConfig.from_string(config, overrides=overrides)
    except KeyError as exc:
        if "Unknown dialect" in str(exc):
            raise FormatterConfigError(
                "invalid_dialect",
                "Unknown SQLFluff dialect: " + str(core.get("dialect") or fallback_dialect) + ".",
            ) from None
        raise
    except Exception as exc:
        raise FormatterConfigError(
            "invalid_config",
            "The SQLFluff config could not be loaded: " + type(exc).__name__,
        ) from None

    if conf.get("templater") not in ALLOWED_TEMPLATERS:
        raise FormatterConfigError(
            "unsupported_templater",
            "The configured SQLFluff templater is not supported.",
        )
    try:
        Linter(config=conf).rule_tuples()
    except Exception as exc:
        raise FormatterConfigError(
            "invalid_config",
            "The SQLFluff rules could not be loaded: " + type(exc).__name__,
        ) from None
    return conf


def _format(config, source, fallback_dialect):
    if not isinstance(source, str):
        raise FormatterConfigError("invalid_sql", "The SQL must be text.")
    if len(source.encode("utf-8")) > 1024 * 1024:
        raise FormatterConfigError("sql_too_large", "The SQL must be 1 MB or smaller.")
    source = source.removeprefix("\ufeff")
    conf = _validate_config(config, fallback_dialect)
    linter = Linter(config=conf)
    try:
        parsed = linter.parse_string(source)
    except AssertionError:
        raise FormatterConfigError(
            "template_error",
            "SQLFluff could not render or parse the SQL.",
        ) from None
    except Exception as exc:
        raise FormatterConfigError(
            "engine_error",
            "SQLFluff failed while parsing the SQL: " + type(exc).__name__,
        ) from None

    template_errors = [
        violation for violation in parsed.violations
        if isinstance(violation, SQLTemplaterError) or violation.rule_code() in {"TMP", "LXR"}
    ]
    if template_errors:
        raise FormatterConfigError(
            "template_error",
            "SQLFluff could not render the SQL with the configured templater.",
        )
    parse_errors = [
        violation for violation in parsed.violations
        if isinstance(violation, SQLParseError) or violation.rule_code() == "PRS"
    ]
    if parse_errors:
        raise FormatterConfigError(
            "parse_error",
            "SQLFluff could not parse the SQL.",
        )

    try:
        result = linter.lint_string(source, fix=True)
    except AssertionError:
        raise FormatterConfigError(
            "parse_error",
            "SQLFluff could not fix the SQL because it was not parseable.",
        ) from None
    except Exception as exc:
        raise FormatterConfigError(
            "engine_error",
            "SQLFluff failed while formatting the SQL: " + type(exc).__name__,
        ) from None

    for violation in result.violations:
        if isinstance(violation, SQLLintError) and "Unexpected exception" in violation.desc():
            raise FormatterConfigError(
                "engine_error",
                "A SQLFluff rule failed unexpectedly.",
            )

    fixed, changed = result.fix_string()
    if fixed is None:
        raise FormatterConfigError("engine_error", "SQLFluff returned no formatted SQL.")
    return {
        "formattedSource": fixed,
        "changed": bool(changed),
        "dialect": conf.get("dialect"),
        "templater": conf.get("templater"),
    }


def _handle(request_json):
    request = json.loads(request_json)
    try:
        kind = request.get("type")
        config = request.get("config", "")
        fallback = request.get("fallbackDialect", "bigquery")
        if kind == "validate":
            conf = _validate_config(config, fallback)
            return json.dumps({
                "valid": True,
                "error": None,
                "dialect": conf.get("dialect"),
                "templater": conf.get("templater"),
            })
        if kind == "format":
            return json.dumps({
                "valid": True,
                "error": None,
                **_format(config, request.get("source", ""), fallback),
            })
        return json.dumps(_error("invalid_request", "Unknown formatter request."))
    except FormatterConfigError as exc:
        return json.dumps({"valid": False, "error": {"code": exc.code, "message": exc.message}})
    except Exception as exc:
        return json.dumps(_error("engine_error", "SQLFluff runtime failure: " + type(exc).__name__))
`;

let pyodide: PyodideAPI | null = null;
let loaded = false;
let loading: Promise<PyodideAPI> | null = null;

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

function isSafeManifestPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    return false;
  }
  if (value.includes("\\") || value.includes("\0")) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return (
    normalized === value &&
    normalized !== ".." &&
    !normalized.startsWith("../") &&
    !normalized.startsWith("./")
  );
}

async function listAssetFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(
        "Bundled formatter asset must not be a symlink: " + relative,
      );
    }
    if (entry.isDirectory()) {
      files.push(
        ...(await listAssetFiles(path.join(root, entry.name), relative)),
      );
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error("Unsupported bundled formatter asset: " + relative);
    }
  }
  return files;
}

async function verifyBundledAssets(): Promise<Manifest> {
  const manifestPath = path.join(assetDir, "manifest.json");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  } catch {
    throw new Error("SQLFluff formatter manifest is missing.");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("SQLFluff formatter manifest lists no assets.");
  }

  const listed = new Set<string>();
  for (const file of manifest.files) {
    if (!isSafeManifestPath(file.path)) {
      throw new Error(
        "Invalid bundled formatter asset path: " + String(file.path),
      );
    }
    if (listed.has(file.path)) {
      throw new Error("Duplicate bundled formatter asset entry: " + file.path);
    }
    listed.add(file.path);
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      throw new Error("Invalid bundled formatter asset entry: " + file.path);
    }
    const target = path.join(assetDir, file.path);
    let info;
    try {
      info = await stat(target);
    } catch {
      throw new Error("Missing bundled formatter asset: " + file.path);
    }
    if (!info.isFile() || info.size !== file.size) {
      throw new Error("Bundled formatter asset size mismatch: " + file.path);
    }
    if ((await sha256(target)) !== file.sha256) {
      throw new Error(
        "Bundled formatter asset integrity mismatch: " + file.path,
      );
    }
  }

  // The manifest is a closed set: never load a stale/orphaned extra wheel or
  // any other unlisted file from the bundled directory.
  for (const relative of await listAssetFiles(assetDir)) {
    if (relative === "manifest.json") continue;
    if (!listed.has(relative)) {
      throw new Error("Unlisted bundled formatter asset: " + relative);
    }
  }
  return manifest;
}

function manifestWheels(manifest: Manifest): string[] {
  const prefix = "runtime/wheels/";
  return manifest.files
    .map((file) => file.path)
    .filter((file) => file.startsWith(prefix))
    .map((file) => file.slice(prefix.length))
    .filter((name) => name.endsWith(".whl") && !name.includes("/"))
    .sort();
}

async function loadRuntime(): Promise<PyodideAPI> {
  if (loaded && pyodide) return pyodide;
  if (loading) return loading;
  loading = (async () => {
    const manifest = await verifyBundledAssets();
    const pyodideEntry = path.join(pyodideDir, "pyodide.mjs");
    const module = (await import(pathToFileURL(pyodideEntry).href)) as {
      loadPyodide: (options: PyodideConfig) => Promise<PyodideAPI>;
    };
    const runtime = await module.loadPyodide({
      indexURL: pyodideDir + path.sep,
      jsglobals: {},
      stdout: () => {},
      stderr: () => {},
    });
    await runtime.loadPackage(BUILTIN_PACKAGES);
    const wheels = manifestWheels(manifest);
    if (wheels.length === 0) {
      throw new Error("SQLFluff formatter manifest lists no Python wheels.");
    }
    runtime.FS.mkdir("/wheels");
    for (const wheel of wheels) {
      runtime.FS.writeFile(
        "/wheels/" + wheel,
        await readFile(path.join(wheelsDir, wheel)),
      );
    }
    runtime.globals.set(
      "__sqlfluff_wheels",
      wheels.map((wheel) => "emfs:/wheels/" + wheel),
    );
    await runtime.runPythonAsync(
      "import micropip\nawait micropip.install(__sqlfluff_wheels, deps=False)\ndel __sqlfluff_wheels",
    );
    runtime.runPython(PYTHON_BOOTSTRAP);
    pyodide = runtime;
    loaded = true;
    return runtime;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

function respond(message: WorkerResponse): void {
  if (process.send) {
    process.send(message);
  } else {
    process.stdout.write(JSON.stringify(message) + "\n");
  }
}

async function handleMessage(message: WorkerRequest): Promise<void> {
  const id = message.id;
  try {
    const runtime = await loadRuntime();
    runtime.globals.set("__sqlfluff_request", JSON.stringify(message));
    let raw: string;
    try {
      raw = runtime.runPython("_handle(__sqlfluff_request)");
    } finally {
      runtime.globals.delete("__sqlfluff_request");
    }
    const parsed = JSON.parse(raw) as WorkerResponse;
    respond({ id, ...parsed });
  } catch (error) {
    // Never include SQL or config in the IPC error.
    respond({
      id,
      valid: false,
      error: {
        code: "runtime_error",
        message:
          error instanceof Error ? error.message : "SQLFluff runtime failure.",
      },
    });
  }
}

async function handleOnce(): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  try {
    const request = JSON.parse(input) as WorkerRequest;
    const runtime = await loadRuntime();
    runtime.globals.set("__sqlfluff_request", JSON.stringify(request));
    let raw: string;
    try {
      raw = runtime.runPython("_handle(__sqlfluff_request)");
    } finally {
      runtime.globals.delete("__sqlfluff_request");
    }
    process.stdout.write(raw + "\n");
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        valid: false,
        error: {
          code: "runtime_error",
          message:
            error instanceof Error
              ? error.message
              : "SQLFluff runtime failure.",
        },
      }) + "\n",
    );
  }
}

if (process.argv.includes("--once")) {
  void handleOnce();
} else {
  process.on("message", (message: unknown) => {
    void handleMessage(message as WorkerRequest);
  });
  process.on("disconnect", () => process.exit(0));
}
