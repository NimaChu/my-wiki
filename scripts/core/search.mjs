#!/usr/bin/env node
import { scanVault } from "./wiki-lib.mjs";

const query = process.argv.slice(2).join(" ").trim().toLowerCase();
if (!query) {
  console.error('Usage: node src/search.mjs "query terms"');
  process.exit(2);
}

const terms = query.split(/\s+/).filter(Boolean);
const scan = await scanVault();
const results = scan.nodes
  .map((node) => {
    const haystack = [
      node.title,
      node.path,
      node.tags.join(" "),
      node.aliases.join(" "),
      node.excerpt
    ].join(" ").toLowerCase();
    const score = terms.reduce((total, term) => {
      if (node.title.toLowerCase().includes(term)) total += 6;
      if (node.aliases.some((alias) => alias.toLowerCase().includes(term))) total += 5;
      if (node.tags.some((tag) => tag.toLowerCase().includes(term))) total += 3;
      if (haystack.includes(term)) total += 1;
      return total;
    }, 0);
    return { node, score };
  })
  .filter((item) => item.score > 0)
  .sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title))
  .slice(0, 20)
  .map(({ node, score }) => ({
    score,
    title: node.title,
    path: node.path,
    type: node.type,
    status: node.status,
    tags: node.tags,
    excerpt: node.excerpt
  }));

console.log(JSON.stringify({ query, count: results.length, results }, null, 2));
