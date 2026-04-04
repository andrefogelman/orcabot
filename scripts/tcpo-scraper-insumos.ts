#!/usr/bin/env npx tsx
/**
 * TCPO Insumos Scraper — Scrapes Materials, Labor, Equipment from TCPOweb
 * Uses the same search approach as tcpo-scraper.ts but targets insumos.
 * Output: scripts/tcpo-output/tcpo-insumos-raw.json
 */

import { chromium, type Page } from "playwright";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOME_URL = "https://tcpoweb.pini.com.br/home/home.aspx";
const TREE_URL = "https://tcpoweb.pini.com.br/PesqServicosTreeView.aspx";
const EMAIL = "andre@anf.com.br";
const PASSWORD = "andre@anf";

const OUTPUT_DIR = join(import.meta.dirname || ".", "tcpo-output");
const OUTPUT_FILE = join(OUTPUT_DIR, "tcpo-insumos-raw.json");
const CHECKPOINT_FILE = join(OUTPUT_DIR, "tcpo-insumos-checkpoint.json");

// Search terms to find insumos by category
const SEARCH_TERMS = [
  // Materiais
  { term: "aco ca-50", cat: "Materiais" },
  { term: "aco ca-60", cat: "Materiais" },
  { term: "areia", cat: "Materiais" },
  { term: "brita", cat: "Materiais" },
  { term: "cimento", cat: "Materiais" },
  { term: "cal hidratada", cat: "Materiais" },
  { term: "argamassa", cat: "Materiais" },
  { term: "tijolo", cat: "Materiais" },
  { term: "bloco ceramico", cat: "Materiais" },
  { term: "tubo pvc", cat: "Materiais" },
  { term: "fio eletrico", cat: "Materiais" },
  { term: "cabo eletrico", cat: "Materiais" },
  { term: "prego", cat: "Materiais" },
  { term: "parafuso", cat: "Materiais" },
  { term: "chapa madeira", cat: "Materiais" },
  { term: "tabua", cat: "Materiais" },
  { term: "pontalete", cat: "Materiais" },
  { term: "sarrafo", cat: "Materiais" },
  { term: "tinta latex", cat: "Materiais" },
  { term: "tinta acrilica", cat: "Materiais" },
  { term: "massa corrida", cat: "Materiais" },
  { term: "impermeabilizante", cat: "Materiais" },
  { term: "manta asfaltica", cat: "Materiais" },
  { term: "telha", cat: "Materiais" },
  { term: "ceramica piso", cat: "Materiais" },
  { term: "porcelanato", cat: "Materiais" },
  { term: "vidro", cat: "Materiais" },
  { term: "porta madeira", cat: "Materiais" },
  { term: "janela aluminio", cat: "Materiais" },
  { term: "registro", cat: "Materiais" },
  { term: "valvula", cat: "Materiais" },
  { term: "conexao pvc", cat: "Materiais" },
  { term: "disjuntor", cat: "Materiais" },
  { term: "interruptor", cat: "Materiais" },
  { term: "tomada", cat: "Materiais" },
  { term: "eletroduto", cat: "Materiais" },
  { term: "luminaria", cat: "Materiais" },
  { term: "seixo", cat: "Materiais" },
  { term: "aditivo", cat: "Materiais" },
  { term: "adaptador", cat: "Materiais" },
  // Mão de obra
  { term: "pedreiro", cat: "Mão de obra" },
  { term: "servente", cat: "Mão de obra" },
  { term: "carpinteiro", cat: "Mão de obra" },
  { term: "armador", cat: "Mão de obra" },
  { term: "eletricista", cat: "Mão de obra" },
  { term: "encanador", cat: "Mão de obra" },
  { term: "pintor", cat: "Mão de obra" },
  { term: "ajudante", cat: "Mão de obra" },
  { term: "montador", cat: "Mão de obra" },
  { term: "soldador", cat: "Mão de obra" },
  { term: "serralheiro", cat: "Mão de obra" },
  { term: "gesseiro", cat: "Mão de obra" },
  { term: "azulejista", cat: "Mão de obra" },
  { term: "calceteiro", cat: "Mão de obra" },
  { term: "operador", cat: "Mão de obra" },
  { term: "motorista", cat: "Mão de obra" },
  // Equipamentos
  { term: "betoneira", cat: "Equipamentos" },
  { term: "retroescavadeira", cat: "Equipamentos" },
  { term: "escavadeira", cat: "Equipamentos" },
  { term: "rolo compactador", cat: "Equipamentos" },
  { term: "caminhao basculante", cat: "Equipamentos" },
  { term: "guindaste", cat: "Equipamentos" },
  { term: "grua", cat: "Equipamentos" },
  { term: "vibrador concreto", cat: "Equipamentos" },
  { term: "compressor", cat: "Equipamentos" },
  { term: "serra circular", cat: "Equipamentos" },
  { term: "andaime", cat: "Equipamentos" },
];

interface TcpoInsumo {
  codigo: string;
  descricao: string;
  unidade: string;
  categoria: string;
  search_term: string;
  regiao: string;
  preco: number;
}

let allInsumos: TcpoInsumo[] = [];
let completedSearches: string[] = [];

function loadState(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  if (existsSync(OUTPUT_FILE)) allInsumos = JSON.parse(readFileSync(OUTPUT_FILE, "utf-8"));
  if (existsSync(CHECKPOINT_FILE)) completedSearches = JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
  console.log(`Loaded: ${allInsumos.length} insumos, ${completedSearches.length} searches done`);
}

function saveState(): void {
  writeFileSync(OUTPUT_FILE, JSON.stringify(allInsumos, null, 2), "utf-8");
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(completedSearches), "utf-8");
}

async function login(page: Page): Promise<void> {
  console.log("Logging in...");
  page.on("dialog", async (dialog) => { await dialog.dismiss().catch(() => {}); });
  await page.goto(HOME_URL, { waitUntil: "networkidle", timeout: 20000 });
  await page.fill('input[placeholder="Usuário"]', EMAIL);
  await page.fill('input[placeholder="Senha"]', PASSWORD);
  await page.click('input[value="Entrar"]');
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3000);

  // Retry loop for session conflict
  for (let attempt = 1; attempt <= 10; attempt++) {
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    if (page.url().includes("Menu.aspx") || bodyText.includes("Sair")) {
      console.log("Login successful!");
      return;
    }
    if (bodyText.includes("Acesso negado")) {
      const waitSec = attempt * 30;
      console.log(`Session conflict (attempt ${attempt}/10) — waiting ${waitSec}s...`);
      await page.click("text=OK").catch(() => {});
      await page.waitForTimeout(waitSec * 1000);
      await page.goto(HOME_URL, { waitUntil: "networkidle", timeout: 20000 });
      await page.fill('input[placeholder="Usuário"]', EMAIL);
      await page.fill('input[placeholder="Senha"]', PASSWORD);
      await page.click('input[value="Entrar"]');
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(3000);
      continue;
    }
    throw new Error(`Login failed. URL: ${page.url()}`);
  }
  throw new Error("Login failed after 10 attempts");
}

async function goToSearch(page: Page): Promise<void> {
  if (!page.url().includes("PesqServicos")) {
    await page.goto(TREE_URL, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1000);
  }
  // Switch to PREÇOS PINI base (has insumos with prices)
  const base = await page.$('select[id*="ddlBases"]');
  if (base) {
    const val = await base.inputValue();
    if (!val.includes("PRECOSPINI")) {
      await base.selectOption("PRECOSPINI|1|");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);
    }
  }
}

async function search(page: Page, term: string): Promise<string[]> {
  await goToSearch(page);
  await page.fill('#ctl00_MainContent_txtBusca', term);
  await page.click('#ctl00_MainContent_imgBtnPesquisaServico');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  if (page.url().includes("home.aspx")) {
    console.log("  Session expired — re-logging in...");
    await login(page);
    await goToSearch(page);
    await page.fill('#ctl00_MainContent_txtBusca', term);
    await page.click('#ctl00_MainContent_imgBtnPesquisaServico');
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
  }

  const codes = await page.evaluate(() => {
    const results: string[] = [];
    document.querySelectorAll("a").forEach((a) => {
      const text = (a as HTMLElement).innerText?.trim() || "";
      const href = a.getAttribute("href") || "";
      if (text.match(/^[\dA-Z][\dA-Z\.\s]+[\dA-Z]$/) && text.length > 5 && href.includes("__doPostBack")) {
        results.push(text);
      }
    });
    return results;
  });

  console.log(`  Search "${term}": ${codes.length} results`);
  return codes;
}

// Extract insumo detail from list view (simpler than composition — just code, desc, unit, price)
async function extractInsumoFromList(page: Page): Promise<TcpoInsumo[]> {
  const SCRIPT = `(() => {
    var results = [];
    var rows = document.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].querySelectorAll('td');
      if (cells.length >= 3) {
        var base = (cells[0]?.innerText || '').trim();
        var code = (cells[1]?.innerText || '').trim();
        var desc = (cells[2]?.innerText || '').trim();
        var unit = cells.length > 3 ? (cells[cells.length-1]?.innerText || '').trim() : '';
        if (base && code && desc && code.match(/[0-9]/) && base.includes('PINI')) {
          results.push({ codigo: code, descricao: desc, unidade: unit });
        }
      }
    }
    return results;
  })()`;
  return page.evaluate(SCRIPT) as Promise<TcpoInsumo[]>;
}

async function processSearchTerm(page: Page, term: string, cat: string): Promise<void> {
  if (completedSearches.includes(term)) {
    console.log(`⏭️  Skipping "${term}" (already done)`);
    return;
  }

  console.log(`\n🔍 Searching: "${term}" (${cat})`);

  // Get results from the list view directly (insumos don't need clicking into detail)
  await goToSearch(page);
  await page.fill('#ctl00_MainContent_txtBusca', term);
  await page.click('#ctl00_MainContent_imgBtnPesquisaServico');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  if (page.url().includes("home.aspx")) {
    await login(page);
    await goToSearch(page);
    await page.fill('#ctl00_MainContent_txtBusca', term);
    await page.click('#ctl00_MainContent_imgBtnPesquisaServico');
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
  }

  const items = await extractInsumoFromList(page);
  let added = 0;
  for (const item of items) {
    if (!allInsumos.some(i => i.codigo === item.codigo)) {
      allInsumos.push({
        ...item,
        categoria: cat,
        search_term: term,
        regiao: "São Paulo",
        preco: 0, // Price is in the detail view, we skip for now
      });
      added++;
    }
  }

  console.log(`  ✅ ${added} new insumos (total: ${allInsumos.length})`);
  completedSearches.push(term);
  saveState();
}

async function main(): Promise<void> {
  loadState();
  console.log("🚀 TCPO Insumos Scraper");
  console.log(`${SEARCH_TERMS.length} search terms, output: ${OUTPUT_FILE}\n`);

  const browser = await chromium.launch({ headless: true, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    await login(page);
    for (const { term, cat } of SEARCH_TERMS) {
      try {
        await processSearchTerm(page, term, cat);
      } catch (err) {
        console.error(`❌ Error on "${term}":`, (err as Error).message);
        await goToSearch(page).catch(() => {});
      }
    }
    saveState();
    console.log(`\n🏁 Done! ${allInsumos.length} insumos scraped`);
  } catch (err) {
    console.error("Fatal:", err);
    saveState();
  } finally {
    try {
      await page.goto("https://tcpoweb.pini.com.br/Logout.aspx", { timeout: 10000 });
      await page.waitForTimeout(1000);
      console.log("Logged out successfully");
    } catch { /* ignore */ }
    await browser.close();
  }
}

main();
