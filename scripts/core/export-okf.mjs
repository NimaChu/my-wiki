#!/usr/bin/env node
import { exportOkfBundle } from "./okf-lib.mjs";
import { vaultPath } from "./wiki-lib.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

const galaxy = option("--galaxy") || option("--universe");
const output = option("--output");
const result = await exportOkfBundle(vaultPath(), { galaxy, output });
console.log(JSON.stringify(result, null, 2));
