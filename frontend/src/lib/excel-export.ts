import ExcelJS from "exceljs";
import type { OrcamentoItem, BudgetFooterTotals } from "@/types/orcamento";

/**
 * Export budget to Excel in ANF format.
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

  const currencyFormat = '#.##0,00;[Red]-#.##0,00';
  const percentFormat = '0,00"%"';

  // Data rows
  const sortedItems = [...items].sort((a, b) => a.eap_code.localeCompare(b.eap_code));

  for (const item of sortedItems) {
    const row = sheet.addRow({
      item: item.eap_code,
      descricao: item.descricao,
      unidade: item.unidade ?? "",
      quantidade: item.quantidade ?? "",
      material: item.custo_material ?? "",
      mao_obra: item.custo_mao_obra ?? "",
      custo_total: item.custo_total ?? "",
      adm: item.adm_percentual,
    });

    if (item.eap_level === 1) {
      row.font = { bold: true, size: 10 };
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFDBEAFE" },
      };
    } else if (item.eap_level === 3) {
      row.font = { size: 9, color: { argb: "FF666666" } };
      const descCell = row.getCell(2);
      descCell.alignment = { indent: 2 };
    } else {
      row.font = { size: 10 };
    }

    [5, 6, 7].forEach((col) => {
      const cell = row.getCell(col);
      if (typeof cell.value === "number") {
        cell.numFmt = currencyFormat;
      }
    });

    const admCell = row.getCell(8);
    if (typeof admCell.value === "number") {
      admCell.numFmt = percentFormat;
    }

    const qtyCell = row.getCell(4);
    if (typeof qtyCell.value === "number") {
      qtyCell.numFmt = '#.##0,00';
    }

    [4, 5, 6, 7, 8].forEach((col) => {
      row.getCell(col).alignment = { horizontal: "right" };
    });
  }

  // Empty separator row
  sheet.addRow([]);

  // Footer rows
  const footerData = [
    { label: "Custo Direto Total", value: footerTotals.custo_direto_total },
    { label: "Administração Total", value: footerTotals.administracao_total },
    { label: "Impostos", value: footerTotals.impostos },
    { label: "Preço Total da Obra", value: footerTotals.preco_total_obra },
  ];

  for (const footer of footerData) {
    const row = sheet.addRow([]);
    const rowNum = row.number;
    sheet.mergeCells(`A${rowNum}:F${rowNum}`);
    const labelCell = row.getCell(1);
    labelCell.value = footer.label;
    labelCell.alignment = { horizontal: "right" };
    labelCell.font = {
      bold: footer.label === "Preço Total da Obra",
      size: footer.label === "Preço Total da Obra" ? 12 : 10,
    };

    const valueCell = row.getCell(7);
    valueCell.value = footer.value;
    valueCell.numFmt = currencyFormat;
    valueCell.alignment = { horizontal: "right" };
    valueCell.font = {
      bold: footer.label === "Preço Total da Obra",
      size: footer.label === "Preço Total da Obra" ? 12 : 10,
    };

    if (footer.label === "Preço Total da Obra") {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E3A8A" },
      };
      labelCell.font = { ...labelCell.font, color: { argb: "FFFFFFFF" } };
      valueCell.font = { ...valueCell.font, color: { argb: "FFFFFFFF" } };
    }
  }

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
