import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envFile = readFileSync(".env", "utf-8");
const env: Record<string, string> = {};
for (const line of envFile.split("\n")) {
  const [k, ...v] = line.split("=");
  if (k && v.length) env[k.trim()] = v.join("=").trim().replace(/^"|"$/g, "");
}

async function main() {
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

  const { error: authErr } = await sb.auth.signInWithPassword({
    email: "andre@anf.com.br",
    password: "OrcaBot2026!",
  });
  if (authErr) {
    console.log("Auth error:", authErr.message);
    return;
  }
  console.log("Logged in as anon user");

  // READ
  const { data: readData, error: readErr } = await sb
    .from("ob_tcpo_composicoes")
    .select("id, codigo, descricao")
    .limit(1);
  console.log("READ:", readErr ? `ERROR: ${readErr.message}` : `OK — ${readData?.[0]?.codigo}`);

  if (!readData?.[0]) return;
  const testId = readData[0].id;
  const origDesc = readData[0].descricao;

  // UPDATE
  const { error: updateErr } = await sb
    .from("ob_tcpo_composicoes")
    .update({ descricao: origDesc + " EDIT-TEST" })
    .eq("id", testId);
  console.log("UPDATE:", updateErr ? `ERROR: ${updateErr.message}` : "OK");

  // Revert
  if (!updateErr) {
    await sb.from("ob_tcpo_composicoes").update({ descricao: origDesc }).eq("id", testId);
    console.log("REVERT: OK");
  }

  // INSERT
  const { data: insData, error: insErr } = await sb
    .from("ob_tcpo_composicoes")
    .insert({ codigo: "TEST-DELETE-ME", descricao: "test crud", unidade: "un" })
    .select("id")
    .single();
  console.log("INSERT:", insErr ? `ERROR: ${insErr.message}` : `OK id=${insData?.id}`);

  // DELETE
  if (insData) {
    const { error: delErr } = await sb.from("ob_tcpo_composicoes").delete().eq("id", insData.id);
    console.log("DELETE:", delErr ? `ERROR: ${delErr.message}` : "OK");
  }
}

main();
