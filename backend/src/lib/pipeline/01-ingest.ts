import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import type { ParsedRun } from './types';

export function parseDatasetFile(fileBuffer: Buffer, filename: string): ParsedRun[] {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.csv')) {
    const parsed = Papa.parse<Record<string, unknown>>(fileBuffer.toString('utf-8'), {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false
    });

    const rows = parsed.data;
    const headers = Object.keys(rows[0] ?? {});
    return [
      {
        year: new Date().getFullYear(),
        label: 'CSV Run',
        headers,
        rows
      }
    ];
  }

  // Do NOT use cellDates: true — it silently produces Invalid Date for ambiguous
  // values and conflicts with raw: true. We handle date parsing ourselves.
  const workbook = XLSX.read(fileBuffer, {
    type: 'buffer',
    cellDates: false,
    raw: true
  });

  const summaryRows = workbook.Sheets.Summary
    ? (XLSX.utils.sheet_to_json(workbook.Sheets.Summary, { header: 1, raw: true }) as unknown[][])
    : [];

  const summaryByIndex = new Map<number, ParsedRun['summary']>();
  if (summaryRows.length > 1) {
    for (let i = 1; i < summaryRows.length; i += 1) {
      const row = summaryRows[i];
      // Pass raw date values through — they will be parsed properly in 02-normalize
      // using the robust date parser that handles serials, strings, etc.
      const rawStartDate = row[1] ?? undefined;
      const rawEndDate = row[2] ?? undefined;
      summaryByIndex.set(i - 1, {
        vendor: row[3] ? String(row[3]) : undefined,
        tool_type: row[4] ? String(row[4]) : undefined,
        inspection_date_raw: rawEndDate ?? rawStartDate,
        start_odometer_ft: row[5] == null ? undefined : Number(row[5]),
        end_odometer_ft: row[6] == null ? undefined : Number(row[6])
      });
    }
  }

  const runSheets = workbook.SheetNames.filter((name) => /^\d{4}$/.test(name)).sort((a, b) => Number(a) - Number(b));

  return runSheets.map((sheetName, index) => {
    const sheet = workbook.Sheets[sheetName];
    const headerRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];
    const headers = (headerRows[0] ?? []).map((value) => String(value ?? ''));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      raw: true,
      defval: null
    });

    return {
      year: Number(sheetName),
      label: `ILI ${sheetName}`,
      headers,
      rows,
      summary: summaryByIndex.get(index)
    };
  });
}
