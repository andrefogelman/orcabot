#!/usr/bin/env npx tsx
/**
 * Fix search_term for all TCPO compositions:
 * Set to lowercase, accent-stripped "codigo + descricao"
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname || ".", "..");
const envFile = readFileSync(join(ROOT, ".env"), "utf-8");
for (const line of envFile.split("\n")) {
  const [key, ...val] = line.split("=");
  if (key && val.length) process.env[key.trim()] = val.join("=").trim().replace(/^"|"$/g, "");
}

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function main() {
  const { data, error } = await sb.from("ob_tcpo_composicoes").select("id, codigo, descricao, search_term");
  if (error) { console.error(error); process.exit(1); }

  let updated = 0;
  for (const row of data!) {
    const newSt = stripAccents(`${row.codigo} ${row.descricao}`);
    if (row.search_term === newSt) continue;
    const { error: ue } = await sb.from("ob_tcpo_composicoes").update({ search_term: newSt }).eq("id", row.id);
    if (ue) console.error("ERR", row.codigo, ue.message);
    else updated++;
  }
  console.log(`Updated search_term for ${updated} of ${data!.length} rows`);
}

main().catch(console.error);
