import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PRODUCT_CATALOG, getDefaultRunTarget } from "../lib/contracts.ts";

test("ships one fictional, product-neutral starter portfolio", () => {
  assert.deepEqual(PRODUCT_CATALOG.brands.map(({ id }) => id), ["atlas"]);
  assert.deepEqual(PRODUCT_CATALOG.products.map(({ id }) => id), ["atlas-web"]);
  const target = getDefaultRunTarget();
  assert.equal(target.adapter.repository, "example/atlas-web");
  assert.equal(target.adapter.commit, "1111111111111111111111111111111111111111");
});

test("refuses to treat sample adapter data as a delivery target", async () => {
  const skill = await readFile(new URL("../skills/design-harness-agent/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /Refuse a delivery run for.*example\//s);
});

test("binds contract maintenance to the public core repository", async () => {
  const provenance = JSON.parse(await readFile(new URL("../config/release-provenance.json", import.meta.url), "utf8"));
  assert.equal(provenance.repository, "sander217/sanbuilder");
});
