#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertExternalContractCache,
  contractPackCacheRoot,
  readContractPackConfig,
  readDesignHarnessBinding,
  syncContractPack,
  verifyContractPack,
} from "../lib/contract-packs.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const harnessRoot = path.resolve(path.dirname(scriptPath), "..");

function usage() {
  return [
    "Usage:",
    "  sync-contract-packs.mjs <check|sync> [--config <json>] [--cache <absolute-path>] [--json]",
    "  sync-contract-packs.mjs <check|sync> --binding <design-harness.yml> [--cache <absolute-path>] [--json]",
  ].join("\n");
}

function parseArguments(argv) {
  const [mode, ...rest] = argv;
  if (mode === "--help" || mode === "-h") return { help: true };
  if (!new Set(["check", "sync"]).has(mode)) throw new Error("The first argument must be check or sync.");
  const options = { mode, json: false };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--json") options.json = true;
    else if (["--config", "--binding", "--cache"].includes(flag)) {
      const value = rest[++index];
      if (!value) throw new Error(`${flag} requires a value.`);
      options[flag.slice(2)] = value;
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (options.binding && options.config) throw new Error("Use either --binding or --config, not both.");
  return options;
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.help) return console.log(usage());
    let config;
    if (options.binding) {
      const { pack } = await readDesignHarnessBinding(options.binding);
      config = {
        schemaVersion: 1,
        cache: {
          environmentVariable: "DESIGN_HARNESS_CONTRACT_CACHE",
          defaultDirectory: ".cache/design-harness-agent/contract-packs",
        },
        packs: [pack],
      };
    } else {
      config = await readContractPackConfig(path.resolve(options.config ?? path.join(harnessRoot, "config", "contract-packs.json")));
    }
    const cacheRoot = contractPackCacheRoot(config, options.cache);
    await assertExternalContractCache(cacheRoot, harnessRoot);
    const results = [];
    for (const pack of config.packs) {
      try {
        results.push(options.mode === "sync" ? await syncContractPack(pack, cacheRoot) : await verifyContractPack(pack, cacheRoot));
      } catch (error) {
        results.push({ id: pack.id, status: "invalid", revision: pack.revision, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const payload = { ok: results.every((entry) => entry.status === "ok"), cacheRoot, packs: results };
    if (options.json) console.log(JSON.stringify(payload, null, 2));
    else for (const entry of results) console.log(`${entry.id}: ${entry.status}${entry.error ? ` (${entry.error})` : ""}`);
    if (!payload.ok) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options?.json) console.error(JSON.stringify({ ok: false, error: message }));
    else console.error(`${message}\n\n${usage()}`);
    process.exitCode = 2;
  }
}

await main();
