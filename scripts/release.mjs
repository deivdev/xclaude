// Bumps the version everywhere, rolls the changelog, commits and tags.
// Usage: pnpm release <patch|minor|major|x.y.z>
// package.json holds the version; tauri.conf.json reads it from there and
// Cargo.toml is kept in step. Nothing is pushed.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
const die = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

const arg = process.argv[2];
if (!arg) die("usage: pnpm release <patch|minor|major|x.y.z>");
if (run("git", ["status", "--porcelain"])) die("the working tree has uncommitted changes; commit them first");

const pkgPath = `${root}package.json`;
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);
const next = { major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}` }[arg] ?? arg;
if (!/^\d+\.\d+\.\d+$/.test(next)) die(`"${next}" is not a version (x.y.z)`);
if (run("git", ["tag", "--list", `v${next}`])) die(`tag v${next} already exists`);

// CHANGELOG.md: the notes under "Unreleased" become the new version's section.
const changelogPath = `${root}CHANGELOG.md`;
const changelog = readFileSync(changelogPath, "utf8");
const marker = "## [Unreleased]";
const start = changelog.indexOf(marker);
if (start < 0) die(`CHANGELOG.md has no "${marker}" section`);
const rest = changelog.slice(start + marker.length);
const end = rest.search(/\n## \[/);
const notes = (end < 0 ? rest : rest.slice(0, end)).trim();
if (!notes) die(`the "${marker}" section of CHANGELOG.md is empty: describe what changed first`);
const date = new Date().toISOString().slice(0, 10);
writeFileSync(
  changelogPath,
  `${changelog.slice(0, start)}${marker}\n\n## [${next}] - ${date}\n\n${notes}\n${end < 0 ? "" : rest.slice(end)}`,
);

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const cargoPath = `${root}src-tauri/Cargo.toml`;
writeFileSync(cargoPath, readFileSync(cargoPath, "utf8").replace(/^version = ".*"$/m, `version = "${next}"`));
run("cargo", ["update", "--workspace", "--offline"], `${root}src-tauri`);

run("git", ["add", "package.json", "CHANGELOG.md", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]);
run("git", ["commit", "-m", `release: v${next}`]);
run("git", ["tag", "-a", `v${next}`, "-m", `xclaude ${next}`]);
console.log(`v${next}: committed and tagged. Install it with: pnpm install-app`);
