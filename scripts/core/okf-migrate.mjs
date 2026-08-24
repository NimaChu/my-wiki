#!/usr/bin/env node
import { auditOkfWiki, migrateWikiToOkf } from "./okf-lib.mjs";
import { vaultPath } from "./wiki-lib.mjs";

const apply = process.argv.includes("--apply");
const vault = vaultPath();
const migration = await migrateWikiToOkf(vault, { apply });
const audit = apply ? await auditOkfWiki(vault) : null;
console.log(JSON.stringify({ migration, audit }, null, 2));
if (audit && !audit.valid) process.exitCode = 1;
