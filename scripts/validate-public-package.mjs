#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

const codex = await readJson(".codex-plugin/plugin.json");
const claude = await readJson(".claude-plugin/plugin.json");
const provenance = await readJson("config/release-provenance.json");
const catalog = await readJson("config/product-catalog.generated.json");

assert.equal(codex.name, "design-harness-agent");
assert.equal(claude.name, codex.name);
assert.equal(claude.version, codex.version);
assert.equal(provenance.repository, "sander217/sanbuilder");
assert.deepEqual(catalog.brands.map(({ id }) => id), ["atlas"]);
assert.deepEqual(catalog.products.map(({ id }) => id), ["atlas-web"]);
assert.equal(catalog.adapters.find(({ id }) => id === "atlas-web")?.repository, "example/atlas-web");

console.log("Public Sanbuilder package is structurally valid.");
