import writeXlsx from "write-excel-file/node";
import type { SheetModel } from "./model";

/**
 * A spreadsheet opened in Excel or Sheets treats text that starts with = + - @ as a formula, which can run commands or leak
 * data when the text came from somewhere untrusted. Such text is prefixed with an apostrophe so it stays text.
 */
export function neutralizeFormula(value: string | number): string | number {
  if (typeof value === "number") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number): string {
  const text = String(neutralizeFormula(value));
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV for the first sheet. Starts with a byte-order mark so Excel reads accented letters correctly. */
export function renderCsv(sheet: SheetModel): string {
  const first = sheet.sheets[0];
  const lines = [first.header, ...first.rows].map((row) => row.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

const INVALID_SHEET_CHARS = /[[\]:*?/\\]/g;

export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name, index) => {
    const base = (name.replace(INVALID_SHEET_CHARS, " ").replace(/\s+/g, " ").replace(/^'+|'+$/g, "").trim() || `Sheet ${index + 1}`).slice(0, 31);
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export async function renderXlsx(sheet: SheetModel): Promise<Uint8Array> {
  const names = sheetNames(sheet.sheets.map((s) => s.name));
  const data = sheet.sheets.map((entry, index) => {
    const columns = entry.header.length;
    const widths = entry.header.map((head, col) => Math.min(48, Math.max(10, head.length + 2, ...entry.rows.slice(0, 200).map((row) => String(row[col] ?? "").length + 2))));
    return {
      sheet: names[index],
      columns: widths.map((width) => ({ width })),
      data: [
        entry.header.map((value) => ({ value, fontWeight: "bold" as const })),
        ...entry.rows.map((row) =>
          Array.from({ length: columns }, (_, col) => {
            const cell = row[col];
            if (cell === undefined || cell === "") return null;
            if (typeof cell === "number") return { value: cell, type: Number };
            return { value: String(cell), type: String };
          }),
        ),
      ],
    };
  });
  const buffer = await writeXlsx(data as never).toBuffer();
  return new Uint8Array(buffer);
}
