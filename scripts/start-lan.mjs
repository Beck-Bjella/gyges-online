/**
 * Start the production server for local-network play.
 *
 * Differs from `next start` in two ways:
 *
 *  - binds 0.0.0.0, so other machines on the wifi can reach it;
 *  - disables the Secure flag on the session cookie.
 *
 * That second part matters. A Secure cookie is only ever sent back over HTTPS,
 * so on a plain http:// LAN address the browser accepts the session cookie and
 * then never returns it — sign-in appears to work, and every page after it
 * looks signed out. Real deployments serve HTTPS and keep the flag on.
 */

import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { createRequire } from "node:module";

const port = process.env.PORT ?? "3000";

const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i.address);

console.log("\nGygès — local network mode\n");
console.log(`  this machine   http://localhost:${port}`);
for (const a of addresses) {
  console.log(`  other devices  http://${a}:${port}`);
}
console.log("\n  Session cookies are not marked Secure, so sign-in works over");
console.log("  plain http. Do not use this mode for a public deployment.\n");

// Resolve Next's own entry script and run it with this Node, rather than
// shelling out to npx: on Windows, spawning a .cmd without a shell fails
// with EINVAL, and enabling the shell would mean quoting arguments by hand.
const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(
  process.execPath,
  [nextBin, "start", "--hostname", "0.0.0.0", "--port", port],
  {
    stdio: "inherit",
    env: { ...process.env, GYGES_INSECURE_COOKIES: "1" },
  },
);

child.on("exit", (code) => process.exit(code ?? 0));
