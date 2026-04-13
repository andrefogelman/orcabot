#!/usr/bin/env npx tsx
/**
 * Import scraped TCPO demolition data into Supabase
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

const INPUT = join(import.meta.dirname || ".", "tcpo-output", "tcpo-demolicoes.json");

interface TcpoInsumo {
  codigo: string;
  descricao: string;
  unidade: string;
  classe: string;
  coeficiente: number;
  preco_unitario: number;
  total: number;
  consumo: number;
}

interface TcpoComposicao {
  codigo: string;
  descricao: string;
  unidade: string;
  categoria: string;
  search_term: string;
  regiao: string;
  data_precos: string;
  ls_percentual: number;
  bdi_percentual: number;
  custo_sem_taxas: number;
  custo_com_taxas: number;
  insumos: TcpoInsumo[];
}

async function main() {
  const data: TcpoComposicao[] = JSON.parse(readFileSync(INPUT, "utf-8"));
  console.log(`Loaded ${data.length} demolition compositions from ${INPUT}`);

  let imported = 0;
  let skipped = 0;
  let insumosTotal = 0;

  for (const comp of data) {
    const { data: row, error } = await sb
      .from("ob_tcpo_composicoes")
      .upsert({
        codigo: comp.codigo,
        descricao: comp.descricao,
        unidade: comp.unidade,
        categoria: comp.categoria,
        regiao: comp.regiao,
        data_precos: comp.data_precos,
        ls_percentual: comp.ls_percentual,
        bdi_percentual: comp.bdi_percentual,
        custo_sem_taxas: comp.custo_sem_taxas,
        custo_com_taxas: comp.custo_com_taxas,
        search_term: comp.search_term,
      }, { onConflict: "codigo" })
      .select("id")
      .single();

    if (error) {
      console.error(`  ❌ ${comp.codigo}: ${error.message}`);
      skipped++;
      continue;
    }

    const compId = row.id;

    await sb.from("ob_tcpo_insumos").delete().eq("composicao_id", compId);

    if (comp.insumos.length > 0) {
      const insumoRows = comp.insumos.map((ins) => ({
        composicao_id: compId,
        codigo: ins.codigo,
        descricao: ins.descricao,
        unidade: ins.unidade,
        classe: ins.classe,
        coeficiente: ins.coeficiente,
        preco_unitario: ins.preco_unitario,
        total: ins.total,
        consumo: ins.consumo,
      }));

      const { error: insError } = await sb.from("ob_tcpo_insumos").insert(insumoRows);
      if (insError) {
        console.error(`  ⚠️  Insumos error for ${comp.codigo}: ${insError.message}`);
      } else {
        insumosTotal += insumoRows.length;
      }
    }

    imported++;
  }

  console.log(`\n✅ Import complete:`);
  console.log(`  Composições: ${imported} imported, ${skipped} skipped`);
  console.log(`  Insumos: ${insumosTotal} total`);
}

main().catch(console.error);
