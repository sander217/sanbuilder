#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schemaDirectory = path.join(process.cwd(), "schemas");
const files = (await readdir(schemaDirectory)).filter((file) => file.endsWith(".schema.json")).sort();
const schemas = await Promise.all(
  files.map(async (file) => ({
    file,
    schema: JSON.parse(await readFile(path.join(schemaDirectory, file), "utf8")),
  })),
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

for (const { schema } of schemas) ajv.addSchema(schema);
for (const { file, schema } of schemas) {
  try {
    if (!ajv.getSchema(schema.$id)) ajv.compile(schema);
  } catch (error) {
    console.error(`Invalid ${file}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (!process.exitCode) {
  const generated = spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "generate-schema-validators.mjs"), "--check"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (generated.status !== 0) {
    process.stderr.write(generated.stderr || generated.stdout);
    process.exitCode = 1;
  } else {
    process.stdout.write(generated.stdout);
    console.log(`Schema validation passed: ${schemas.length} contracts compiled.`);
  }
}
