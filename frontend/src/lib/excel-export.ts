import ExcelJS from "exceljs";
import type { OrcamentoItem, BudgetFooterTotals } from "@/types/orcamento";

/**
 * Export budget to Excel in ANF format with live formulas.
 */
export async function exportBudgetToExcel(
  items: OrcamentoItem[],
  footerTotals: BudgetFooterTotals,
  projectName: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OrcaBot";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Orçamento", {
    views: [{ state: "frozen", xSplit: 0, ySplit: 3 }],
  });

  sheet.columns = [
    { header: "Item", key: "item", width: 12 },
    { header: "Descrição", key: "descricao", width: 45 },
    { header: "Unid", key: "unidade", width: 8 },
    { header: "Qtde", key: "quantidade", width: 12 },
    { header: "Material", key: "material", width: 16 },
    { header: "Mão de Obra", key: "mao_obra", width: 16 },
    { header: "Custo Total", key: "custo_total", width: 16 },
    { header: "Adm%", key: "adm", width: 10 },
  ];

  // Title row
  sheet.mergeCells("A1:H1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = `Orçamento — ${projectName}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center" };

  // Date row
  sheet.mergeCells("A2:H2");
  const dateCell = sheet.getCell("A2");
  dateCell.value = `Gerado em ${new Date().toLocaleDateString("pt-BR")}`;
  dateCell.font = { italic: true, size: 10, color: { argb: "FF666666" } };
  dateCell.alignment = { horizontal: "center" };

  // Header row (row 3)
  const headerRow = sheet.getRow(3);
  headerRow.values = ["Item", "Descrição", "Unid", "Qtde", "Material", "Mão de Obra", "Custo Total", "Adm%"];
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E40AF" },
  };
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.height = 24;

  const currencyFormat = '#,##0.00;[Red]-#,##0.00';
  const percentFormat = '0.00"%"';

  // Data rows start at row 4
  const sortedItems = [...items].sort((a, b) => a.eap_code.localeCompare(b.eap_code));
  const DATA_START_ROW = 4;

  // Track which Excel rows belong to each eap_code (for level-1 SUM formulas)
  const eapToExcelRow = new Map<string, number>();

  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i];
    const excelRow = DATA_START_ROW + i;
    eapToExcelRow.set(item.eap_code, excelRow);

    const row = sheet.getRow(excelRow);
    row.getCell(1).value = item.eap_code;
    row.getCell(2).value = item.descricao;
    row.getCell(3).value = item.unidade ?? "";

    if (item.eap_level === 1) {
      // Level 1: Qtde empty, Material/MãoObra/CustoTotal = SUM of children
      row.getCell(4).value = null;
      // We'll set SUM formulas after all rows are placed
    } else {
      // Leaf items: static values for Qtde/Material/MãoObra, formula for CustoTotal
      row.getCell(4).value = item.quantidade ?? 0;
      row.getCell(5).value = item.custo_material ?? 0;
      row.getCell(6).value = item.custo_mao_obra ?? 0;
      // Custo Total = Material + Mão de Obra
      row.getCell(7).value = { formula: `E${excelRow}+F${excelRow}` } as any;
    }

    row.getCell(8).value = item.adm_percentual ?? 0;

    // Styling
    if (item.eap_level === 1) {
      row.font = { bold: true, size: 10 };
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFDBEAFE" },
      };
    } else if (item.eap_level === 3) {
      row.font = { size: 9, color: { argb: "FF666666" } };
      row.getCell(2).alignment = { indent: 2 };
    } else {
      row.font = { size: 10 };
    }

    // Number formats
    [5, 6, 7].forEach((col) => {
      row.getCell(col).numFmt = currencyFormat;
    });
    row.getCell(8).numFmt = percentFormat;
    row.getCell(4).numFmt = '#,##0.00';

    [4, 5, 6, 7, 8].forEach((col) => {
      row.getCell(col).alignment = { horizontal: "right" };
    });
  }

  // Now set SUM formulas for level-1 rows (sum their direct children)
  for (const item of sortedItems) {
    if (item.eap_level !== 1) continue;
    const parentRow = eapToExcelRow.get(item.eap_code)!;

    // Find children: items whose eap_code starts with this code + "."
    const childRows: number[] = [];
    for (const child of sortedItems) {
      if (child.eap_code.startsWith(item.eap_code + ".") && child.eap_level === 2) {
        const cr = eapToExcelRow.get(child.eap_code);
        if (cr) childRows.push(cr);
      }
    }

    if (childRows.length === 0) continue;

    // For level-1: sum all descendants (not just direct children) for Material, MãoObra, CustoTotal
    const descRows: number[] = [];
    for (const desc of sortedItems) {
      if (desc.eap_code.startsWith(item.eap_code + ".") && desc.id !== item.id) {
        const dr = eapToExcelRow.get(desc.eap_code);
        if (dr) descRows.push(dr);
      }
    }

    // Find leaf descendants only (items with no children)
    const leafRows: number[] = [];
    for (const desc of sortedItems) {
      if (!desc.eap_code.startsWith(item.eap_code + ".")) continue;
      const hasChildren = sortedItems.some(
        (other) => other.eap_code.startsWith(desc.eap_code + ".") && other.id !== desc.id
      );
      if (!hasChildren) {
        const dr = eapToExcelRow.get(desc.eap_code);
        if (dr) leafRows.push(dr);
      }
    }

    if (leafRows.length > 0) {
      // SUM of leaf Material, MãoObra, CustoTotal
      const sumRefs = (col: string) => leafRows.map((r) => `${col}${r}`).join(",");
      const row = sheet.getRow(parentRow);
      row.getCell(5).value = { formula: `SUM(${sumRefs("E")})` } as any;
      row.getCell(6).value = { formula: `SUM(${sumRefs("F")})` } as any;
      row.getCell(7).value = { formula: `SUM(${sumRefs("G")})` } as any;
    }
  }

  // Also set SUM formulas for level-2 rows that have level-3 children
  for (const item of sortedItems) {
    if (item.eap_level !== 2) continue;
    const hasChildren = sortedItems.some(
      (other) => other.eap_code.startsWith(item.eap_code + ".") && other.id !== item.id
    );
    if (!hasChildren) continue;

    const parentRow = eapToExcelRow.get(item.eap_code)!;
    const leafRows: number[] = [];
    for (const desc of sortedItems) {
      if (!desc.eap_code.startsWith(item.eap_code + ".")) continue;
      const descHasChildren = sortedItems.some(
        (other) => other.eap_code.startsWith(desc.eap_code + ".") && other.id !== desc.id
      );
      if (!descHasChildren) {
        const dr = eapToExcelRow.get(desc.eap_code);
        if (dr) leafRows.push(dr);
      }
    }

    if (leafRows.length > 0) {
      const sumRefs = (col: string) => leafRows.map((r) => `${col}${r}`).join(",");
      const row = sheet.getRow(parentRow);
      row.getCell(5).value = { formula: `SUM(${sumRefs("E")})` } as any;
      row.getCell(6).value = { formula: `SUM(${sumRefs("F")})` } as any;
      row.getCell(7).value = { formula: `SUM(${sumRefs("G")})` } as any;
    }
  }

  const DATA_END_ROW = DATA_START_ROW + sortedItems.length - 1;

  // Empty separator row
  const sepRow = DATA_END_ROW + 1;
  sheet.addRow([]);

  // Footer rows with formulas
  const footerStartRow = sepRow + 1;

  // Find leaf rows for footer formulas (items without children)
  const allLeafRows: number[] = [];
  for (const item of sortedItems) {
    const hasChildren = sortedItems.some(
      (other) => other.eap_code.startsWith(item.eap_code + ".") && other.id !== item.id
    );
    if (!hasChildren) {
      const dr = eapToExcelRow.get(item.eap_code);
      if (dr) allLeafRows.push(dr);
    }
  }

  const leafCustoRefs = allLeafRows.map((r) => `G${r}`).join(",");

  // Row 1: Custo Direto Total = SUM of leaf custo_total
  const r1 = footerStartRow;
  const fRow1 = sheet.getRow(r1);
  sheet.mergeCells(`A${r1}:F${r1}`);
  fRow1.getCell(1).value = "Custo Direto Total";
  fRow1.getCell(1).alignment = { horizontal: "right" };
  fRow1.getCell(1).font = { size: 10 };
  fRow1.getCell(7).value = { formula: `SUM(${leafCustoRefs})` } as any;
  fRow1.getCell(7).numFmt = currencyFormat;
  fRow1.getCell(7).alignment = { horizontal: "right" };
  fRow1.getCell(7).font = { size: 10 };

  // Row 2: Administração Total = SUMPRODUCT(custo_total * adm%)
  const r2 = footerStartRow + 1;
  const fRow2 = sheet.getRow(r2);
  sheet.mergeCells(`A${r2}:F${r2}`);
  fRow2.getCell(1).value = "Administração Total";
  fRow2.getCell(1).alignment = { horizontal: "right" };
  fRow2.getCell(1).font = { size: 10 };
  // SUMPRODUCT of each leaf's G*H/100
  const admParts = allLeafRows.map((r) => `G${r}*H${r}/100`).join("+");
  fRow2.getCell(7).value = { formula: admParts } as any;
  fRow2.getCell(7).numFmt = currencyFormat;
  fRow2.getCell(7).alignment = { horizontal: "right" };
  fRow2.getCell(7).font = { size: 10 };

  // Row 3: Impostos (keep static — depends on external imposto %)
  const r3 = footerStartRow + 2;
  const fRow3 = sheet.getRow(r3);
  sheet.mergeCells(`A${r3}:F${r3}`);
  fRow3.getCell(1).value = "Impostos";
  fRow3.getCell(1).alignment = { horizontal: "right" };
  fRow3.getCell(1).font = { size: 10 };
  fRow3.getCell(7).value = footerTotals.impostos;
  fRow3.getCell(7).numFmt = currencyFormat;
  fRow3.getCell(7).alignment = { horizontal: "right" };
  fRow3.getCell(7).font = { size: 10 };

  // Row 4: Preço Total da Obra = Custo Direto + Adm + Impostos
  const r4 = footerStartRow + 3;
  const fRow4 = sheet.getRow(r4);
  sheet.mergeCells(`A${r4}:F${r4}`);
  fRow4.getCell(1).value = "Preço Total da Obra";
  fRow4.getCell(1).alignment = { horizontal: "right" };
  fRow4.getCell(1).font = { bold: true, size: 12 };
  fRow4.getCell(7).value = { formula: `G${r1}+G${r2}+G${r3}` } as any;
  fRow4.getCell(7).numFmt = currencyFormat;
  fRow4.getCell(7).alignment = { horizontal: "right" };
  fRow4.getCell(7).font = { bold: true, size: 12 };

  fRow4.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E3A8A" },
  };
  fRow4.getCell(1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  fRow4.getCell(7).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };

  // Borders
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber >= 3) {
      row.eachCell({ includeEmpty: false }, (cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFD1D5DB" } },
          bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
          left: { style: "thin", color: { argb: "FFD1D5DB" } },
          right: { style: "thin", color: { argb: "FFD1D5DB" } },
        };
      });
    }
  });

  // Generate and download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `orcamento-${projectName.toLowerCase().replace(/\s+/g, "-")}-${
    new Date().toISOString().split("T")[0]
  }.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
