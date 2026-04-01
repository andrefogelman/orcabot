import type { Database } from "./database";

export type OrcamentoItem = Database["public"]["Tables"]["orcamento_items"]["Row"];
export type OrcamentoInsert = Database["public"]["Tables"]["orcamento_items"]["Insert"];
export type OrcamentoUpdate = Database["public"]["Tables"]["orcamento_items"]["Update"];

export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type ProjectInsert = Database["public"]["Tables"]["projects"]["Insert"];
export type ProjectUpdate = Database["public"]["Tables"]["projects"]["Update"];

export type ProjectFile = Database["public"]["Tables"]["project_files"]["Row"];
export type PdfPage = Database["public"]["Tables"]["pdf_pages"]["Row"];
export type PdfJob = Database["public"]["Tables"]["pdf_jobs"]["Row"];
export type Quantitativo = Database["public"]["Tables"]["quantitativos"]["Row"];
export type AgentConversation = Database["public"]["Tables"]["agent_conversations"]["Row"];
export type AgentActivityLog = Database["public"]["Tables"]["agent_activity_log"]["Row"];
export type SinapiComposicao = Database["public"]["Tables"]["sinapi_composicoes"]["Row"];

/** Hierarchical budget item for the spreadsheet view */
export interface BudgetRow {
  item: OrcamentoItem;
  children: BudgetRow[];
  isExpanded: boolean;
}

/** Computed subtotals for a level-1 macro-etapa */
export interface MacroEtapaSubtotal {
  eap_code: string;
  descricao: string;
  custo_material: number;
  custo_mao_obra: number;
  custo_total: number;
  adm_total: number;
}

/** Footer totals for the entire budget */
export interface BudgetFooterTotals {
  custo_direto_total: number;
  administracao_total: number;
  impostos: number;
  preco_total_obra: number;
}

/** Curva ABC entry */
export interface CurvaAbcEntry {
  item: OrcamentoItem;
  peso_percentual: number;
  peso_acumulado: number;
  classe: "A" | "B" | "C";
}

/** New project form data */
export interface NewProjectForm {
  name: string;
  tipo_obra: string;
  area_total_m2: number | null;
  uf: string;
  cidade: string;
  adm_percentual_padrao: number;
  data_base_sinapi: string;
}
