import type { OrcamentoItem } from "@/types/orcamento";

export type EapLevel = 1 | 2 | 3;

export type InsertOperation = {
  kind: "insert";
  level: EapLevel;
  /** Prefixo do pai — '' para level 1, '01' para level 2, '01.02' para level 3 */
  parentPrefix: string;
  /** 1-based: se já existe item com esse last-segment, ele é empurrado */
  atPosition: number;
};

export type DeleteOperation = {
  kind: "delete";
  /** eap_code completo do item deletado */
  deletedCode: string;
  level: EapLevel;
};

export type EapPatch = { id: string; eap_code: string };

/** Padding do último segmento por nível (level 3 é 3 dígitos, demais 2). */
export function padLengthForLevel(level: EapLevel): number {
  return level === 3 ? 3 : 2;
}

/** Formata um eap_code a partir de prefixo pai + número + nível. */
export function formatEapCode(parentPrefix: string, lastSegment: number, level: EapLevel): string {
  const pad = padLengthForLevel(level);
  const padded = String(lastSegment).padStart(pad, "0");
  return parentPrefix ? `${parentPrefix}.${padded}` : padded;
}

/**
 * Extrai o último segmento numérico de um eap_code.
 * Ex: "03" → 3, "01.02" → 2, "01.02.003" → 3
 */
export function lastSegmentOf(eapCode: string): number {
  const parts = eapCode.split(".");
  return parseInt(parts[parts.length - 1], 10);
}

export function computeRenumberPatch(
  items: OrcamentoItem[],
  operation: InsertOperation | DeleteOperation
): EapPatch[] {
  if (operation.kind === "insert") {
    return computeInsertPatch(items, operation);
  }
  return computeDeletePatch(items, operation);
}

function computeInsertPatch(items: OrcamentoItem[], op: InsertOperation): EapPatch[] {
  // Identificar irmãos do mesmo nível sob o mesmo pai
  const siblings = items.filter((i) => {
    if (i.eap_level !== op.level) return false;
    if (op.level === 1) return true;
    return i.eap_code.startsWith(op.parentPrefix + ".");
  });

  // Irmãos a renumerar: aqueles com last-segment >= atPosition
  const toShift = siblings.filter((s) => lastSegmentOf(s.eap_code) >= op.atPosition);
  if (toShift.length === 0) return [];

  const patch: EapPatch[] = [];

  for (const sibling of toShift) {
    const oldLast = lastSegmentOf(sibling.eap_code);
    const newLast = oldLast + 1;
    const newCode = formatEapCode(op.parentPrefix, newLast, op.level);
    patch.push({ id: sibling.id, eap_code: newCode });

    // Cascatear para todos os descendentes desse irmão
    const oldPrefix = sibling.eap_code;
    const newPrefix = newCode;
    for (const desc of items) {
      if (desc.eap_code.startsWith(oldPrefix + ".")) {
        const suffix = desc.eap_code.slice(oldPrefix.length);
        patch.push({ id: desc.id, eap_code: newPrefix + suffix });
      }
    }
  }

  return patch;
}

function computeDeletePatch(items: OrcamentoItem[], op: DeleteOperation): EapPatch[] {
  // Derive parentPrefix from deletedCode
  const parts = op.deletedCode.split(".");
  const parentPrefix = parts.slice(0, -1).join(".");
  const deletedLastSegment = parseInt(parts[parts.length - 1], 10);

  // Same-level siblings under same parent (excluding the deleted item itself)
  const siblings = items.filter((i) => {
    if (i.eap_level !== op.level) return false;
    if (i.eap_code === op.deletedCode) return false;
    if (op.level === 1) return true;
    return i.eap_code.startsWith(parentPrefix + ".");
  });

  // Siblings with last-segment > deletedLastSegment need shift -1
  const toShift = siblings.filter((s) => lastSegmentOf(s.eap_code) > deletedLastSegment);
  if (toShift.length === 0) return [];

  const patch: EapPatch[] = [];

  for (const sibling of toShift) {
    const oldLast = lastSegmentOf(sibling.eap_code);
    const newLast = oldLast - 1;
    const newCode = formatEapCode(parentPrefix, newLast, op.level);
    patch.push({ id: sibling.id, eap_code: newCode });

    // Cascade to descendants
    const oldPrefix = sibling.eap_code;
    const newPrefix = newCode;
    for (const desc of items) {
      if (desc.eap_code.startsWith(oldPrefix + ".")) {
        const suffix = desc.eap_code.slice(oldPrefix.length);
        patch.push({ id: desc.id, eap_code: newPrefix + suffix });
      }
    }
  }

  return patch;
}

/**
 * Retorna um snapshot do estado atual (id → eap_code) dos items mencionados no patch.
 * Usado para undo: reverter um patch = reaplicá-lo com este snapshot.
 */
export function snapshotAffected(items: OrcamentoItem[], patch: EapPatch[]): EapPatch[] {
  const byId = new Map(items.map((i) => [i.id, i.eap_code]));
  const result: EapPatch[] = [];
  for (const p of patch) {
    const current = byId.get(p.id);
    if (current !== undefined) {
      result.push({ id: p.id, eap_code: current });
    }
  }
  return result;
}

export type InsertPositionOption = {
  /** unique key for React */
  id: string;
  /** text shown in the popover item */
  label: string;
  /** group heading for level 2/3 — e.g., "01 — Instalação" */
  group?: string;
  /** subgroup for level 3 — e.g., "01.02 — Revestimentos" */
  subgroup?: string;
  parentPrefix: string;
  atPosition: number;
  /** default highlighted entry */
  highlighted?: boolean;
};

/**
 * Generate the list of options for the "Onde inserir?" popover.
 * - Level 1: flat, "No início" + "Depois de X" + "No final" (highlighted)
 * - Level 2: grouped by etapa
 * - Level 3: grouped by etapa › item
 */
export function buildInsertPositionOptions(
  items: OrcamentoItem[],
  level: EapLevel
): InsertPositionOption[] {
  if (items.length === 0) return [];

  if (level === 1) {
    const etapas = items
      .filter((i) => i.eap_level === 1)
      .sort((a, b) => a.eap_code.localeCompare(b.eap_code));

    if (etapas.length === 0) return [];

    const options: InsertPositionOption[] = [
      { id: "start", label: "No início", parentPrefix: "", atPosition: 1 },
    ];
    for (const e of etapas) {
      const lastSeg = lastSegmentOf(e.eap_code);
      options.push({
        id: `after-${e.id}`,
        label: `Depois de ${e.eap_code} — ${e.descricao}`,
        parentPrefix: "",
        atPosition: lastSeg + 1,
      });
    }
    // The last "Depois de N" becomes "No final" + highlighted
    const last = options[options.length - 1];
    last.label = "No final";
    last.highlighted = true;
    last.id = "end";
    return options;
  }

  if (level === 2) {
    const etapas = items
      .filter((i) => i.eap_level === 1)
      .sort((a, b) => a.eap_code.localeCompare(b.eap_code));
    if (etapas.length === 0) return [];

    const options: InsertPositionOption[] = [];
    for (let eIdx = 0; eIdx < etapas.length; eIdx++) {
      const etapa = etapas[eIdx];
      const prefix = etapa.eap_code;
      const groupLabel = `${etapa.eap_code} — ${etapa.descricao}`;
      const children = items
        .filter((i) => i.eap_level === 2 && i.eap_code.startsWith(prefix + "."))
        .sort((a, b) => a.eap_code.localeCompare(b.eap_code));

      options.push({
        id: `start-${etapa.id}`,
        label: "No início da etapa",
        group: groupLabel,
        parentPrefix: prefix,
        atPosition: 1,
      });
      for (const c of children) {
        options.push({
          id: `after-${c.id}`,
          label: `Depois de ${c.eap_code} — ${c.descricao}`,
          group: groupLabel,
          parentPrefix: prefix,
          atPosition: lastSegmentOf(c.eap_code) + 1,
        });
      }
      if (children.length > 0) {
        const last = options[options.length - 1];
        last.label = "No final da etapa";
        last.id = `end-${etapa.id}`;
      }
      if (eIdx === etapas.length - 1) {
        options[options.length - 1].highlighted = true;
      }
    }
    return options;
  }

  // level === 3
  const etapas = items
    .filter((i) => i.eap_level === 1)
    .sort((a, b) => a.eap_code.localeCompare(b.eap_code));

  const options: InsertPositionOption[] = [];
  for (let eIdx = 0; eIdx < etapas.length; eIdx++) {
    const etapa = etapas[eIdx];
    const groupLabel = `${etapa.eap_code} — ${etapa.descricao}`;
    const items2 = items
      .filter((i) => i.eap_level === 2 && i.eap_code.startsWith(etapa.eap_code + "."))
      .sort((a, b) => a.eap_code.localeCompare(b.eap_code));

    for (let iIdx = 0; iIdx < items2.length; iIdx++) {
      const it2 = items2[iIdx];
      const subgroupLabel = `${it2.eap_code} — ${it2.descricao}`;
      const prefix = it2.eap_code;
      const children = items
        .filter((i) => i.eap_level === 3 && i.eap_code.startsWith(prefix + "."))
        .sort((a, b) => a.eap_code.localeCompare(b.eap_code));

      options.push({
        id: `start-${it2.id}`,
        label: "No início do item",
        group: groupLabel,
        subgroup: subgroupLabel,
        parentPrefix: prefix,
        atPosition: 1,
      });
      for (const c of children) {
        options.push({
          id: `after-${c.id}`,
          label: `Depois de ${c.eap_code} — ${c.descricao}`,
          group: groupLabel,
          subgroup: subgroupLabel,
          parentPrefix: prefix,
          atPosition: lastSegmentOf(c.eap_code) + 1,
        });
      }
      if (children.length > 0) {
        const last = options[options.length - 1];
        last.label = "No final do item";
        last.id = `end-${it2.id}`;
      }
      if (eIdx === etapas.length - 1 && iIdx === items2.length - 1) {
        options[options.length - 1].highlighted = true;
      }
    }
  }
  return options;
}
