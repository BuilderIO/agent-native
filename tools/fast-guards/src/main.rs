use ignore::WalkBuilder;
use rayon::prelude::*;
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::LazyLock;
use std::time::Instant;

#[derive(Serialize)]
struct GuardReport {
    name: String,
    passed: bool,
    elapsed_ms: u128,
    summary: String,
    violations: Vec<String>,
}

// ---------- 1. guard:agent-native-brand ----------
static LEGACY_ASSET_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bagent[ \t]+native(?:[ \t]+nightly)?-").unwrap());
static SPACED_BRAND_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bagent[ \t]+native").unwrap());
static WRONG_TITLE_CASE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bAgent-native\b").unwrap());
static BRAND_PRAGMA_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)//\s*agent-native-brand-ok:").unwrap());

fn has_spaced_brand_violation(line: &str) -> bool {
    let cleaned = LEGACY_ASSET_RE.replace_all(line, "legacy-");
    let bytes = cleaned.as_bytes();
    for m in SPACED_BRAND_RE.find_iter(&cleaned) {
        let after = bytes.get(m.end()).copied();
        let followed_by_dash_or_letter = matches!(after, Some(b'-') | Some(b'A'..=b'Z') | Some(b'a'..=b'z'));
        if !followed_by_dash_or_letter {
            return true;
        }
    }
    WRONG_TITLE_CASE_RE.is_match(line)
}

fn check_brand_file(rel: &str, text: &str) -> Vec<String> {
    if rel == "scripts/guard-agent-native-brand.ts" {
        return Vec::new();
    }
    // Fast prefilter: skip files without "agent" (case-insensitive)
    if !text.as_bytes().windows(5).any(|w| w.eq_ignore_ascii_case(b"agent")) {
        return Vec::new();
    }
    let lines: Vec<&str> = text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect();
    let mut out = Vec::new();
    for (idx, line) in lines.iter().enumerate() {
        let cur_ok = BRAND_PRAGMA_RE.is_match(line);
        let prev_ok = idx > 0 && BRAND_PRAGMA_RE.is_match(lines[idx - 1]);
        if cur_ok || prev_ok {
            continue;
        }
        if has_spaced_brand_violation(line) {
            out.push(format!("{}:{}", rel, idx + 1));
        }
    }
    out
}

// ---------- 2. guard:no-secret-literals ----------
static SECRET_PLACEHOLDER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bexample\b|\bplaceholder\b|\byour-|xxx|<|\bREPLACE\b|\bfake\b|\bdummy\b").unwrap()
});
static SECRET_PRAGMA_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?://|#|<!--)\s*guard:allow-secret-literal\b").unwrap());
static RE_ANTHROPIC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"sk-ant-[A-Za-z0-9_-]{20,}").unwrap());
static RE_GENERIC_SK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bsk-[A-Za-z0-9]{32,}\b").unwrap());
static RE_DB_URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(postgres(?:ql)?)://([^\s:@/]+):([^\s@/]+)@").unwrap());
static RE_NEON: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bnpg_[A-Za-z0-9]{12,}\b").unwrap());
static RE_GH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bgh[poasru]_[A-Za-z0-9]{30,}\b").unwrap());
static RE_SLACK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b").unwrap());
static RE_AWS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap());
static RE_GOOGLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bAIza[0-9A-Za-z_-]{30,}\b").unwrap());
static RE_PEM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"-----BEGIN (?:[A-Z ]*)PRIVATE KEY-----").unwrap());
static RE_COMBINED_SECRET_PREFILTER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"sk-|postgres(?:ql)?://|npg_|gh[poasru]_|xox[baprs]-|AKIA|AIza|PRIVATE KEY-----").unwrap()
});

const DB_PLACEHOLDER_PASSWORDS: &[&str] = &[
    "pass", "password", "p", "changeme", "change-me", "secret", "admin",
    "root", "test", "demo", "guest", "npg_pw", "pw", "dummy", "fake",
];

const LOCK_FILE_NAMES: &[&str] = &[
    "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock",
    "bun.lock", "bun.lockb", "Cargo.lock", "composer.lock", "Gemfile.lock",
    "poetry.lock", "Pipfile.lock",
];

const BINARY_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "avif",
    "woff", "woff2", "ttf", "eot", "otf", "mp4", "webm", "mov", "avi",
    "mp3", "wav", "ogg", "flac", "zip", "gz", "tgz", "tar", "rar", "7z",
    "pdf", "exe", "dll", "so", "dylib", "bin", "wasm", "class", "jar",
    "pyc", "node",
];

fn is_all_same_char_run(s: &str) -> bool {
    let mut prev: Option<char> = None;
    let mut run = 0usize;
    for ch in s.chars() {
        if Some(ch) == prev {
            run += 1;
            if run >= 8 {
                return true;
            }
        } else {
            prev = Some(ch);
            run = 1;
        }
    }
    false
}

fn redact_edges(m: &str, head: usize, tail: usize) -> String {
    if m.len() <= head + tail + 4 {
        return "[REDACTED]".to_string();
    }
    let hidden = m.len() - head - tail;
    format!("{}…({} chars redacted)…{}", &m[..head], hidden, &m[m.len() - tail..])
}

fn line_index_for_offset(text: &str, offset: usize) -> usize {
    text.as_bytes()[..offset].iter().filter(|&&b| b == b'\n').count()
}

fn is_secret_skipped_path(rel: &str) -> bool {
    for seg in rel.split('/') {
        if matches!(seg, "node_modules" | "dist" | "build" | ".git") {
            return true;
        }
    }
    let base = rel.rsplit('/').next().unwrap_or(rel);
    if LOCK_FILE_NAMES.contains(&base) {
        return true;
    }
    if let Some(ext) = Path::new(base).extension().and_then(|e| e.to_str()) {
        if BINARY_EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
            return true;
        }
    }
    false
}

fn check_secret_file(rel: &str, text: &str) -> Vec<String> {
    if is_secret_skipped_path(rel) || text.len() > 2 * 1024 * 1024 {
        return Vec::new();
    }
    if !RE_COMBINED_SECRET_PREFILTER.is_match(text) {
        return Vec::new();
    }
    let lines: Vec<&str> = text.split('\n').collect();
    let has_opt_out = |idx: usize| -> bool {
        let cur = lines.get(idx).copied().unwrap_or("");
        if SECRET_PRAGMA_RE.is_match(cur) {
            return true;
        }
        idx > 0 && SECRET_PRAGMA_RE.is_match(lines.get(idx - 1).copied().unwrap_or(""))
    };
    let mut out = Vec::new();

    let simple_patterns: &[(&str, &Regex, usize, usize, bool)] = &[
        ("Anthropic API key", &RE_ANTHROPIC, 7, 4, false),
        ("generic sk- API key", &RE_GENERIC_SK, 5, 4, false),
        ("Neon API key", &RE_NEON, 4, 4, false),
        ("GitHub token", &RE_GH, 4, 4, false),
        ("Slack token", &RE_SLACK, 5, 4, true),
        ("AWS access key id", &RE_AWS, 6, 4, false),
        ("Google API key", &RE_GOOGLE, 6, 4, false),
    ];

    for &(name, re, head, tail, require_digit) in simple_patterns {
        for m in re.find_iter(text) {
            let ms = m.as_str();
            let line_idx = line_index_for_offset(text, m.start());
            let line_text = lines.get(line_idx).copied().unwrap_or("");
            if SECRET_PLACEHOLDER_RE.is_match(line_text)
                || is_all_same_char_run(ms)
                || has_opt_out(line_idx)
            {
                continue;
            }
            if require_digit && !ms.bytes().any(|b| b.is_ascii_digit()) {
                continue;
            }
            out.push(format!("{}:{}  [{}] {}", rel, line_idx + 1, name, redact_edges(ms, head, tail)));
        }
    }

    for cap in RE_DB_URL.captures_iter(text) {
        let m = cap.get(0).unwrap();
        let scheme = cap.get(1).unwrap().as_str();
        let user = cap.get(2).unwrap().as_str();
        let pass = cap.get(3).unwrap().as_str();
        let line_idx = line_index_for_offset(text, m.start());
        let line_text = lines.get(line_idx).copied().unwrap_or("");
        if SECRET_PLACEHOLDER_RE.is_match(line_text)
            || is_all_same_char_run(m.as_str())
            || has_opt_out(line_idx)
            || DB_PLACEHOLDER_PASSWORDS.contains(&pass.to_ascii_lowercase().as_str())
        {
            continue;
        }
        out.push(format!(
            "{}:{}  [database connection string with password] {}://{}:***@",
            rel,
            line_idx + 1,
            scheme,
            user
        ));
    }

    for m in RE_PEM.find_iter(text) {
        let line_idx = line_index_for_offset(text, m.start());
        let line_text = lines.get(line_idx).copied().unwrap_or("");
        if SECRET_PLACEHOLDER_RE.is_match(line_text)
            || is_all_same_char_run(m.as_str())
            || has_opt_out(line_idx)
        {
            continue;
        }
        if let Some(end_rel) = text[m.end()..].find("-----END") {
            let body_len = text[m.end()..m.end() + end_rel]
                .bytes()
                .filter(|b| !b.is_ascii_whitespace())
                .count();
            if body_len < 40 {
                continue;
            }
        }
        out.push(format!("{}:{}  [PEM private key] {}", rel, line_idx + 1, m.as_str()));
    }

    out
}

// ---------- 3. guard:no-core-client-barrel-imports ----------
const BARE_CLIENT_ENTRY: &str = "@agent-native/core/client";
const BARREL_EXCLUDED_DIRS: &[&str] = &[
    "__tests__", "build", "corpus", "coverage", "dist", "generated", "node_modules", "vendor",
];

fn should_scan_barrel(rel: &str) -> bool {
    if !(rel.starts_with("packages/") || rel.starts_with("templates/")) {
        return false;
    }
    if !(rel.ends_with(".ts") || rel.ends_with(".tsx")) {
        return false;
    }
    if rel.ends_with(".generated.ts")
        || rel.ends_with(".generated.tsx")
        || rel.ends_with(".gen.ts")
        || rel.ends_with(".gen.tsx")
    {
        return false;
    }
    if rel == "packages/core/src/client/index.ts" {
        return false;
    }
    !rel.split('/').any(|seg| BARREL_EXCLUDED_DIRS.contains(&seg) || seg.starts_with("corpus.tmp-"))
}

fn is_ident_byte(b: Option<u8>) -> bool {
    matches!(b, Some(b'A'..=b'Z') | Some(b'a'..=b'z') | Some(b'0'..=b'9') | Some(b'_') | Some(b'$'))
}

fn skip_space_and_comments(bytes: &[u8], mut cursor: usize) -> usize {
    let n = bytes.len();
    while cursor < n {
        if bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
            continue;
        }
        if cursor + 1 < n && bytes[cursor] == b'/' && bytes[cursor + 1] == b'/' {
            cursor += 2;
            while cursor < n && bytes[cursor] != b'\n' {
                cursor += 1;
            }
            if cursor < n {
                cursor += 1;
            }
            continue;
        }
        if cursor + 1 < n && bytes[cursor] == b'/' && bytes[cursor + 1] == b'*' {
            cursor += 2;
            while cursor + 1 < n && !(bytes[cursor] == b'*' && bytes[cursor + 1] == b'/') {
                cursor += 1;
            }
            cursor = (cursor + 2).min(n);
            continue;
        }
        return cursor;
    }
    cursor
}

fn read_quoted_string(bytes: &[u8], start: usize) -> Option<(usize, String)> {
    let quote = *bytes.get(start)?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    let mut val = String::new();
    let mut cursor = start + 1;
    let n = bytes.len();
    while cursor < n {
        let ch = bytes[cursor];
        if ch == b'\\' {
            if cursor + 1 < n {
                val.push(bytes[cursor + 1] as char);
            }
            cursor += 2;
            continue;
        }
        if ch == quote {
            return Some((cursor + 1, val));
        }
        val.push(ch as char);
        cursor += 1;
    }
    None
}

fn skip_string_literal(bytes: &[u8], start: usize) -> usize {
    let quote = bytes[start];
    let n = bytes.len();
    let mut cursor = start + 1;
    while cursor < n {
        if bytes[cursor] == b'\\' {
            cursor += 2;
        } else if bytes[cursor] == quote {
            return cursor + 1;
        } else {
            cursor += 1;
        }
    }
    n
}

fn scan_static_module_specifiers(source: &str) -> Vec<(usize, String)> {
    let bytes = source.as_bytes();
    let n = bytes.len();
    let mut specifiers = Vec::new();
    let mut cursor = 0;
    while cursor < n {
        let c = bytes[cursor];
        if c == b'\'' || c == b'"' || c == b'`' {
            cursor = skip_string_literal(bytes, cursor);
            continue;
        }
        if cursor + 1 < n && c == b'/' && bytes[cursor + 1] == b'/' {
            cursor += 2;
            while cursor < n && bytes[cursor] != b'\n' {
                cursor += 1;
            }
            if cursor < n {
                cursor += 1;
            }
            continue;
        }
        if cursor + 1 < n && c == b'/' && bytes[cursor + 1] == b'*' {
            cursor += 2;
            while cursor + 1 < n && !(bytes[cursor] == b'*' && bytes[cursor + 1] == b'/') {
                cursor += 1;
            }
            cursor = (cursor + 2).min(n);
            continue;
        }
        let prev = if cursor > 0 { Some(bytes[cursor - 1]) } else { None };
        let kw_len = if !is_ident_byte(prev)
            && bytes[cursor..].starts_with(b"import")
            && !is_ident_byte(bytes.get(cursor + 6).copied())
        {
            Some((6usize, true))
        } else if !is_ident_byte(prev)
            && bytes[cursor..].starts_with(b"export")
            && !is_ident_byte(bytes.get(cursor + 6).copied())
        {
            Some((6usize, false))
        } else {
            None
        };
        let Some((len, is_import)) = kw_len else {
            cursor += 1;
            continue;
        };
        let decl_start = cursor;
        cursor = skip_space_and_comments(bytes, cursor + len);
        if is_import {
            if let Some((end, value)) = read_quoted_string(bytes, cursor) {
                specifiers.push((cursor, value));
                cursor = end;
                continue;
            }
        }
        loop {
            if cursor >= n || bytes[cursor] == b';' {
                break;
            }
            if cursor + 1 < n && bytes[cursor] == b'/' && bytes[cursor + 1] == b'/' {
                cursor += 2;
                while cursor < n && bytes[cursor] != b'\n' {
                    cursor += 1;
                }
                if cursor < n {
                    cursor += 1;
                }
                continue;
            }
            if cursor + 1 < n && bytes[cursor] == b'/' && bytes[cursor + 1] == b'*' {
                cursor += 2;
                while cursor + 1 < n && !(bytes[cursor] == b'*' && bytes[cursor + 1] == b'/') {
                    cursor += 1;
                }
                cursor = (cursor + 2).min(n);
                continue;
            }
            let p = if cursor > 0 { Some(bytes[cursor - 1]) } else { None };
            if bytes[cursor..].starts_with(b"from")
                && !is_ident_byte(p)
                && !is_ident_byte(bytes.get(cursor + 4).copied())
            {
                let spec_start = skip_space_and_comments(bytes, cursor + 4);
                if let Some((end, value)) = read_quoted_string(bytes, spec_start) {
                    specifiers.push((spec_start, value));
                    cursor = end;
                    break;
                }
            }
            if matches!(bytes[cursor], b'\'' | b'"' | b'`') {
                cursor = skip_string_literal(bytes, cursor);
                if cursor.saturating_sub(decl_start) > 20_000 {
                    break;
                }
                continue;
            }
            cursor += 1;
            if cursor - decl_start > 20_000 {
                break;
            }
        }
    }
    specifiers
}

fn scan_vitest_mock_specifiers(source: &str) -> Vec<(usize, String)> {
    let bytes = source.as_bytes();
    let n = bytes.len();
    let mut specifiers = Vec::new();
    let mut cursor = 0;
    while cursor < n {
        let c = bytes[cursor];
        if c == b'\'' || c == b'"' || c == b'`' {
            cursor = skip_string_literal(bytes, cursor);
            continue;
        }
        if cursor + 1 < n && c == b'/' && bytes[cursor + 1] == b'/' {
            cursor += 2;
            while cursor < n && bytes[cursor] != b'\n' {
                cursor += 1;
            }
            if cursor < n {
                cursor += 1;
            }
            continue;
        }
        if cursor + 1 < n && c == b'/' && bytes[cursor + 1] == b'*' {
            cursor += 2;
            while cursor + 1 < n && !(bytes[cursor] == b'*' && bytes[cursor + 1] == b'/') {
                cursor += 1;
            }
            cursor = (cursor + 2).min(n);
            continue;
        }
        let prev = if cursor > 0 { Some(bytes[cursor - 1]) } else { None };
        if !is_ident_byte(prev) && bytes[cursor..].starts_with(b"vi") && !is_ident_byte(bytes.get(cursor + 2).copied()) {
            let mut p = cursor + 2;
            while p < n && bytes[p].is_ascii_whitespace() { p += 1; }
            if p < n && bytes[p] == b'.' {
                p += 1;
                while p < n && bytes[p].is_ascii_whitespace() { p += 1; }
                let mlen = if bytes[p..].starts_with(b"doMock") {
                    Some(6usize)
                } else if bytes[p..].starts_with(b"mock") {
                    Some(4usize)
                } else {
                    None
                };
                if let Some(ml) = mlen {
                    if !is_ident_byte(bytes.get(p + ml).copied()) {
                        p += ml;
                        while p < n && bytes[p].is_ascii_whitespace() { p += 1; }
                        if p < n && bytes[p] == b'(' {
                            let spec_start = skip_space_and_comments(bytes, p + 1);
                            if let Some((end, value)) = read_quoted_string(bytes, spec_start) {
                                specifiers.push((spec_start, value));
                                cursor = end;
                                continue;
                            }
                            cursor = p + 1;
                            continue;
                        }
                    }
                }
            }
        }
        cursor += 1;
    }
    specifiers
}

fn check_barrel_file(rel: &str, text: &str) -> Vec<String> {
    if !should_scan_barrel(rel) || !text.contains(BARE_CLIENT_ENTRY) {
        return Vec::new();
    }
    let mut hits: Vec<usize> = Vec::new();
    for (idx, val) in scan_static_module_specifiers(text)
        .into_iter()
        .chain(scan_vitest_mock_specifiers(text))
    {
        if val == BARE_CLIENT_ENTRY {
            hits.push(idx);
        }
    }
    hits.sort_unstable();
    hits.into_iter()
        .map(|idx| {
            format!(
                "{}:{} imports the deprecated {} barrel; use a focused subpath instead.",
                rel,
                line_index_for_offset(text, idx) + 1,
                BARE_CLIENT_ENTRY
            )
        })
        .collect()
}

// ---------- 4. guard:no-env-mutation ----------
static ENV_MUT_OPT_OUT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"//\s*guard:allow-env-mutation\b").unwrap());
static ENV_MUT_OPT_OUT_REASON_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"//\s*guard:allow-env-mutation\s*(?:—|-)\s*\S").unwrap());
static ENV_MUT_MEMBER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"process\.env\.[A-Z_][A-Z0-9_]*\s*(?:=|\+=|-=|\*=|/=|\?\?=|\|\|=|&&=)").unwrap()
});
static ENV_MUT_BRACKET_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"process\.env\[\s*["'][A-Z_][A-Z0-9_]+["']\s*\]\s*(?:=|\+=|-=|\*=|/=|\?\?=|\|\|=|&&=)"#).unwrap()
});
static ENV_MUT_DELETE_MEMBER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bdelete\s+process\.env\.[A-Z_][A-Z0-9_]*\b").unwrap());
static ENV_MUT_DELETE_BRACKET_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\bdelete\s+process\.env\[\s*["'][A-Z_][A-Z0-9_]+["']\s*\]"#).unwrap());
static SPEC_OR_TEST_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\.(?:spec|test)\.[tj]sx?$").unwrap());
static JS_TS_EXT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\.(?:ts|tsx|mts|cts|js|mjs|cjs)$").unwrap());
static TEMPLATES_TEST_DIR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^templates/[^/]+/tests?/").unwrap());

fn is_comment_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with('*') || trimmed.starts_with("//") || trimmed.starts_with("/*")
}

fn line_col_for_offset(text: &str, offset: usize) -> (usize, usize) {
    let mut line = 1usize;
    let mut line_start = 0usize;
    for (idx, &b) in text.as_bytes()[..offset].iter().enumerate() {
        if b == b'\n' {
            line += 1;
            line_start = idx + 1;
        }
    }
    (line, offset - line_start + 1)
}

fn has_line_opt_out(lines: &[&str], line_idx: usize, marker: &Regex, reason: &Regex) -> bool {
    let cur = lines.get(line_idx).copied().unwrap_or("");
    if marker.is_match(cur) {
        return reason.is_match(cur);
    }
    if line_idx > 0 {
        let prev = lines.get(line_idx - 1).copied().unwrap_or("");
        if prev.trim_start().starts_with("//") && marker.is_match(prev) {
            return reason.is_match(prev);
        }
    }
    false
}

fn is_env_mut_allowed_path(rel: &str) -> bool {
    rel.starts_with("scripts/")
        || SPEC_OR_TEST_RE.is_match(rel)
        || TEMPLATES_TEST_DIR_RE.is_match(rel)
        || rel.starts_with("packages/core/src/dev")
        || rel.contains("/cli/")
        || rel.contains("/scaffold/")
        || rel.starts_with("packages/cli/")
        || rel.starts_with("packages/create-agent-native/")
}

fn is_env_mut_skipped_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | ".tmp"
            | "dist"
            | "build"
            | ".next"
            | ".nuxt"
            | ".output"
            | ".cache"
            | ".turbo"
            | ".netlify"
            | ".vercel"
            | ".wrangler"
            | ".react-router"
            | ".generated"
            | ".claude"
            | "out"
            | "coverage"
    )
}

fn check_env_mutation_file(rel: &str, text: &str) -> Vec<String> {
    if !JS_TS_EXT_RE.is_match(rel) || rel.ends_with(".d.ts") || is_env_mut_allowed_path(rel) {
        return Vec::new();
    }
    if rel.split('/').any(is_env_mut_skipped_dir) || !text.contains("process.env") {
        return Vec::new();
    }
    let lines: Vec<&str> = text.split('\n').collect();
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    for (re, check_not_eq) in [
        (&*ENV_MUT_MEMBER_RE, true),
        (&*ENV_MUT_BRACKET_RE, true),
        (&*ENV_MUT_DELETE_MEMBER_RE, false),
        (&*ENV_MUT_DELETE_BRACKET_RE, false),
    ] {
        for m in re.find_iter(text) {
            if check_not_eq
                && m.as_str().ends_with('=')
                && !m.as_str().ends_with("+=")
                && !m.as_str().ends_with("-=")
                && !m.as_str().ends_with("*=")
                && !m.as_str().ends_with("/=")
                && !m.as_str().ends_with("??=")
                && !m.as_str().ends_with("||=")
                && !m.as_str().ends_with("&&=")
                && bytes.get(m.end()) == Some(&b'=')
            {
                continue;
            }
            let (line, col) = line_col_for_offset(text, m.start());
            let line_text = lines.get(line - 1).copied().unwrap_or("");
            if is_comment_line(line_text)
                || has_line_opt_out(&lines, line - 1, &ENV_MUT_OPT_OUT_RE, &ENV_MUT_OPT_OUT_REASON_RE)
            {
                continue;
            }
            out.push(format!("{}:{}:{}  {}", rel, line, col, line_text.trim()));
        }
    }
    out
}

// ---------- 5. guard:extension-no-public ----------
static EXT_TYPE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"type\s*:\s*["']extension["']"#).unwrap());
static EXT_ALLOW_PUBLIC_FALSE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"allowPublic\s*:\s*false").unwrap());
static EXT_REQUIRE_ORG_TRUE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"requireOrgMemberForUserShares\s*:\s*true").unwrap());
static EXT_VIS_JSON_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"visibility\s*:\s*["']public["']"#).unwrap());
static EXT_VIS_SQL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"visibility\s*=\s*'public'").unwrap());
static EXT_FILE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\.(?:ts|tsx|mjs|js|cjs)$").unwrap());

fn strip_js_comments_keep_strings(input: &str) -> String {
    let bytes = input.as_bytes();
    let n = bytes.len();
    let mut out = String::with_capacity(n);
    let mut i = 0;
    while i < n {
        let ch = bytes[i];
        let next = bytes.get(i + 1).copied();
        if ch == b'/' && next == Some(b'/') {
            while i < n && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if ch == b'/' && next == Some(b'*') {
            i += 2;
            while i + 1 < n && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(n);
            continue;
        }
        if ch == b'"' || ch == b'\'' || ch == b'`' {
            let start = i;
            let end = skip_string_literal(bytes, i);
            out.push_str(&input[start..end]);
            i = end;
            continue;
        }
        let ch_char = input[i..].chars().next().unwrap();
        out.push(ch_char);
        i += ch_char.len_utf8();
    }
    out
}

fn check_extension_no_public_file(rel: &str, text: &str) -> Vec<String> {
    if !EXT_FILE_RE.is_match(rel) || rel == "scripts/guard-extension-no-public.mjs" {
        return Vec::new();
    }
    for seg in rel.split('/') {
        if (seg.starts_with('.') && seg != ".agents")
            || matches!(
                seg,
                "node_modules" | "dist" | "build" | "coverage"
            )
        {
            return Vec::new();
        }
    }
    let mut out = Vec::new();
    if let Some(first_idx) = text.find("registerShareableResource(") {
        let mut cursor = first_idx;
        let bytes = text.as_bytes();
        loop {
            let Some(open_paren_rel) = text[cursor..].find('(') else { break };
            let open_paren = cursor + open_paren_rel;
            let Some(open_brace_rel) = text[open_paren..].find('{') else { break };
            let open_brace = open_paren + open_brace_rel;
            let mut depth = 1usize;
            let mut end = open_brace + 1;
            while end < bytes.len() && depth > 0 {
                if bytes[end] == b'{' {
                    depth += 1;
                } else if bytes[end] == b'}' {
                    depth -= 1;
                }
                end += 1;
            }
            if depth != 0 {
                break;
            }
            let literal = strip_js_comments_keep_strings(&text[open_brace..end]);
            if EXT_TYPE_RE.is_match(&literal) {
                let allows_public = EXT_ALLOW_PUBLIC_FALSE_RE.is_match(&literal);
                let requires_org = EXT_REQUIRE_ORG_TRUE_RE.is_match(&literal);
                if !allows_public || !requires_org {
                    out.push(format!(
                        "{}: registerShareableResource({{ type: \"extension\" }}) must include allowPublic: false AND requireOrgMemberForUserShares: true (allowPublic={}, requireOrgMemberForUserShares={})",
                        rel, allows_public, requires_org
                    ));
                }
            }
            match text[end..].find("registerShareableResource(") {
                Some(next_rel) => cursor = end + next_rel,
                None => break,
            }
        }
    }
    if rel.starts_with("packages/core/src/extensions/")
        && rel != "packages/core/src/extensions/store.ts"
        && rel != "packages/core/src/extensions/store.spec.ts"
        && text.contains("public")
    {
        let lines: Vec<&str> = text.split('\n').collect();
        for (i, line) in lines.iter().enumerate() {
            let lo = i.saturating_sub(5);
            let hi = (i + 5).min(lines.len().saturating_sub(1));
            let has_allow = lines[lo..=hi].iter().any(|l| l.contains("guard:allow-extension-public"));
            if has_allow {
                continue;
            }
            if EXT_VIS_JSON_RE.is_match(line) {
                out.push(format!(
                    "{}:{}: extension code must not set visibility: \"public\"",
                    rel,
                    i + 1
                ));
            }
            if EXT_VIS_SQL_RE.is_match(line) {
                out.push(format!(
                    "{}:{}: extension SQL must not write visibility = 'public'",
                    rel,
                    i + 1
                ));
            }
        }
    }
    out
}

// ---------- 6. guard:help-icon-scale ----------
static HELP_ICON_EXT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\.(?:tsx|ts|jsx|js)$").unwrap());
static HELP_ELEMENT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<Icon(?:HelpCircle|CircleHelp|Help)\b.*?/>").unwrap());
static LOCAL_HELP_GLYPH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)\.local-dev-help-glyph\s*\{.*?\}").unwrap());
static LARGE_GLYPH_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:\b(?:size|h|w)-(?:3\.5|4|5|6|7|8)\b|\bsize\s*=\s*\{?\s*(?:13|14|16|18|20|24|28|32)\s*\}?)").unwrap()
});
static LARGE_CSS_GLYPH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:width|height):\s*(?:0\.75rem|1rem|1\.25rem|1\.5rem|2rem)").unwrap());
static HELP_ALLOW_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"guard:allow-large-help-icon\b").unwrap());

fn check_help_icon_scale_file(rel: &str, text: &str) -> Vec<String> {
    if !(rel.starts_with("packages/") || rel.starts_with("templates/"))
        || !HELP_ICON_EXT_RE.is_match(rel)
    {
        return Vec::new();
    }
    for seg in rel.split('/') {
        if matches!(
            seg,
            "node_modules"
                | "dist"
                | "build"
                | ".next"
                | ".nuxt"
                | ".output"
                | ".cache"
                | ".turbo"
                | ".netlify"
                | ".vercel"
                | ".wrangler"
                | ".react-router"
                | ".generated"
                | "coverage"
                | "corpus"
        ) || seg.starts_with(".tmp")
        {
            return Vec::new();
        }
    }
    let has_icon = text.contains("<IconHelp") || text.contains("<IconCircleHelp");
    let has_css = text.contains(".local-dev-help-glyph");
    if !has_icon && !has_css {
        return Vec::new();
    }
    let lines: Vec<&str> = text.split('\n').collect();
    let mut out = Vec::new();
    if has_icon {
        for m in HELP_ELEMENT_RE.find_iter(text) {
            let element = m.as_str();
            if !LARGE_GLYPH_RE.is_match(element) {
                continue;
            }
            let line_num = line_index_for_offset(text, m.start()) + 1;
            let prev_line = if line_num >= 2 { lines.get(line_num - 2).copied().unwrap_or("") } else { "" };
            if HELP_ALLOW_RE.is_match(prev_line) {
                continue;
            }
            let compact = element.split_whitespace().collect::<Vec<_>>().join(" ");
            out.push(format!("{}:{}  {}", rel, line_num, compact));
        }
    }
    if has_css {
        for m in LOCAL_HELP_GLYPH_RE.find_iter(text) {
            let block = m.as_str();
            if !LARGE_CSS_GLYPH_RE.is_match(block) {
                continue;
            }
            let line_num = line_index_for_offset(text, m.start()) + 1;
            let compact = block.split_whitespace().collect::<Vec<_>>().join(" ");
            out.push(format!("{}:{}  {}", rel, line_num, compact));
        }
    }
    out
}

// ---------- 7. guard:no-localhost-fallback ----------
static LOCALHOST_OPT_OUT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"//\s*guard:allow-localhost-fallback\b").unwrap());
static LOCALHOST_OPT_OUT_REASON_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"//\s*guard:allow-localhost-fallback\s*(?:—|-)\s*\S").unwrap());
static LOCALHOST_LITERAL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?:"local@localhost"|'local@localhost'|`local@localhost`)"#).unwrap());
static LOCALHOST_SYMBOLIC_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:\?\?|\|\|)\s*DEV_MODE_USER_EMAIL\b").unwrap());
static LOCALHOST_AMBIENT_ENV_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:\?\?|\|\|)\s*process\.env\.(?:AGENT_USER_EMAIL|AGENT_ORG_ID|AGENT_USER_NAME|WORKSPACE_OWNER_EMAIL)\b").unwrap()
});
static LOCALHOST_AMBIENT_HELPER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:\?\?|\|\|)\s*getAmbient(?:UserEmail|OrgId)\s*\(\s*\)").unwrap());
static LOCALHOST_SQL_DEFAULT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)\bDEFAULT\s+['"`]local@localhost['"`]"#).unwrap());
static LOCALHOST_DRIZZLE_DEFAULT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\.default\s*\(\s*['"`]local@localhost['"`]\s*\)"#).unwrap());
static SCRIPT_HELPERS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|/)script-(?:helpers|entries)\.ts$").unwrap());

fn is_localhost_skipped_dir(name: &str) -> bool {
    is_env_mut_skipped_dir(name)
        || matches!(
            name,
            "corpus" | ".video-bakeoff" | ".video-bakeoff-recording" | ".vscode-test"
        )
}

fn is_localhost_literal_allowed(rel: &str) -> bool {
    matches!(
        rel,
        "packages/core/src/server/auth.ts"
            | "packages/core/src/guards/no-localhost-fallback.ts"
            | "packages/core/src/org/context.ts"
            | "packages/core/src/server/local-migration.ts"
            | "packages/core/src/server/google-oauth.ts"
            | "packages/core/src/oauth-tokens/store.ts"
    ) || rel.starts_with("packages/core/src/dev")
        || rel.starts_with("packages/core/corpus/")
        || SPEC_OR_TEST_RE.is_match(rel)
        || rel.starts_with("scripts/")
        || rel.contains("/seed/")
        || rel.contains("/seeds/")
}

fn is_localhost_ambient_allowed(rel: &str) -> bool {
    rel.starts_with("scripts/")
        || rel.contains("/scripts/")
        || rel.starts_with("src/cli/")
        || rel.contains("/src/cli/")
        || rel.starts_with("src/scripts/")
        || rel.contains("/src/scripts/")
        || SCRIPT_HELPERS_RE.is_match(rel)
        || rel == "packages/core/src/server/request-context.ts"
        || rel == "packages/core/src/guards/no-localhost-fallback.ts"
        || rel.starts_with("packages/core/corpus/")
        || SPEC_OR_TEST_RE.is_match(rel)
        || rel.contains("/seed/")
        || rel.contains("/seeds/")
}

fn check_localhost_fallback_file(rel: &str, text: &str) -> Vec<String> {
    if !JS_TS_EXT_RE.is_match(rel) || rel.ends_with(".d.ts") || rel.split('/').any(is_localhost_skipped_dir) {
        return Vec::new();
    }
    let literal_allowed = is_localhost_literal_allowed(rel);
    let ambient_allowed = is_localhost_ambient_allowed(rel);
    if literal_allowed && ambient_allowed {
        return Vec::new();
    }
    let need_ambient = !ambient_allowed
        && (text.contains("AGENT_USER_EMAIL")
            || text.contains("AGENT_ORG_ID")
            || text.contains("AGENT_USER_NAME")
            || text.contains("WORKSPACE_OWNER_EMAIL")
            || text.contains("getAmbient"));
    let need_symbolic = !literal_allowed && text.contains("DEV_MODE_USER_EMAIL");
    let need_literal = !literal_allowed && text.contains("local@localhost");
    if !need_ambient && !need_symbolic && !need_literal {
        return Vec::new();
    }
    let lines: Vec<&str> = text.split('\n').collect();
    let mut out = Vec::new();
    if need_ambient {
        for re in [&*LOCALHOST_AMBIENT_ENV_RE, &*LOCALHOST_AMBIENT_HELPER_RE] {
            for m in re.find_iter(text) {
                let (line, col) = line_col_for_offset(text, m.start());
                let line_text = lines.get(line - 1).copied().unwrap_or("");
                if is_comment_line(line_text)
                    || has_line_opt_out(&lines, line - 1, &LOCALHOST_OPT_OUT_RE, &LOCALHOST_OPT_OUT_REASON_RE)
                {
                    continue;
                }
                out.push(format!("{}:{}:{}  [ambient] {}", rel, line, col, line_text.trim()));
            }
        }
    }
    if need_symbolic {
        for m in LOCALHOST_SYMBOLIC_RE.find_iter(text) {
            let (line, col) = line_col_for_offset(text, m.start());
            let line_text = lines.get(line - 1).copied().unwrap_or("");
            if is_comment_line(line_text)
                || has_line_opt_out(&lines, line - 1, &LOCALHOST_OPT_OUT_RE, &LOCALHOST_OPT_OUT_REASON_RE)
            {
                continue;
            }
            out.push(format!("{}:{}:{}  {}", rel, line, col, line_text.trim()));
        }
    }
    if need_literal {
        for m in LOCALHOST_LITERAL_RE.find_iter(text) {
            let (line, col) = line_col_for_offset(text, m.start());
            let line_text = lines.get(line - 1).copied().unwrap_or("");
            if is_comment_line(line_text)
                || LOCALHOST_SQL_DEFAULT_RE.is_match(line_text)
                || LOCALHOST_DRIZZLE_DEFAULT_RE.is_match(line_text)
                || has_line_opt_out(&lines, line - 1, &LOCALHOST_OPT_OUT_RE, &LOCALHOST_OPT_OUT_REASON_RE)
            {
                continue;
            }
            out.push(format!("{}:{}:{}  {}", rel, line, col, line_text.trim()));
        }
    }
    out
}

fn git_ls_files(root: &Path, args: &[&str]) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| format!("git failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    Ok(raw
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect())
}

fn collect_barrel_disk_files(root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    for sub in ["packages", "templates"] {
        let base = root.join(sub);
        if !base.exists() {
            continue;
        }
        let walker = WalkBuilder::new(&base)
            .hidden(false)
            .git_ignore(false)
            .filter_entry(|e| {
                if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let name = e.file_name().to_string_lossy();
                    !BARREL_EXCLUDED_DIRS.contains(&name.as_ref()) && !name.starts_with("corpus.tmp-")
                } else {
                    true
                }
            })
            .build();
        for entry in walker.flatten() {
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                if let Ok(rel) = entry.path().strip_prefix(root) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    if should_scan_barrel(&rel_str) {
                        files.push(rel_str);
                    }
                }
            }
        }
    }
    files
}

fn collect_repo_code_disk_files(root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(false)
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let name = e.file_name().to_string_lossy();
                !is_env_mut_skipped_dir(&name)
            } else {
                true
            }
        })
        .build();
    for entry in walker.flatten() {
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if let Ok(rel) = entry.path().strip_prefix(root) {
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                if JS_TS_EXT_RE.is_match(&rel_str) || rel_str.ends_with(".jsx") {
                    files.push(rel_str);
                }
            }
        }
    }
    files
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut root = std::env::current_dir().unwrap();
    let mut requested: HashSet<String> = HashSet::new();
    let mut json_mode = false;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--root" => {
                i += 1;
                if i < args.len() {
                    root = PathBuf::from(&args[i]);
                }
            }
            "--guards" => {
                i += 1;
                if i < args.len() {
                    for g in args[i].split(',').filter(|s| !s.is_empty()) {
                        requested.insert(g.to_string());
                    }
                }
            }
            "--json" => json_mode = true,
            _ => {}
        }
        i += 1;
    }

    if requested.is_empty() {
        for g in [
            "guard:agent-native-brand",
            "guard:no-secret-literals",
            "guard:no-core-client-barrel-imports",
            "guard:no-env-mutation",
            "guard:extension-no-public",
            "guard:help-icon-scale",
            "guard:no-localhost-fallback",
        ] {
            requested.insert(g.into());
        }
    }

    let t_total = Instant::now();
    let run_brand = requested.contains("guard:agent-native-brand");
    let run_secrets = requested.contains("guard:no-secret-literals");
    let run_barrel = requested.contains("guard:no-core-client-barrel-imports");
    let run_env_mut = requested.contains("guard:no-env-mutation");
    let run_ext_public = requested.contains("guard:extension-no-public");
    let run_help_icon = requested.contains("guard:help-icon-scale");
    let run_localhost = requested.contains("guard:no-localhost-fallback");

    // Collect union of files once
    let mut brand_set: HashSet<String> = HashSet::new();
    let mut secret_set: HashSet<String> = HashSet::new();
    let mut barrel_set: HashSet<String> = HashSet::new();
    let mut code_disk_set: HashSet<String> = HashSet::new();

    if run_brand {
        match git_ls_files(&root, &["ls-files", "-co", "--exclude-standard", "-z"]) {
            Ok(list) => brand_set.extend(list),
            Err(e) => {
                eprintln!("[fast-guards] git ls-files failed: {}", e);
                std::process::exit(2);
            }
        }
    }
    if run_secrets {
        match git_ls_files(&root, &["ls-files", "-z"]) {
            Ok(list) => secret_set.extend(list),
            Err(e) => {
                eprintln!("[fast-guards] git ls-files failed: {}", e);
                std::process::exit(2);
            }
        }
        if let Ok(rd) = fs::read_dir(root.join(".claude")) {
            for ent in rd.flatten() {
                if ent.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    let name = ent.file_name().to_string_lossy().to_string();
                    if name.ends_with(".json") {
                        secret_set.insert(format!(".claude/{}", name));
                    }
                }
            }
        }
    }
    if run_barrel {
        barrel_set.extend(collect_barrel_disk_files(&root));
    }
    if run_env_mut || run_ext_public || run_help_icon || run_localhost {
        code_disk_set.extend(collect_repo_code_disk_files(&root));
    }

    let mut all_files: HashSet<String> = HashSet::new();
    all_files.extend(brand_set.iter().cloned());
    all_files.extend(secret_set.iter().cloned());
    all_files.extend(barrel_set.iter().cloned());
    all_files.extend(code_disk_set.iter().cloned());
    let all_vec: Vec<String> = all_files.into_iter().collect();

    struct PerFileHits {
        brand: Vec<String>,
        secret: Vec<String>,
        barrel: Vec<String>,
        env_mut: Vec<String>,
        ext_public: Vec<String>,
        help_icon: Vec<String>,
        localhost: Vec<String>,
        brand_counted: usize,
    }

    // Single-pass parallel file read + multi-guard evaluation
    let results: Vec<PerFileHits> = all_vec
        .par_iter()
        .map(|rel| {
            let need_brand = run_brand && brand_set.contains(rel);
            let need_secret = run_secrets && secret_set.contains(rel) && !is_secret_skipped_path(rel);
            let need_barrel = run_barrel && barrel_set.contains(rel);
            let in_code_disk = code_disk_set.contains(rel);
            let need_env_mut = run_env_mut && in_code_disk;
            let need_ext_public = run_ext_public && in_code_disk;
            let need_help_icon = run_help_icon && in_code_disk;
            let need_localhost = run_localhost && in_code_disk;
            if !need_brand
                && !need_secret
                && !need_barrel
                && !need_env_mut
                && !need_ext_public
                && !need_help_icon
                && !need_localhost
            {
                return PerFileHits {
                    brand: Vec::new(),
                    secret: Vec::new(),
                    barrel: Vec::new(),
                    env_mut: Vec::new(),
                    ext_public: Vec::new(),
                    help_icon: Vec::new(),
                    localhost: Vec::new(),
                    brand_counted: 0,
                };
            }
            let abs = root.join(rel);
            let bytes = match fs::read(&abs) {
                Ok(b) => b,
                Err(_) => {
                    return PerFileHits {
                        brand: Vec::new(),
                        secret: Vec::new(),
                        barrel: Vec::new(),
                        env_mut: Vec::new(),
                        ext_public: Vec::new(),
                        help_icon: Vec::new(),
                        localhost: Vec::new(),
                        brand_counted: 0,
                    };
                }
            };
            let is_binary = bytes.contains(&0);
            let text_cow = String::from_utf8_lossy(&bytes);
            let text = text_cow.as_ref();
            PerFileHits {
                brand: if need_brand && !is_binary { check_brand_file(rel, text) } else { Vec::new() },
                secret: if need_secret { check_secret_file(rel, text) } else { Vec::new() },
                barrel: if need_barrel { check_barrel_file(rel, text) } else { Vec::new() },
                env_mut: if need_env_mut { check_env_mutation_file(rel, text) } else { Vec::new() },
                ext_public: if need_ext_public { check_extension_no_public_file(rel, text) } else { Vec::new() },
                help_icon: if need_help_icon { check_help_icon_scale_file(rel, text) } else { Vec::new() },
                localhost: if need_localhost { check_localhost_fallback_file(rel, text) } else { Vec::new() },
                brand_counted: usize::from(need_brand && !is_binary),
            }
        })
        .collect();

    let mut brand_v = Vec::new();
    let mut secret_v = Vec::new();
    let mut barrel_v = Vec::new();
    let mut env_mut_v = Vec::new();
    let mut ext_public_v = Vec::new();
    let mut help_icon_v = Vec::new();
    let mut localhost_v = Vec::new();
    let mut brand_files_checked = 0usize;
    for r in results {
        brand_v.extend(r.brand);
        secret_v.extend(r.secret);
        barrel_v.extend(r.barrel);
        env_mut_v.extend(r.env_mut);
        ext_public_v.extend(r.ext_public);
        help_icon_v.extend(r.help_icon);
        localhost_v.extend(r.localhost);
        brand_files_checked += r.brand_counted;
    }
    brand_v.sort();
    secret_v.sort();
    barrel_v.sort();
    env_mut_v.sort();
    ext_public_v.sort();
    help_icon_v.sort();
    localhost_v.sort();

    let elapsed_ms = t_total.elapsed().as_millis();
    let mut reports: Vec<GuardReport> = Vec::new();
    let mut any_failed = false;

    if run_brand {
        let passed = brand_v.is_empty();
        any_failed |= !passed;
        reports.push(GuardReport {
            name: "guard:agent-native-brand".into(),
            passed,
            elapsed_ms,
            summary: if passed {
                format!("guard:agent-native-brand: clean ({} files)", brand_files_checked)
            } else {
                format!("Undashed Agent-Native branding found ({} violation(s))", brand_v.len())
            },
            violations: brand_v,
        });
    }
    if run_secrets {
        let passed = secret_v.is_empty();
        any_failed |= !passed;
        reports.push(GuardReport {
            name: "guard:no-secret-literals".into(),
            passed,
            elapsed_ms,
            summary: if passed {
                "guard-no-secret-literals: OK".into()
            } else {
                format!("guard-no-secret-literals: {} credential-shaped literal(s) found.", secret_v.len())
            },
            violations: secret_v,
        });
    }
    if run_barrel {
        let passed = barrel_v.is_empty();
        any_failed |= !passed;
        reports.push(GuardReport {
            name: "guard:no-core-client-barrel-imports".into(),
            passed,
            elapsed_ms,
            summary: if passed {
                "[guard:no-core-client-barrel-imports] clean".into()
            } else {
                format!("[guard:no-core-client-barrel-imports] {} violation(s)", barrel_v.len())
            },
            violations: barrel_v,
        });
    }
    if run_env_mut {
        let passed = env_mut_v.is_empty();
        any_failed |= !passed;
        reports.push(GuardReport {
            name: "guard:no-env-mutation".into(),
            passed,
            elapsed_ms,
            summary: if passed {
                "guard-no-env-mutation: OK".into()
            } else {
                format!("guard-no-env-mutation: {} forbidden process.env mutation(s) found.", env_mut_v.len())
            },
            violations: env_mut_v,
        });
    }
    if run_ext_public {
        let passed = ext_public_v.is_empty();
        any_failed |= !passed;
        reports.push(GuardReport {
            name: "guard:extension-no-public".into(),
            passed,
            elapsed_ms,
            summary: if passed {
                "[guard-extension-no-public] OK".into()
            } else {
                format!("[guard-extension-no-public] {} violation(s)", ext_public_v.len())
            },
            violations: ext_public_v,
        });
    }
    if run_help_icon {
        let passed = help_icon_v.is_empty();
        any_failed |= !passed;
        reports.push(GuardReport {
            name: "guard:help-icon-scale".into(),
            passed,
            elapsed_ms,
            summary: if passed {
                "guard-help-icon-scale: OK".into()
            } else {
                format!("guard-help-icon-scale: {} oversized inline help glyph(s).", help_icon_v.len())
            },
            violations: help_icon_v,
        });
    }
    if run_localhost {
        let passed = localhost_v.is_empty();
        any_failed |= !passed;
        reports.push(GuardReport {
            name: "guard:no-localhost-fallback".into(),
            passed,
            elapsed_ms,
            summary: if passed {
                "guard-no-localhost-fallback: OK".into()
            } else {
                format!("guard-no-localhost-fallback: {} violation(s) found.", localhost_v.len())
            },
            violations: localhost_v,
        });
    }

    if json_mode {
        let mut map: HashMap<String, &GuardReport> = HashMap::new();
        for r in &reports {
            map.insert(r.name.clone(), r);
        }
        println!("{}", serde_json::to_string(&reports).unwrap());
    } else {
        for r in &reports {
            if r.passed {
                println!("{}", r.summary);
            } else {
                eprintln!("{}", r.summary);
                for v in &r.violations {
                    eprintln!("  - {}", v);
                }
            }
        }
    }

    std::process::exit(if any_failed { 1 } else { 0 });
}
