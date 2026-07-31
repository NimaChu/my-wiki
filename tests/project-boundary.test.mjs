import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(script, args = [], options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd || root,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    shell: false
  });
}

test("runnable application lives at the project root, outside the Skill", async () => {
  await fs.access(path.join(root, ".my-wiki-project.json"));
  await fs.access(path.join(root, "scripts", "my-wiki.mjs"));
  await fs.access(path.join(root, "assets", "dashboard", "server.mjs"));
  await fs.access(path.join(root, "my-wiki-skill", "SKILL.md"));
  await fs.access(path.join(root, "my-wiki-skill", "scripts", "my-wiki.mjs"));

  for (const forbidden of ["assets", "deploy", "tests"]) {
    await assert.rejects(fs.access(path.join(root, "my-wiki-skill", forbidden)));
  }
});

test("project and Skill package versions stay aligned", async () => {
  const packageMetadata = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const projectMarker = JSON.parse(await fs.readFile(path.join(root, ".my-wiki-project.json"), "utf8"));
  const skillMarker = JSON.parse(await fs.readFile(path.join(root, "my-wiki-skill", ".my-wiki-skill.json"), "utf8"));
  assert.equal(projectMarker.version, packageMetadata.version);
  assert.equal(skillMarker.version, packageMetadata.version);
});

test("project instructions stay a concise router to the canonical Skill", async () => {
  const instructions = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
  assert.match(instructions, /canonical Agent playbook/);
  assert.match(instructions, /read `my-wiki-skill\/SKILL\.md` first/);
  assert.match(instructions, /Ordinary questions about concepts/);
  assert.match(instructions, /Enter setup only when/);
  assert.match(instructions, /Do not duplicate operational workflows in this file/);
  assert.doesNotMatch(instructions, /npm run wiki -- search/);
  assert.ok(instructions.split(/\s+/).length < 500, "AGENTS.md should remain a quick project router");

  const workflows = await fs.readFile(path.join(root, "my-wiki-skill", "references", "workflows.md"), "utf8");
  assert.match(workflows, /Search the user's exact wording/);
  assert.match(workflows, /Chinese and English, abbreviations, aliases, or translations/);
  assert.match(workflows, /Never substitute model memory for an existing vault page/);
  assert.match(workflows, /Loop 工程是什么/);
});

test("project setup registers the checkout without creating a vault", async (context) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-project-"));
  context.after(() => fs.rm(temp, { recursive: true, force: true }));
  const config = path.join(temp, "project.json");
  const result = run(path.join(root, "scripts", "setup.mjs"), [], {
    env: { MY_WIKI_PROJECT_CONFIG_PATH: config }
  });

  assert.equal(result.status, 0, result.stderr);
  const registered = JSON.parse(await fs.readFile(config, "utf8"));
  assert.equal(registered.projectRoot, root);
  await assert.rejects(fs.access(path.join(root, "raw")));
  await assert.rejects(fs.access(path.join(root, "wiki")));
});

test("standalone Skill bridge invokes a registered project", async (context) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-skill-"));
  context.after(() => fs.rm(temp, { recursive: true, force: true }));
  const skill = path.join(temp, "my-wiki");
  const config = path.join(temp, "project.json");
  await fs.cp(path.join(root, "my-wiki-skill"), skill, { recursive: true });
  await fs.writeFile(config, `${JSON.stringify({ version: 1, projectRoot: root }, null, 2)}\n`);

  const result = run(path.join(skill, "scripts", "my-wiki.mjs"), ["--help"], {
    cwd: temp,
    env: {
      MY_WIKI_HOME: "",
      MY_WIKI_PROJECT_CONFIG_PATH: config,
      MY_WIKI_CONFIG_PATH: path.join(temp, "vaults.json")
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /My Wiki CLI/);
});

test("standalone Skill explains both missing project and vault setup", async (context) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-missing-"));
  context.after(() => fs.rm(temp, { recursive: true, force: true }));
  const skill = path.join(temp, "skills", "my-wiki");
  await fs.cp(path.join(root, "my-wiki-skill"), skill, { recursive: true });

  const result = run(path.join(skill, "scripts", "my-wiki.mjs"), ["where"], {
    cwd: temp,
    env: {
      HOME: temp,
      USERPROFILE: temp,
      MY_WIKI_HOME: "",
      MY_WIKI_PROJECT_CONFIG_PATH: path.join(temp, "missing-project.json"),
      MY_WIKI_CONFIG_PATH: path.join(temp, "missing-vaults.json")
    }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /found no installed My Wiki project/);
  assert.match(result.stderr, /Install the project first/);
  assert.match(result.stderr, /create a separate local vault/);

  const instructions = await fs.readFile(path.join(skill, "SKILL.md"), "utf8");
  assert.match(instructions, /Bootstrap Missing Layers/);
  assert.match(instructions, /https:\/\/github\.com\/NimaChu\/my-wiki\.git/);
  assert.match(instructions, /Rerun `where`/);
  assert.match(instructions, /Run `where` and `status` through the bridge/);
});
