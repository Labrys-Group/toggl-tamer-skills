#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKILLS_DIR = join(ROOT, "skills");
const MANIFEST_PATH = join(ROOT, ".claude-plugin", "marketplace.json");

const errors = [];
const warnings = [];

function parseFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const data = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, "");
    data[key] = value;
  }
  return data;
}

if (!existsSync(SKILLS_DIR)) {
  errors.push("Missing `skills/` directory at repo root.");
} else {
  const entries = readdirSync(SKILLS_DIR).filter((name) => {
    const full = join(SKILLS_DIR, name);
    return !name.startsWith(".") && statSync(full).isDirectory();
  });

  if (entries.length === 0) {
    errors.push("`skills/` exists but contains no skill directories.");
  }

  const skillFolders = [];

  for (const name of entries) {
    const skillPath = join(SKILLS_DIR, name);
    const skillFile = join(skillPath, "SKILL.md");
    const rel = relative(ROOT, skillFile);

    if (!existsSync(skillFile)) {
      errors.push(`${relative(ROOT, skillPath)}: missing SKILL.md`);
      continue;
    }

    skillFolders.push(`./skills/${name}`);

    const source = readFileSync(skillFile, "utf8");
    const fm = parseFrontmatter(source);
    if (!fm) {
      errors.push(`${rel}: missing YAML frontmatter (--- block)`);
      continue;
    }
    if (!fm.name) errors.push(`${rel}: frontmatter missing required field \`name\``);
    if (!fm.description) errors.push(`${rel}: frontmatter missing required field \`description\``);
    if (fm.name && fm.name !== name) {
      warnings.push(`${rel}: frontmatter \`name: ${fm.name}\` does not match folder name \`${name}\``);
    }
  }

  if (existsSync(MANIFEST_PATH)) {
    try {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
      const declared = new Set();
      for (const plugin of manifest.plugins ?? []) {
        for (const s of plugin.skills ?? []) declared.add(s.replace(/\/+$/, ""));
      }
      for (const folder of skillFolders) {
        if (!declared.has(folder)) {
          warnings.push(`marketplace.json: missing entry for ${folder}`);
        }
      }
      for (const declaredPath of declared) {
        if (!skillFolders.includes(declaredPath)) {
          warnings.push(`marketplace.json: declares ${declaredPath} but folder is missing or empty`);
        }
      }
    } catch (err) {
      errors.push(`.claude-plugin/marketplace.json: invalid JSON (${err.message})`);
    }
  }
}

if (warnings.length) {
  console.log("Warnings:");
  for (const w of warnings) console.log(`  - ${w}`);
}

if (errors.length) {
  console.error("\nErrors:");
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\n${errors.length} error(s) found.`);
  process.exit(1);
}

console.log(`OK — validated skills/`);
