#!/usr/bin/env npx tsx
/**
 * TCPO Scraper — Demolições
 *
 * Focused scraper for demolition compositions.
 * Reuses the same auth/extract logic from tcpo-scraper.ts
 * but with demolition-specific search terms.
 *
 * Usage: cd ~/orcabot && npx tsx scripts/tcpo-scraper-demolicoes.ts
 * Output: scripts/tcpo-output/tcpo-demolicoes.json
 */

import { chromium, type Page } from "playwright";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOME_URL = "https://tcpoweb.pini.com.br/home/home.aspx";
const TREE_URL = "https://tcpoweb.pini.com.br/PesqServicosTreeView.aspx";
const EMAIL = "andre@anf.com.br";
const PASSWORD = "andre@anf";

const OUTPUT_DIR = join(import.meta.dirname || ".", "tcpo-output");
const OUTPUT_FILE = join(OUTPUT_DIR, "tcpo-demolicoes.json");
const CHECKPOINT_FILE = join(OUTPUT_DIR, "tcpo-demolicoes-checkpoint.json");

const SEARCH_TERMS = [
  // Termos genéricos
  { term: "demolicao", cat: "03. Demolições" },
  { term: "demolir", cat: "03. Demolições" },
  { term: "remocao", cat: "03. Demolições" },
  { term: "retirada", cat: "03. Demolições" },
  { term: "arrancar", cat: "03. Demolições" },
  { term: "desmonte", cat: "03. Demolições" },

  // Alvenaria / estrutura
  { term: "demolicao alvenaria", cat: "03. Demolições" },
  { term: "demolicao concreto", cat: "03. Demolições" },
  { term: "demolicao concreto armado", cat: "03. Demolições" },
  { term: "demolicao estrutura", cat: "03. Demolições" },
  { term: "demolicao edificacao", cat: "03. Demolições" },
  { term: "demolicao muro", cat: "03. Demolições" },
  { term: "demolicao parede", cat: "03. Demolições" },
  { term: "demolicao laje", cat: "03. Demolições" },
  { term: "demolicao viga", cat: "03. Demolições" },
  { term: "demolicao pilar", cat: "03. Demolições" },

  // Pisos
  { term: "demolicao piso", cat: "03. Demolições" },
  { term: "demolicao piso ceramico", cat: "03. Demolições" },
  { term: "demolicao piso cimentado", cat: "03. Demolições" },
  { term: "demolicao assoalho", cat: "03. Demolições" },
  { term: "demolicao taco", cat: "03. Demolições" },
  { term: "demolicao granilite", cat: "03. Demolições" },
  { term: "demolicao pavimentacao", cat: "03. Demolições" },
  { term: "demolicao lastro", cat: "03. Demolições" },
  { term: "demolicao contrapiso", cat: "03. Demolições" },

  // Revestimentos
  { term: "demolicao revestimento", cat: "03. Demolições" },
  { term: "demolicao azulejo", cat: "03. Demolições" },
  { term: "demolicao reboco", cat: "03. Demolições" },
  { term: "demolicao argamassa", cat: "03. Demolições" },
  { term: "demolicao chapisco", cat: "03. Demolições" },
  { term: "demolicao lambri", cat: "03. Demolições" },

  // Forros / coberturas
  { term: "demolicao forro", cat: "03. Demolições" },
  { term: "demolicao cobertura", cat: "03. Demolições" },
  { term: "demolicao telhado", cat: "03. Demolições" },
  { term: "demolicao telha", cat: "03. Demolições" },
  { term: "demolicao estrutura madeira", cat: "03. Demolições" },
  { term: "demolicao estuque", cat: "03. Demolições" },

  // Esquadrias / instalações
  { term: "remocao porta", cat: "03. Demolições" },
  { term: "remocao janela", cat: "03. Demolições" },
  { term: "remocao esquadria", cat: "03. Demolições" },
  { term: "remocao vidro", cat: "03. Demolições" },
  { term: "remocao tubulacao", cat: "03. Demolições" },
  { term: "remocao instalacao", cat: "03. Demolições" },
  { term: "remocao louca", cat: "03. Demolições" },
  { term: "remocao aparelho sanitario", cat: "03. Demolições" },
  { term: "remocao pia", cat: "03. Demolições" },
  { term: "remocao tanque", cat: "03. Demolições" },

  // Pavimentação
  { term: "demolicao asfalto", cat: "03. Demolições" },
  { term: "demolicao meio fio", cat: "03. Demolições" },
  { term: "demolicao guia", cat: "03. Demolições" },
  { term: "demolicao sarjeta", cat: "03. Demolições" },
  { term: "demolicao paralelepipedo", cat: "03. Demolições" },
  { term: "demolicao pre moldado", cat: "03. Demolições" },

  // Equipamentos / métodos
  { term: "martelo rompedor", cat: "03. Demolições" },
  { term: "rompedor pneumatico", cat: "03. Demolições" },
  { term: "corte concreto", cat: "03. Demolições" },
  { term: "corte disco", cat: "03. Demolições" },

  // Carga e transporte de entulho
  { term: "carga entulho", cat: "03. Demolições" },
  { term: "transporte entulho", cat: "03. Demolições" },
  { term: "bota fora", cat: "03. Demolições" },
  { term: "cacamba entulho", cat: "03. Demolições" },
  { term: "remocao entulho", cat: "03. Demolições" },

  // Pintura / acabamentos
  { term: "raspagem pintura", cat: "03. Demolições" },
  { term: "remocao pintura", cat: "03. Demolições" },
  { term: "remocao papel parede", cat: "03. Demolições" },

  // Impermeabilização
  { term: "remocao impermeabilizacao", cat: "03. Demolições" },
  { term: "remocao manta", cat: "03. Demolições" },
];

// --- Types ---

interface Insumo {
  codigo: string;
  descricao: string;
  unidade: string;
  classe: string;
  coeficiente: number;
  preco_unitario: number;
  total: number;
  consumo: number;
}

interface Composicao {
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
  insumos: Insumo[];
}

let allComposicoes: Composicao[] = [];
let completedSearches: string[] = [];

function loadState(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  if (existsSync(OUTPUT_FILE)) {
    allComposicoes = JSON.parse(readFileSync(OUTPUT_FILE, "utf-8"));
  }
  if (existsSync(CHECKPOINT_FILE)) {
    completedSearches = JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  console.log(`Loaded: ${allComposicoes.length} composições, ${completedSearches.length} searches done`);
}

function saveState(): void {
  writeFileSync(OUTPUT_FILE, JSON.stringify(allComposicoes, null, 2), "utf-8");
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(completedSearches), "utf-8");
}

async function login(page: Page): Promise<void> {
  console.log("Logging in...");

  page.on("dialog", async (dialog) => {
    console.log(`  Dialog: ${dialog.message()}`);
    await dialog.dismiss().catch(() => {});
  });

  await page.goto(HOME_URL, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(1000);

  const hasSair = await page.$('a[href*="Logout"]');
  if (hasSair) {
    console.log("Already logged in");
    return;
  }

  await page.fill('input[placeholder="Usuário"]', EMAIL);
  await page.fill('input[placeholder="Senha"]', PASSWORD);
  await page.click('input[value="Entrar"]');
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3000);

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
      await page.waitForTimeout(1000);
      await page.fill('input[placeholder="Usuário"]', EMAIL);
      await page.fill('input[placeholder="Senha"]', PASSWORD);
      await page.click('input[value="Entrar"]');
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(3000);
      continue;
    }

    if (page.url().includes("Menu.aspx")) {
      console.log("Login successful!");
      return;
    }

    const hasSairNow = await page.$('a[href*="Logout"]');
    if (hasSairNow) {
      console.log("Login successful (Sair link found)");
      return;
    }

    throw new Error(`Login failed unexpectedly. URL: ${page.url()}`);
  }

  throw new Error("Login failed after 10 attempts — session never freed");
}

async function goToSearch(page: Page): Promise<void> {
  if (!page.url().includes("PesqServicosTreeView")) {
    await page.goto(TREE_URL, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1000);
  }
  const base = await page.$('select[id*="ddlBases"]');
  if (base) {
    const val = await base.inputValue();
    if (!val.includes("TCPO_PINI")) {
      await base.selectOption("TCPO_PINI|1|");
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

  if (page.url().includes("home.aspx") || page.url().includes("Login")) {
    console.log("  Session expired during search — re-logging in...");
    await login(page);
    await goToSearch(page);
    await page.fill('#ctl00_MainContent_txtBusca', term);
    await page.click('#ctl00_MainContent_imgBtnPesquisaServico');
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);
  }

  const codes = await page.evaluate(() => {
    const results: string[] = [];
    const links = document.querySelectorAll("a");
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const text = (link as HTMLElement).innerText?.trim() || "";
      if (text.match(/^[\dA-Z][\dA-Z\.\s]+[\dA-Z]$/) && text.length > 5 && href.includes("__doPostBack")) {
        results.push(text);
      }
    }
    return results;
  });

  console.log(`  Search "${term}": ${codes.length} results`);
  return codes;
}

async function extractDetail(page: Page): Promise<Omit<Composicao, "categoria" | "search_term"> | null> {
  const EXTRACT_SCRIPT = `(() => {
    var body = document.body.innerText;
    function parseBR(s) { if (!s) return 0; return parseFloat(s.replace(/\\./g, "").replace(",", ".")) || 0; }
    if (!body.includes("Código:")) return null;
    var headerMatch = body.match(/Código:\\s*(.+?)(?:\\n|$)/);
    if (!headerMatch) return null;
    var headerLine = headerMatch[1];
    var codMatch = headerLine.match(/^([\\w\\s\\.]+?)\\s+-\\s+/);
    var unidMatch = headerLine.match(/Unidade:\\s*(\\S+)/);
    var codigo = codMatch && codMatch[1] ? codMatch[1].trim() : "";
    var unidade = unidMatch && unidMatch[1] ? unidMatch[1] : "";
    if (!codigo) return null;
    var descMatch = body.match(/Descrição:\\s*(.+?)(?:\\n|$)/);
    var descricao = descMatch && descMatch[1] ? descMatch[1].trim() : "";
    var regiaoEl = document.querySelector('select[id*="ddlRegiao"]');
    var regiao = regiaoEl && regiaoEl.selectedOptions && regiaoEl.selectedOptions[0] ? regiaoEl.selectedOptions[0].text.trim() : "São Paulo";
    var dataEl = document.querySelector('select[id*="ddlDataPrecos"]');
    var dataPrecos = dataEl && dataEl.selectedOptions && dataEl.selectedOptions[0] ? dataEl.selectedOptions[0].text.trim() : "";
    var lsMatch = body.match(/LS:\\s*([\\d\\.,]+)/);
    var bdiMatch = body.match(/BDI:\\s*([\\d\\.,]+)/);
    var ls = parseBR(lsMatch ? lsMatch[1] : "");
    var bdi = parseBR(bdiMatch ? bdiMatch[1] : "");
    var semMatch = body.match(/Sem taxas:\\s*([\\d\\.,]+)/);
    var comMatch = body.match(/Com taxas:\\s*([\\d\\.,]+)/);
    var semTaxas = parseBR(semMatch ? semMatch[1] : "");
    var comTaxas = parseBR(comMatch ? comMatch[1] : "");

    var insumos = [];
    var tables = document.querySelectorAll("table");
    for (var t = 0; t < tables.length; t++) {
      var headerRow = tables[t].querySelector("tr");
      if (!headerRow) continue;
      var headerCells = headerRow.querySelectorAll("td, th");
      var headerTexts = [];
      for (var h = 0; h < headerCells.length; h++) headerTexts.push((headerCells[h].innerText || "").trim());
      var headerJoined = headerTexts.join(" ");
      if (headerJoined.indexOf("Código") < 0 || headerJoined.indexOf("Class") < 0) continue;
      if (headerJoined.indexOf("Coef") < 0 && headerJoined.indexOf("Consumo") < 0) continue;

      var rows = tables[t].querySelectorAll("tr");
      for (var r = 1; r < rows.length; r++) {
        var cells = rows[r].querySelectorAll("td");
        if (cells.length < 5) continue;
        var c0 = (cells[0].innerText || "").trim();
        if (!c0 || !c0.match(/[0-9A-Z]/)) continue;
        if (c0.indexOf("Total") >= 0) continue;

        var precoCell = cells.length > 5 ? cells[5] : null;
        var precoInput = precoCell ? precoCell.querySelector("input") : null;
        var precoVal = precoInput ? precoInput.value : (precoCell ? (precoCell.innerText || "").trim() : "");

        insumos.push({
          codigo: c0,
          descricao: cells.length > 1 ? (cells[1].innerText || "").trim() : "",
          unidade: cells.length > 2 ? (cells[2].innerText || "").trim() : "",
          classe: cells.length > 3 ? (cells[3].innerText || "").trim() : "",
          coeficiente: cells.length > 4 ? parseBR((cells[4].innerText || "").trim()) : 0,
          preco_unitario: parseBR(precoVal),
          total: cells.length > 6 ? parseBR((cells[6].innerText || "").trim()) : 0,
          consumo: cells.length > 7 ? parseBR((cells[7].innerText || "").trim()) : 0
        });
      }
      if (insumos.length > 0) break;
    }

    return { codigo: codigo, descricao: descricao, unidade: unidade, regiao: regiao, data_precos: dataPrecos, ls_percentual: ls, bdi_percentual: bdi, custo_sem_taxas: semTaxas, custo_com_taxas: comTaxas, insumos: insumos };
  })()`;
  return page.evaluate(EXTRACT_SCRIPT) as Promise<Omit<Composicao, "categoria" | "search_term"> | null>;
}

async function clickResultByCode(page: Page, code: string): Promise<boolean> {
  try {
    const link = page.locator("a", { hasText: code }).first();
    const count = await link.count();
    if (count === 0) return false;
    await link.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
    return true;
  } catch {
    return false;
  }
}

async function processSearchTerm(page: Page, term: string, cat: string): Promise<void> {
  if (completedSearches.includes(term)) {
    console.log(`⏭️  Skipping "${term}" (already done)`);
    return;
  }

  console.log(`\n🔍 Searching: "${term}" (${cat})`);
  const codes = await search(page, term);

  if (codes.length === 0) {
    completedSearches.push(term);
    saveState();
    return;
  }

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (allComposicoes.some((c) => c.codigo === code)) {
      console.log(`  ⏭️  ${code} (already have)`);
      continue;
    }

    const clicked = await clickResultByCode(page, code);
    if (!clicked) {
      console.log(`  ❌ Could not click: ${code}`);
      continue;
    }

    const detail = await extractDetail(page);
    if (detail && detail.codigo) {
      const comp: Composicao = { ...detail, categoria: cat, search_term: term };
      allComposicoes.push(comp);
      console.log(`  ✅ ${detail.codigo} — ${detail.descricao.substring(0, 60)}... (${detail.insumos.length} ins, R$${detail.custo_sem_taxas})`);
    } else {
      console.log(`  ⚠️  No detail extracted for result ${i}`);
    }

    // Re-search to get back to results list
    await goToSearch(page);
    await page.fill('#ctl00_MainContent_txtBusca', term);
    await page.click('#ctl00_MainContent_imgBtnPesquisaServico');
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);

    if (page.url().includes("home.aspx")) {
      console.log("  Session expired — re-logging in...");
      await login(page);
      await goToSearch(page);
      await page.fill('#ctl00_MainContent_txtBusca', term);
      await page.click('#ctl00_MainContent_imgBtnPesquisaServico');
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(2000);
    }
  }

  completedSearches.push(term);
  saveState();
  console.log(`  💾 Saved (total: ${allComposicoes.length} composições)`);
}

async function main(): Promise<void> {
  loadState();

  console.log("🚀 TCPO Scraper — Demolições");
  console.log(`${SEARCH_TERMS.length} search terms, output: ${OUTPUT_FILE}\n`);

  const browser = await chromium.launch({
    headless: true,
    slowMo: 100,
  });

  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    await login(page);
    await goToSearch(page);

    for (const { term, cat } of SEARCH_TERMS) {
      try {
        await processSearchTerm(page, term, cat);
      } catch (err) {
        console.error(`❌ Error on "${term}":`, (err as Error).message);
        await goToSearch(page).catch(() => {});
      }
    }

    saveState();
    console.log(`\n🏁 Done! ${allComposicoes.length} composições de demolição scraped`);
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
