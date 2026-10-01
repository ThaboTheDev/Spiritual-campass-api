// The seed SQL must be exactly the 88 centres from centres-data.js (that file is now only the seed source),
// and the schema must keep the promises the API relies on.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, CENTRES } from "../../api/_lib/centres-data.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const seed = fs.readFileSync(path.join(root, "supabase", "seed-centres.sql"), "utf8");
const schema = fs.readFileSync(path.join(root, "supabase", "schema.sql"), "utf8");

/* Parses generated rows like  ('Gauteng', 'Name', 'addr', null, -26.2, 28.0, 3),  */
function parseRow(line) {
  return (line.match(/'(?:[^']|'')*'|null|-?\d+(?:\.\d+)?/g) || []).map((tok) => {
    if (tok === "null") return null;
    if (tok.startsWith("'")) return tok.slice(1, -1).replace(/''/g, "'");
    return Number(tok);
  });
}
const section = (name) => {
  const start = seed.indexOf(`insert into public.${name}`);
  assert.ok(start >= 0, `seed has an insert for ${name}`);
  const end = seed.indexOf("on conflict", start);
  return seed.slice(start, end).split("\n").filter((l) => l.trim().startsWith("(")).map(parseRow);
};

test("seed-centres.sql holds all 15 regions in order", () => {
  const rows = section("regions");
  assert.equal(rows.length, REGIONS.length);
  assert.deepEqual(rows.map((r) => r[0]), REGIONS);
  assert.deepEqual(rows.map((r) => r[1]), REGIONS.map((_, i) => i + 1));
});

test("seed-centres.sql holds all 88 centres with the same details and order", () => {
  const rows = section("centres");
  assert.equal(rows.length, 88);
  assert.equal(rows.length, CENTRES.length);
  const expected = CENTRES.map((c) => [c.r, c.n, c.a, c.p || null, c.la, c.lo, CENTRES.filter((x) => x.r === c.r).indexOf(c) + 1]);
  assert.deepEqual(rows, expected);
});

test("the seed is idempotent and safe to re-run", () => {
  assert.match(seed, /on conflict \(name\) do update/);
  assert.match(seed, /on conflict \(region, name\) do update/);
  assert.match(seed, /^begin;/m);
  assert.match(seed, /^commit;/m);
});

test("the schema keeps must_change_password, is_admin, the centre tables and the admin SQL note", () => {
  assert.match(schema, /must_change_password boolean not null default false/);
  assert.match(schema, /is_admin\s+boolean not null default false/);
  assert.match(schema, /create table if not exists public\.regions/);
  assert.match(schema, /create table if not exists public\.centres/);
  assert.match(schema, /create table if not exists public\.admin_audit/);
  assert.match(schema, /alter table public\.regions\s+enable row level security/);
  assert.match(schema, /alter table public\.centres\s+enable row level security/);
  assert.match(schema, /revoke all on public\.centres\s+from anon, authenticated/);
  assert.match(schema, /update public\.members set is_admin = true where email = /);
  assert.match(schema, /add column if not exists is_admin/);
  assert.match(schema, /add column if not exists must_change_password/);
  /* the only members policy is SELECT: no client write policy exists, so PostgREST cannot self-promote */
  assert.equal((schema.match(/create policy/g) || []).length, 2);
  assert.match(schema, /create policy "members read own row" on public\.members for select/);
});
