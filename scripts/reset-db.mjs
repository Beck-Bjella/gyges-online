/**
 * Delete the local development database.
 *
 * The schema is recreated on the next request, so this is the quickest way to
 * start from nothing.
 *
 * DELIBERATELY ignores GYGES_DB_PATH and hardcodes the repo-local .data/
 * directory: production keeps its database OUTSIDE the repo, so this script
 * is structurally incapable of touching it, even run on the server by
 * mistake. Do not "fix" this to honour the env var — that safety is the
 * point.
 */

import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), ".data");

if (existsSync(dir)) {
  rmSync(dir, { recursive: true, force: true });
  console.log("Removed .data/ — the database will be recreated on next run.");
} else {
  console.log("No .data/ directory; nothing to remove.");
}
