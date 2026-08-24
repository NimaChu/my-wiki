#!/usr/bin/env node
import { auditOkfWiki } from "./okf-lib.mjs";
import { vaultPath } from "./wiki-lib.mjs";

const report = await auditOkfWiki(vaultPath());
console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 1;
