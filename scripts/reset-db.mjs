/**
 * Delete the local development database.
 *
 * The schema is recreated on the next request, so this is the quickest way to
 * start from nothing. Local development only — never point this at production.
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
