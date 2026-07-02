#!/usr/bin/env node
import { scanVault } from "./wiki-lib.mjs";

function normalize(value) {
  return String(value).toLowerCase().replace(/[\s/_-]+/g, "");
}

const scan = await scanVault();
const suggestions = scan.unresolved.map((item) => {
  const needle = normalize(item.target);
  const matches = scan.nodes
    .map((node) => ({ node, exactish: normalize(node.title) === needle || normalize(node.id) === needle }))
    .filter(({ node, exactish }) => exactish || normalize(node.title).includes(needle) || needle.includes(normalize(node.title)))
    .slice(0, 5)
    .map(({ node }) => ({ title: node.title, path: node.path }));
  return { ...item, suggestions: matches };
});

console.log(JSON.stringify({
  unresolved: suggestions.length,
  suggestions
}, null, 2));
