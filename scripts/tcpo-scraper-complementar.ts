#!/usr/bin/env npx tsx
/**
 * TCPO Scraper — Complementar
 *
 * Termos adicionais para preencher lacunas nas categorias com baixa cobertura.
 * Reutiliza a mesma lógica do scraper principal.
 *
 * Usage: cd ~/orcabot && npx tsx scripts/tcpo-scraper-complementar.ts
 * Output: scripts/tcpo-output/tcpo-complementar.json
 */

import { chromium, type Page } from "playwright";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOME_URL = "https://tcpoweb.pini.com.br/home/home.aspx";
const TREE_URL = "https://tcpoweb.pini.com.br/PesqServicosTreeView.aspx";
const EMAIL = "andre@anf.com.br";
const PASSWORD = "andre@anf";

const OUTPUT_DIR = join(import.meta.dirname || ".", "tcpo-output");
const OUTPUT_FILE = join(OUTPUT_DIR, "tcpo-complementar.json");
const CHECKPOINT_FILE = join(OUTPUT_DIR, "tcpo-complementar-checkpoint.json");

// Also load existing compositions to avoid re-scraping
const MAIN_FILE = join(OUTPUT_DIR, "tcpo-composicoes.json");
const DEMO_FILE = join(OUTPUT_DIR, "tcpo-demolicoes.json");

const SEARCH_TERMS = [
  // 15. Prev. Incêndio (only 8 items)
  { term: "porta corta fogo", cat: "15. Prev. Incêndio" },
  { term: "alarme incendio", cat: "15. Prev. Incêndio" },
  { term: "detector fumaca", cat: "15. Prev. Incêndio" },
  { term: "central incendio", cat: "15. Prev. Incêndio" },
  { term: "mangueira incendio", cat: "15. Prev. Incêndio" },
  { term: "sinalizacao emergencia", cat: "15. Prev. Incêndio" },
  { term: "iluminacao emergencia", cat: "15. Prev. Incêndio" },
  { term: "tubo incendio", cat: "15. Prev. Incêndio" },

  // 19. Ar Condicionado (only 4 items)
  { term: "split", cat: "19. Ar Condicionado" },
  { term: "fan coil", cat: "19. Ar Condicionado" },
  { term: "duto flexivel", cat: "19. Ar Condicionado" },
  { term: "damper", cat: "19. Ar Condicionado" },
  { term: "exaustor", cat: "19. Ar Condicionado" },
  { term: "ventilacao", cat: "19. Ar Condicionado" },
  { term: "condensadora", cat: "19. Ar Condicionado" },
  { term: "evaporadora", cat: "19. Ar Condicionado" },

  // 22. Pisos (28 items — missing types)
  { term: "granito piso", cat: "22. Pisos" },
  { term: "marmore piso", cat: "22. Pisos" },
  { term: "piso epoxi", cat: "22. Pisos" },
  { term: "piso industrial", cat: "22. Pisos" },
  { term: "soleira", cat: "22. Pisos" },
  { term: "peitoril", cat: "22. Pisos" },
  { term: "piso borracha", cat: "22. Pisos" },
  { term: "piso carpete", cat: "22. Pisos" },
  { term: "piso pedra", cat: "22. Pisos" },
  { term: "piso cimentado", cat: "22. Pisos" },
  { term: "piso tatil", cat: "22. Pisos" },

  // 24. Pinturas (30 items — missing types)
  { term: "selador", cat: "24. Pinturas" },
  { term: "fundo preparador", cat: "24. Pinturas" },
  { term: "tinta epoxi", cat: "24. Pinturas" },
  { term: "stain madeira", cat: "24. Pinturas" },
  { term: "pintura piso", cat: "24. Pinturas" },
  { term: "pintura fachada", cat: "24. Pinturas" },
  { term: "demarcacao vaga", cat: "24. Pinturas" },
  { term: "tinta antiferruginosa", cat: "24. Pinturas" },
  { term: "fundo anticorrosivo", cat: "24. Pinturas" },

  // 10. Impermeabilização (32 items)
  { term: "cristalizacao", cat: "10. Impermeabilização" },
  { term: "injecao concreto", cat: "10. Impermeabilização" },
  { term: "membrana poliuretano", cat: "10. Impermeabilização" },
  { term: "membrana acrilica", cat: "10. Impermeabilização" },
  { term: "emulsao asfaltica", cat: "10. Impermeabilização" },
  { term: "junta dilatacao", cat: "10. Impermeabilização" },

  // 23. Rev. Paredes (34 items)
  { term: "granilite", cat: "23. Rev. Paredes" },
  { term: "marmore parede", cat: "23. Rev. Paredes" },
  { term: "granito parede", cat: "23. Rev. Paredes" },
  { term: "porcelanato parede", cat: "23. Rev. Paredes" },
  { term: "pedra parede", cat: "23. Rev. Paredes" },
  { term: "lambri", cat: "23. Rev. Paredes" },

  // 30. Urbanização (18 items)
  { term: "drenagem", cat: "30. Urbanização" },
  { term: "boca de lobo", cat: "30. Urbanização" },
  { term: "caixa inspecao", cat: "30. Urbanização" },
  { term: "paisagismo", cat: "30. Urbanização" },
  { term: "grama", cat: "30. Urbanização" },
  { term: "arvore", cat: "30. Urbanização" },
  { term: "poste", cat: "30. Urbanização" },
  { term: "sarjeta", cat: "30. Urbanização" },
  { term: "guia concreto", cat: "30. Urbanização" },
  { term: "piso intertravado", cat: "30. Urbanização" },
  { term: "bloco concreto piso", cat: "30. Urbanização" },
  { term: "iluminacao publica", cat: "30. Urbanização" },

  // 21. Forros (15 items)
  { term: "drywall", cat: "21. Forros" },
  { term: "gesso acartonado", cat: "21. Forros" },
  { term: "forro fibra mineral", cat: "21. Forros" },
  { term: "forro metalico", cat: "21. Forros" },
  { term: "forro acustico", cat: "21. Forros" },
  { term: "tabica", cat: "21. Forros" },
  { term: "sanca", cat: "21. Forros" },

  // 13. Sist. Hidráulicos (complementar)
  { term: "tubo cobre", cat: "13. Sist. Hidráulicos" },
  { term: "tubo ppr", cat: "13. Sist. Hidráulicos" },
  { term: "aquecedor", cat: "13. Sist. Hidráulicos" },
  { term: "bomba agua", cat: "13. Sist. Hidráulicos" },
  { term: "pressurizador", cat: "13. Sist. Hidráulicos" },
  { term: "fossa septica", cat: "13. Sist. Hidráulicos" },
  { term: "caixa gordura", cat: "13. Sist. Hidráulicos" },
  { term: "tubo ferro fundido", cat: "13. Sist. Hidráulicos" },
  { term: "valvula retencao", cat: "13. Sist. Hidráulicos" },
  { term: "cavalete agua", cat: "13. Sist. Hidráulicos" },

  // 16. Sist. Elétricos (complementar)
  { term: "para raios", cat: "16. Sist. Elétricos" },
  { term: "aterramento", cat: "16. Sist. Elétricos" },
  { term: "spda", cat: "16. Sist. Elétricos" },
  { term: "nobreak", cat: "16. Sist. Elétricos" },
  { term: "gerador", cat: "16. Sist. Elétricos" },
  { term: "transformador", cat: "16. Sist. Elétricos" },
  { term: "eletrocalha", cat: "16. Sist. Elétricos" },
  { term: "perfilado", cat: "16. Sist. Elétricos" },
  { term: "cabo telefone", cat: "16. Sist. Elétricos" },
  { term: "interfone", cat: "16. Sist. Elétricos" },
  { term: "cftv", cat: "16. Sist. Elétricos" },

  // 12. Esquadrias (complementar)
  { term: "portao", cat: "12. Esquadrias" },
  { term: "porta vidro", cat: "12. Esquadrias" },
  { term: "persiana", cat: "12. Esquadrias" },
  { term: "porta acustica", cat: "12. Esquadrias" },
  { term: "porta pivotante", cat: "12. Esquadrias" },
  { term: "guarda corpo", cat: "12. Esquadrias" },
  { term: "corrimao", cat: "12. Esquadrias" },
  { term: "grade", cat: "12. Esquadrias" },

  // 20. Revestimentos (complementar)
  { term: "argamassa projetada", cat: "20. Revestimentos" },
  { term: "gesso liso", cat: "20. Revestimentos" },
  { term: "gesso projetado", cat: "20. Revestimentos" },
  { term: "argamassa colante", cat: "20. Revestimentos" },
  { term: "rejunte", cat: "20. Revestimentos" },

  // 26. Louças e Metais (complementar)
  { term: "bancada", cat: "26. Louças e Metais" },
  { term: "acessorio banheiro", cat: "26. Louças e Metais" },
  { term: "papeleira", cat: "26. Louças e Metais" },
  { term: "saboneteira", cat: "26. Louças e Metais" },
  { term: "mictorio", cat: "26. Louças e Metais" },
  { term: "bide", cat: "26. Louças e Metais" },
  { term: "cuba", cat: "26. Louças e Metais" },

  // 02. Serviços Iniciais (complementar)
  { term: "tapume", cat: "02. Serviços Iniciais" },
  { term: "container obra", cat: "02. Serviços Iniciais" },
  { term: "baracao obra", cat: "02. Serviços Iniciais" },
  { term: "placa obra", cat: "02. Serviços Iniciais" },
  { term: "protecao periferia", cat: "02. Serviços Iniciais" },
  { term: "bandeja protecao", cat: "02. Serviços Iniciais" },
  { term: "tela protecao", cat: "02. Serviços Iniciais" },

  // 04. Infraestrutura (complementar)
  { term: "tubulao", cat: "04. Infraestrutura" },
  { term: "helice continua", cat: "04. Infraestrutura" },
  { term: "estaca raiz", cat: "04. Infraestrutura" },
  { term: "estaca pre moldada", cat: "04. Infraestrutura" },
  { term: "cortina contenção", cat: "04. Infraestrutura" },
  { term: "muro arrimo", cat: "04. Infraestrutura" },
  { term: "tirante", cat: "04. Infraestrutura" },

  // 05. Superestrutura (complementar)
  { term: "escada concreto", cat: "05. Superestrutura" },
  { term: "concreto protendido", cat: "05. Superestrutura" },
  { term: "estrutura metalica", cat: "05. Superestrutura" },
  { term: "laje protendida", cat: "05. Superestrutura" },
  { term: "concreto bombeado", cat: "05. Superestrutura" },
  { term: "pre moldado concreto", cat: "05. Superestrutura" },

  // 06. Alvenarias (complementar)
  { term: "bloco concreto", cat: "06. Alvenarias" },
  { term: "verga", cat: "06. Alvenarias" },
  { term: "contraverga", cat: "06. Alvenarias" },
  { term: "encunhamento", cat: "06. Alvenarias" },
  { term: "churrasqueira alvenaria", cat: "06. Alvenarias" },

  // 09. Coberturas (complementar)
  { term: "telha galvanizada", cat: "09. Coberturas" },
  { term: "telha termoacustica", cat: "09. Coberturas" },
  { term: "telha policarbonato", cat: "09. Coberturas" },
  { term: "rufo", cat: "09. Coberturas" },
  { term: "condutor pluvial", cat: "09. Coberturas" },

  // 27. Vidros (complementar)
  { term: "box banheiro", cat: "27. Vidros" },
  { term: "vidro comum", cat: "27. Vidros" },
  { term: "vidro duplo", cat: "27. Vidros" },
  { term: "claraboia", cat: "27. Vidros" },
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
let existingCodes: Set<string> = new Set();

function loadState(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  if (existsSync(OUTPUT_FILE)) {
    allComposicoes = JSON.parse(readFileSync(OUTPUT_FILE, "utf-8"));
  }
  if (existsSync(CHECKPOINT_FILE)) {
    completedSearches = JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  // Load existing codes from main + demo files to skip duplicates
  if (existsSync(MAIN_FILE)) {
    const main: Composicao[] = JSON.parse(readFileSync(MAIN_FILE, "utf-8"));
    main.forEach((c) => existingCodes.add(c.codigo));
  }
  if (existsSync(DEMO_FILE)) {
    const demo: Composicao[] = JSON.parse(readFileSync(DEMO_FILE, "utf-8"));
    demo.forEach((c) => existingCodes.add(c.codigo));
  }
  allComposicoes.forEach((c) => existingCodes.add(c.codigo));
  console.log(`Loaded: ${allComposicoes.length} new composições, ${completedSearches.length} searches done, ${existingCodes.size} existing codes to skip`);
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
    // Skip if already scraped (in any file)
    if (existingCodes.has(code)) {
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
      existingCodes.add(detail.codigo);
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
  console.log(`  💾 Saved (total: ${allComposicoes.length} novas composições)`);
}

async function main(): Promise<void> {
  loadState();

  console.log("🚀 TCPO Scraper — Complementar");
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
    console.log(`\n🏁 Done! ${allComposicoes.length} novas composições scraped`);
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
