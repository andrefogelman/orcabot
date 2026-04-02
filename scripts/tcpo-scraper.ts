#!/usr/bin/env npx tsx
/**
 * TCPO Scraper v2 — Uses search instead of tree navigation
 *
 * Strategy: search for terms related to each category, collect results,
 * click into each composition to extract details + insumos.
 *
 * Usage: cd ~/orcabot && npx tsx scripts/tcpo-scraper.ts
 * Output: scripts/tcpo-output/tcpo-composicoes.json
 */

import { chromium, type Page } from "playwright";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOME_URL = "https://tcpoweb.pini.com.br/home/home.aspx";
const TREE_URL = "https://tcpoweb.pini.com.br/PesqServicosTreeView.aspx";
const EMAIL = "andre@anf.com.br";
const PASSWORD = "andre@anf";

const OUTPUT_DIR = join(import.meta.dirname || ".", "tcpo-output");
const OUTPUT_FILE = join(OUTPUT_DIR, "tcpo-composicoes.json");
const CHECKPOINT_FILE = join(OUTPUT_DIR, "tcpo-checkpoint.json");

const SEARCH_TERMS = [
  { term: "alvenaria", cat: "06. Alvenarias" },
  { term: "bloco ceramico", cat: "06. Alvenarias" },
  { term: "divisoria", cat: "06. Alvenarias" },
  { term: "chapisco", cat: "20. Revestimentos" },
  { term: "emboco", cat: "20. Revestimentos" },
  { term: "reboco", cat: "20. Revestimentos" },
  { term: "massa corrida", cat: "20. Revestimentos" },
  { term: "forro gesso", cat: "21. Forros" },
  { term: "forro pvc", cat: "21. Forros" },
  { term: "forro madeira", cat: "21. Forros" },
  { term: "forro mineral", cat: "21. Forros" },
  { term: "piso ceramico", cat: "22. Pisos" },
  { term: "porcelanato", cat: "22. Pisos" },
  { term: "contrapiso", cat: "22. Pisos" },
  { term: "piso laminado", cat: "22. Pisos" },
  { term: "piso vinilico", cat: "22. Pisos" },
  { term: "rodape", cat: "22. Pisos" },
  { term: "azulejo", cat: "23. Rev. Paredes" },
  { term: "revestimento ceramico", cat: "23. Rev. Paredes" },
  { term: "pastilha", cat: "23. Rev. Paredes" },
  { term: "pintura latex", cat: "24. Pinturas" },
  { term: "pintura acrilica", cat: "24. Pinturas" },
  { term: "pintura esmalte", cat: "24. Pinturas" },
  { term: "textura parede", cat: "24. Pinturas" },
  { term: "verniz", cat: "24. Pinturas" },
  { term: "massa pva", cat: "24. Pinturas" },
];

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
  await page.goto(HOME_URL, { waitUntil: "networkidle", timeout: 20000 });

  // Check if already on authenticated page
  const hasSair = await page.$('a[href*="Logout"]');
  if (hasSair) {
    console.log("Already logged in");
    return;
  }

  // First, force logout any existing session by hitting logout URL
  await page.goto("https://tcpoweb.pini.com.br/Logout.aspx", { waitUntil: "networkidle", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Now go to home and login fresh
  await page.goto(HOME_URL, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(1000);

  await page.fill("#ctl00_header1_txtUsuario", EMAIL);
  await page.fill("#ctl00_header1_txtSenha", PASSWORD);
  await page.click("#ctl00_header1_btnAcessar");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  // Check for "session already active" dialog — wait longer and retry
  const aviso = await page.$("text=Acesso negado");
  if (aviso) {
    console.log("Session conflict — waiting 60s for old session to expire...");
    await page.screenshot({ path: join(OUTPUT_DIR, "debug-conflict.png") });
    await page.click("text=OK").catch(() => {});
    await page.waitForTimeout(60000); // Wait 1 full minute
    // Navigate completely fresh
    await page.goto(HOME_URL, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.fill("#ctl00_header1_txtUsuario", EMAIL);
    await page.fill("#ctl00_header1_txtSenha", PASSWORD);
    await page.click("#ctl00_header1_btnAcessar");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(OUTPUT_DIR, "debug-after-retry.png") });

    // Second conflict check
    const aviso2 = await page.$("text=Acesso negado");
    if (aviso2) {
      console.log("Still conflicting — waiting another 60s...");
      await page.click("text=OK").catch(() => {});
      await page.waitForTimeout(60000);
      await page.goto(HOME_URL, { waitUntil: "networkidle", timeout: 20000 });
      await page.fill("#ctl00_header1_txtUsuario", EMAIL);
      await page.fill("#ctl00_header1_txtSenha", PASSWORD);
      await page.click("#ctl00_header1_btnAcessar");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(3000);
    }
  }

  // Verify we're actually logged in by checking for "Sair" link
  const loggedIn = await page.$('a[href*="Logout"]');
  if (!loggedIn) {
    // May still be on home — check if URL went to Menu
    if (page.url().includes("Menu.aspx")) {
      console.log("Login successful (on Menu)");
    } else {
      throw new Error("Login failed — no Sair link and not on Menu.aspx");
    }
  }

  // Navigate to compositions tree view
  // Try direct navigation first
  await page.goto(TREE_URL, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  if (!page.url().includes("PesqServicos")) {
    // Direct nav failed — go via Menu
    console.log("Direct nav to tree failed, going via Menu...");
    await page.goto("https://tcpoweb.pini.com.br/Menu.aspx", { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1000);
    // Click "Composições e preços" link
    const compLink = await page.$('a[href*="PesqServicosTreeView"]');
    if (compLink) {
      await compLink.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);
    } else {
      throw new Error("Could not find link to PesqServicosTreeView on Menu page");
    }
  }

  // Final verify — must be on tree page
  if (!page.url().includes("PesqServicos")) {
    throw new Error(`Not on tree page after login. URL: ${page.url()}`);
  }

  console.log(`✅ Logged in and on tree: ${page.url()}`);
}

async function goToSearch(page: Page): Promise<void> {
  if (!page.url().includes("PesqServicosTreeView")) {
    await page.goto(TREE_URL, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(1000);
  }
  // Switch base to TCPO PINI
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

  // Fill search box and submit
  const searchInput = await page.$('input[id*="txtBuscaGeral"], input[placeholder*="Digite"]');
  if (!searchInput) throw new Error("Search input not found");

  await searchInput.fill(term);
  await page.click('input[id*="imgBtBuscaGeral"], input[type="image"][title*="Buscar"]');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  // Extract all composition codes from search results
  const codes = await page.evaluate(() => {
    const results: string[] = [];
    // Search results appear in a table with links
    const links = document.querySelectorAll("a");
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const text = (link as HTMLElement).innerText?.trim() || "";
      // Composition codes look like: 3R 05 12 00 00 00 05 27 or similar
      if (text.match(/^\d+[A-Z]?\s*[\.\s]\s*\d+/) && href.includes("__doPostBack")) {
        results.push(text);
      }
    }
    return results;
  });

  console.log(`  Search "${term}": ${codes.length} results`);
  return codes;
}

async function extractDetail(page: Page): Promise<Omit<Composicao, "categoria" | "search_term"> | null> {
  return page.evaluate(() => {
    const body = document.body.innerText;

    // Must be on a composition detail page
    if (!body.includes("Código:") || !body.includes("Composição")) return null;

    // Parse header block
    const headerBlock = document.querySelector('[id*="pnlServico"], [id*="pnlComposicao"]')?.parentElement;
    const headerText = headerBlock?.innerText || body.substring(0, 2000);

    const codigoMatch = headerText.match(/Código:\s*([\w\.]+)/);
    const unidadeMatch = headerText.match(/Unidade:\s*(\S+)/);
    const descLines = headerText.match(/Descrição:\s*(.+)/);

    const codigo = codigoMatch?.[1] || "";
    const unidade = unidadeMatch?.[1] || "";

    let descricao = descLines?.[1]?.trim() || "";
    if (!descricao) {
      // Try second line of header
      const lines = headerText.split("\n").map((l: string) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.length > 20 && !line.startsWith("Código") && !line.startsWith("Voltar")) {
          descricao = line;
          break;
        }
      }
    }

    if (!codigo) return null;

    // Region & date
    const regiaoEl = document.querySelector('select[id*="ddlRegiao"]') as HTMLSelectElement;
    const regiao = regiaoEl?.selectedOptions?.[0]?.text || "São Paulo";
    const dataEl = document.querySelector('select[id*="ddlDataPrecos"]') as HTMLSelectElement;
    const dataPrecos = dataEl?.selectedOptions?.[0]?.text || "";

    // Taxes
    const lsEl = document.querySelector('input[id*="txtLS"]') as HTMLInputElement;
    const bdiEl = document.querySelector('input[id*="txtBDI"]') as HTMLInputElement;
    const ls = parseFloat(lsEl?.value?.replace(",", ".") || "0");
    const bdi = parseFloat(bdiEl?.value?.replace(",", ".") || "0");

    // Totals — look for "Sem taxas:" and "Com taxas:" anywhere
    const parseBR = (s: string) => {
      if (!s) return 0;
      return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
    };
    const semMatch = body.match(/Sem taxas:\s*([\d\.,]+)/);
    const comMatch = body.match(/Com taxas:\s*([\d\.,]+)/);
    const semTaxas = parseBR(semMatch?.[1] || "");
    const comTaxas = parseBR(comMatch?.[1] || "");

    // Insumos table — find the table with columns Código | Descrição | Un | Class | Coef | Preço
    const insumos: {
      codigo: string; descricao: string; unidade: string; classe: string;
      coeficiente: number; preco_unitario: number; total: number; consumo: number;
    }[] = [];

    const tables = document.querySelectorAll("table");
    for (const table of tables) {
      const firstRow = table.querySelector("tr");
      const headerText = firstRow?.innerText || "";
      if (headerText.includes("Código") && headerText.includes("Descrição") && (headerText.includes("Coef") || headerText.includes("Class"))) {
        // This is the insumos table
        const rows = table.querySelectorAll("tr");
        for (let i = 1; i < rows.length; i++) {
          const cells = rows[i].querySelectorAll("td");
          if (cells.length < 6) continue;
          const cod = cells[0]?.innerText?.trim() || "";
          if (!cod || !cod.match(/\d/)) continue; // skip non-data rows

          // Handle variable column layouts
          // Common: Código | Descrição | Un | Class | Coef | Preço unitário | Total | Consumo
          const desc = cells[1]?.innerText?.trim() || "";
          const un = cells[2]?.innerText?.trim() || "";
          const classe = cells[3]?.innerText?.trim() || "";
          const coef = parseBR(cells[4]?.innerText?.trim() || "");

          // Preço might be in an input field (editable)
          const precoCell = cells[5];
          const precoInput = precoCell?.querySelector("input") as HTMLInputElement;
          const preco = precoInput ? parseBR(precoInput.value) : parseBR(precoCell?.innerText?.trim() || "");

          const totalVal = cells.length > 6 ? parseBR(cells[6]?.innerText?.trim() || "") : 0;
          const consumo = cells.length > 7 ? parseBR(cells[7]?.innerText?.trim() || "") : 0;

          insumos.push({ codigo: cod, descricao: desc, unidade: un, classe, coeficiente: coef, preco_unitario: preco, total: totalVal, consumo });
        }
        break; // found the table
      }
    }

    return {
      codigo, descricao, unidade, regiao, data_precos: dataPrecos,
      ls_percentual: ls, bdi_percentual: bdi,
      custo_sem_taxas: semTaxas, custo_com_taxas: comTaxas, insumos,
    };
  });
}

async function clickResultByIndex(page: Page, index: number): Promise<boolean> {
  // Click the Nth result link in the search results grid
  const clicked = await page.evaluate((idx) => {
    // Find all links that look like composition codes in the results table
    const allLinks: HTMLAnchorElement[] = [];
    document.querySelectorAll("td a").forEach((a) => {
      const text = (a as HTMLElement).innerText?.trim() || "";
      if (text.match(/^\d+[A-Z]?\s*[\.\s]\s*\d+/)) {
        allLinks.push(a as HTMLAnchorElement);
      }
    });
    if (idx < allLinks.length) {
      allLinks[idx].click();
      return true;
    }
    return false;
  }, index);

  if (clicked) {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
  }
  return clicked;
}

async function goBackFromDetail(page: Page): Promise<void> {
  // Click the orange "Voltar para:" bar or browser back
  const clicked = await page.evaluate(() => {
    // Try clicking any element containing "Voltar para"
    const all = document.querySelectorAll("a, span, td");
    for (const el of all) {
      if ((el as HTMLElement).innerText?.includes("Voltar para")) {
        (el as HTMLElement).click();
        return true;
      }
    }
    return false;
  });

  if (clicked) {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
  } else {
    await page.goBack({ waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1500);
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

  // Process each result
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    // Skip if already scraped
    if (allComposicoes.some((c) => c.codigo === code.replace(/\s+/g, "."))) {
      console.log(`  ⏭️  ${code} (already have)`);
      continue;
    }

    const clicked = await clickResultByIndex(page, i);
    if (!clicked) {
      console.log(`  ❌ Could not click result ${i}: ${code}`);
      continue;
    }

    const detail = await extractDetail(page);
    if (detail && detail.codigo) {
      const comp: Composicao = { ...detail, categoria: cat, search_term: term };
      allComposicoes.push(comp);
      console.log(`  ✅ ${detail.codigo} — ${detail.descricao.substring(0, 50)}... (${detail.insumos.length} ins, R$${detail.custo_sem_taxas})`);
    } else {
      console.log(`  ⚠️  No detail extracted for result ${i}`);
    }

    await goBackFromDetail(page);
  }

  completedSearches.push(term);
  saveState();
  console.log(`  💾 Saved (total: ${allComposicoes.length} composições)`);
}

async function main(): Promise<void> {
  loadState();

  console.log("🚀 TCPO Scraper v2 (search-based)");
  console.log(`${SEARCH_TERMS.length} search terms, output: ${OUTPUT_FILE}\n`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300,
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
        // Try to recover
        await goToSearch(page).catch(() => {});
      }
    }

    saveState();
    console.log(`\n🏁 Done! ${allComposicoes.length} composições scraped`);
  } catch (err) {
    console.error("Fatal:", err);
    saveState();
  } finally {
    await browser.close();
  }
}

main();
