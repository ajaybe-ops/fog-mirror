#!/usr/bin/env node
/**
 * FOG MIRROR repository check.
 *
 * Runs without dependencies so it works locally and in CI:
 *   1. Every JavaScript module parses as an ES module.
 *   2. Every relative import and dynamic import resolves.
 *   3. Every local href/src in HTML resolves.
 *   4. HTML ids are unique and ARIA/for references point at real ids.
 *   5. Every id used by getElementById/querySelector('#…') exists.
 *   6. CSS braces balance and local url() assets exist.
 *   7. Every module in src/ is reachable from the page entry point.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set([".git", "node_modules", "_site", "dist", ".github"]);
const failures = [];
const warnings = [];
let checks = 0;

const rel = (file) => relative(ROOT, file).split(sep).join("/");
const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);
const read = (file) => readFileSync(file, "utf8");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const files = walk(ROOT);
const jsFiles = files.filter((file) => [".js", ".mjs"].includes(extname(file)));
const htmlFiles = files.filter((file) => extname(file) === ".html");
const cssFiles = files.filter((file) => extname(file) === ".css");
const assetFiles = new Set(files.map((file) => resolve(file)));

// ---------------------------------------------------------------------------
// 1. Syntax
// ---------------------------------------------------------------------------
for (const file of jsFiles) {
  checks += 1;
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "unknown syntax error").trim();
    fail(`syntax error in ${rel(file)}\n    ${detail.replace(/\n/g, "\n    ")}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Import graph
// ---------------------------------------------------------------------------
const importPattern =
  /(?:^|[^\w$])(?:import|export)\s+(?:[^'"()]*?\sfrom\s*)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

const graph = new Map();
function resolveModule(fromFile, specifier) {
  const clean = specifier.split(/[?#]/)[0];
  const base = resolve(dirname(fromFile), clean);
  const candidates = [base, `${base}.js`, `${base}.mjs`, join(base, "index.js")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

for (const file of jsFiles) {
  checks += 1;
  const source = read(file);
  const dependencies = [];
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] || match[2];
    if (!specifier) continue;
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) continue; // CDN/bare specifier
    const target = resolveModule(file, specifier);
    if (!target) {
      fail(`unresolved import "${specifier}" in ${rel(file)}`);
      continue;
    }
    dependencies.push(target);
  }
  graph.set(resolve(file), dependencies);
}

// ---------------------------------------------------------------------------
// 3–5. HTML structure and references
// ---------------------------------------------------------------------------
const idOwners = new Map();
const htmlIds = new Map(); // file -> Set(ids)
const localRefs = [];

for (const file of htmlFiles) {
  checks += 1;
  const html = read(file);
  const ids = new Set();

  for (const match of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) {
    const id = match[1].trim();
    if (!id) continue;
    if (ids.has(id)) fail(`duplicate id "${id}" in ${rel(file)}`);
    ids.add(id);
    if (idOwners.has(id) && idOwners.get(id) !== file) {
      warn(`id "${id}" is used in both ${rel(idOwners.get(id))} and ${rel(file)}`);
    } else {
      idOwners.set(id, file);
    }
  }
  htmlIds.set(resolve(file), ids);

  for (const match of html.matchAll(/\b(?:aria-controls|aria-labelledby|aria-describedby)\s*=\s*["']([^"']+)["']/g)) {
    for (const id of match[1].split(/\s+/).filter(Boolean)) {
      if (!ids.has(id)) fail(`ARIA reference "${id}" has no matching id in ${rel(file)}`);
    }
  }

  for (const match of html.matchAll(/\bfor\s*=\s*["']([^"']+)["']/g)) {
    const id = match[1].trim();
    if (id && !ids.has(id)) fail(`label for="${id}" has no matching id in ${rel(file)}`);
  }

  for (const match of html.matchAll(/\b(?:href|src|poster)\s*=\s*["']([^"']+)["']/g)) {
    const value = match[1].trim();
    if (!value || value.startsWith("#")) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) continue; // absolute URL, data:, mailto:
    localRefs.push({ file, value });
  }
}

for (const { file, value } of localRefs) {
  checks += 1;
  const target = resolve(dirname(file), value.split(/[?#]/)[0]);
  if (!existsSync(target)) fail(`missing local asset "${value}" referenced by ${rel(file)}`);
}

const allHtmlIds = new Set([...htmlIds.values()].flatMap((ids) => [...ids]));
const idUsagePattern = /\bgetElementById\s*\(\s*["'`]([^"'`]+)["'`]\s*\)|querySelector(?:All)?\s*\(\s*["'`]#([\w-]+)["'`]\s*\)/g;

for (const file of jsFiles) {
  checks += 1;
  const source = read(file);
  for (const match of source.matchAll(idUsagePattern)) {
    const id = match[1] || match[2];
    if (!id) continue;
    if (!allHtmlIds.has(id)) fail(`DOM id "${id}" is used in ${rel(file)} but not defined in HTML`);
  }
}

// ---------------------------------------------------------------------------
// 6. CSS
// ---------------------------------------------------------------------------
for (const file of cssFiles) {
  checks += 1;
  const css = read(file);
  let depth = 0;
  let quote = null;
  let comment = false;
  let line = 1;

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];
    if (char === "\n") line += 1;
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "*") {
      comment = true;
      index += 1;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth < 0) {
        fail(`unbalanced "}" in ${rel(file)} near line ${line}`);
        depth = 0;
      }
    }
  }
  if (depth !== 0) fail(`unbalanced braces in ${rel(file)} (${depth} unclosed)`);
  if (quote) fail(`unterminated string in ${rel(file)}`);

  // Strip inline data URIs first: they can contain their own url(...) tokens.
  const cssWithoutDataUris = css
    .replace(/url\(\s*(["'])data:[\s\S]*?\1\s*\)/gi, "url(data:)")
    .replace(/url\(\s*data:[^)]*\)/gi, "url(data:)");
  for (const match of cssWithoutDataUris.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const value = match[2].trim();
    if (!value || value.startsWith("data:") || value.startsWith("#")) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) continue;
    checks += 1;
    const target = resolve(dirname(file), value.split(/[?#]/)[0]);
    if (!existsSync(target)) fail(`missing CSS asset "${value}" referenced by ${rel(file)}`);
  }
}

// ---------------------------------------------------------------------------
// 7. Reachability from the page
// ---------------------------------------------------------------------------
const entryPoints = [];
for (const file of htmlFiles) {
  const html = read(file);
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>/gi)) {
    const tag = match[0];
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (src && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src[1])) {
      const target = resolve(dirname(file), src[1].split(/[?#]/)[0]);
      if (existsSync(target)) entryPoints.push(target);
    }
  }
}

const reachable = new Set();
const queue = [...entryPoints];
while (queue.length) {
  const file = queue.pop();
  if (reachable.has(file)) continue;
  reachable.add(file);
  for (const dependency of graph.get(file) ?? []) queue.push(dependency);
}

const sourceModules = jsFiles.filter((file) => rel(file).startsWith("src/"));
for (const file of sourceModules) {
  checks += 1;
  if (!reachable.has(resolve(file))) fail(`module ${rel(file)} is not imported by the app entry point`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const summary = [
  `${jsFiles.length} JS modules`,
  `${htmlFiles.length} HTML page`,
  `${cssFiles.length} CSS file`,
  `${checks} checks`,
].join(" · ");

if (warnings.length) {
  console.log(`\nWarnings (${warnings.length})`);
  for (const message of warnings) console.log(`  ! ${message}`);
}

if (failures.length) {
  console.error(`\nFOG MIRROR check failed (${failures.length} issue${failures.length === 1 ? "" : "s"})`);
  for (const message of failures) console.error(`  x ${message}`);
  console.error(`\n${summary}`);
  process.exit(1);
}

console.log(`FOG MIRROR check passed · ${summary}`);
