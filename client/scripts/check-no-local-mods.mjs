// Fails when anything under mods/local/ (or another private mod path) is staged. Run by .githooks/pre-commit and by `npm test`.
import { execFileSync } from "node:child_process";
import { blockedPaths } from "./localGuard.mjs";

const staged = execFileSync("git", ["diff", "--cached", "--name-only", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const bad = blockedPaths(staged);
if (bad.length) {
  console.error("Refusing to commit private mod content:\n" + bad.map((p) => `  ${p}`).join("\n"));
  console.error("These paths are gitignored on purpose. Unstage them with: git restore --staged <path>");
  process.exit(1);
}
