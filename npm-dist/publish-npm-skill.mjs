import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageName = "my-wiki-skill";
const npmRegistry = "https://registry.npmjs.org";
const mirrorSyncUrl = `https://registry-direct.npmmirror.com/-/package/${packageName}/syncs`;
const npmCommand = "npm";
const dryRun = process.argv.includes("--dry-run");
const packIndex = process.argv.indexOf("--pack");
const packDestination = packIndex >= 0 ? process.argv[packIndex + 1] : null;

if (packIndex >= 0 && (!packDestination || packDestination.startsWith("--"))) {
  console.error("--pack requires an output directory.");
  process.exit(2);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", shell: process.platform === "win32", ...options });
}

function shouldExclude(relative, entry) {
  const parts = relative.replace(/\\/g, "/").split("/");
  const basename = entry.name;
  if (parts.includes("tests") || parts.includes("node_modules") || parts.includes("dist")) return true;
  if (basename === ".DS_Store" || basename === "wiki-graph.json") return true;
  return basename.endsWith(".log") || basename.endsWith(".pid");
}

async function copyCleanTree(source, destination, root = source) {
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const relative = path.relative(root, from);
    if (shouldExclude(relative, entry)) continue;
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyCleanTree(from, to, root);
    else await fs.copyFile(from, to);
  }
}

async function createStagingPackage() {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-npm-"));
  const rootMetadata = JSON.parse(await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  const marker = JSON.parse(await fs.readFile(path.join(repositoryRoot, "my-wiki", ".my-wiki-skill.json"), "utf8"));
  if (rootMetadata.version !== marker.version) {
    throw new Error(`Version mismatch: package.json=${rootMetadata.version}, Skill=${marker.version}`);
  }

  await copyCleanTree(path.join(repositoryRoot, "my-wiki"), path.join(staging, "my-wiki"));
  await fs.mkdir(path.join(staging, "bin"), { recursive: true });
  await fs.copyFile(path.join(repositoryRoot, "npm-dist", "install.mjs"), path.join(staging, "bin", "install.mjs"));
  await fs.copyFile(path.join(repositoryRoot, "LICENSE.txt"), path.join(staging, "LICENSE.txt"));
  await fs.copyFile(path.join(repositoryRoot, "README.md"), path.join(staging, "README.md"));
  await fs.copyFile(path.join(repositoryRoot, "README.en.md"), path.join(staging, "README.en.md"));

  const metadata = {
    name: packageName,
    version: rootMetadata.version,
    description: rootMetadata.description,
    license: "MIT",
    type: "module",
    bin: { [packageName]: "bin/install.mjs" },
    files: ["bin", "my-wiki", "LICENSE.txt", "README.md", "README.en.md"],
    repository: { type: "git", url: "git+https://github.com/NimaChu/my-wiki-skill.git" },
    homepage: "https://github.com/NimaChu/my-wiki-skill#readme",
    bugs: { url: "https://github.com/NimaChu/my-wiki-skill/issues" },
    keywords: [
      "agent-skill",
      "knowledge-base",
      "local-first",
      "markdown",
      "knowledge-graph",
      "claude-code",
      "codex",
      "opencode",
      "openclaw",
      "hermes-agent",
      "rag",
      "obsidian",
      "llm"
    ],
    engines: { node: ">=18" }
  };
  await fs.writeFile(path.join(staging, "package.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  return { staging, metadata };
}

async function triggerMirrorSync() {
  try {
    const response = await fetch(mirrorSyncUrl, { method: "PUT" });
    console.log(`npmmirror sync requested (${response.status}).`);
  } catch (error) {
    console.warn(`npm publish succeeded, but npmmirror sync could not be requested: ${error.message}`);
  }
}

const { staging, metadata } = await createStagingPackage();
try {
  if (dryRun) {
    process.stdout.write(run(npmCommand, ["pack", "--dry-run", "--json"], { cwd: staging }));
  } else if (packDestination) {
    const destination = path.resolve(packDestination);
    await fs.mkdir(destination, { recursive: true });
    process.stdout.write(run(npmCommand, ["pack", "--pack-destination", destination], { cwd: staging }));
  } else {
    let alreadyPublished = false;
    const versionUrl = `${npmRegistry}/${encodeURIComponent(packageName)}/${encodeURIComponent(metadata.version)}`;
    const versionResponse = await fetch(versionUrl);
    if (versionResponse.ok) {
      console.log(`${packageName}@${metadata.version} is already published.`);
      alreadyPublished = true;
    } else if (versionResponse.status !== 404) {
      throw new Error(`Could not check npm version availability (${versionResponse.status}).`);
    }
    if (!alreadyPublished) {
      process.stdout.write(run(npmCommand, ["publish", "--access", "public", `--registry=${npmRegistry}`], { cwd: staging }));
      await triggerMirrorSync();
    }
  }
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
