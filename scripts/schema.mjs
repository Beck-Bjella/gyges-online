/**
 * Print the database's CURRENT shape — every table and index, as it exists
 * right now, with all migrations summed up.
 *
 * This is the blueprint; migrations/ is the diary. Read this to know what the
 * database IS, read a migration to know why some column exists.
 */

import Database from "better-sqlite3";
import { join } from "node:path";

const DB_PATH =
  process.env.GYGES_DB_PATH ?? join(process.cwd(), ".data", "gyges.db");

const db = new Database(DB_PATH, { readonly: true });
const rows = db
  .prepare(
    `SELECT sql FROM sqlite_master
      WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`,
  )
  .all();
for (const { sql } of rows) console.log(sql + ";\n");
db.close();
