/**
 * Robust inspection date parser for ILI pipeline ingestion.
 *
 * Handles: Excel serial numbers, ISO strings, US-formatted strings,
 * textual dates, Date objects, and ambiguous/missing values.
 *
 * Deterministic parsing is always attempted first.
 * Gemini is used only as a fallback for unrecognized string formats.
 *
 * This module is audit-safe: every result includes provenance metadata.
 */

import { canonicalizeWithGemini } from '@/lib/gemini/canonicalize';

export type DateParseSource = 'excel_serial' | 'iso_string' | 'us_format' | 'textual' | 'js_date' | 'gemini' | 'year_only';

export type DateParseResult = {
  /** The parsed Date, or null if unparseable / missing */
  date: Date | null;
  /** How the date was derived */
  source: DateParseSource | null;
  /** The raw input value before parsing (for audit trail) */
  raw_value: string;
  /** Confidence: 1.0 = deterministic, 0.8 = Gemini-assisted, 0.0 = failed */
  confidence: number;
  /** Warning message if parsing was ambiguous or failed */
  warning?: string;
};

// Excel epoch: Jan 0, 1900 = Dec 30, 1899 in JS
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

// Plausible ILI inspection range: 1950–2050
const MIN_YEAR = 1950;
const MAX_YEAR = 2050;

// Excel serial range for 1950-01-01 to 2050-12-31
const MIN_EXCEL_SERIAL = 18264;  // ~1950
const MAX_EXCEL_SERIAL = 54789;  // ~2050

/**
 * Validate that a Date is a real, plausible ILI inspection date.
 */
function isPlausibleDate(d: Date): boolean {
  if (!(d instanceof Date) || isNaN(d.getTime())) return false;
  const year = d.getUTCFullYear();
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * Convert an Excel serial number to a JS Date.
 * Excel uses day-count from 1900-01-01 (with the Lotus 1-2-3 leap year bug).
 */
function excelSerialToDate(serial: number): Date {
  // Lotus 1-2-3 bug: Excel thinks 1900 is a leap year. Serials >= 60 are off by 1.
  const adjusted = serial > 59 ? serial - 1 : serial;
  const ms = EXCEL_EPOCH_MS + (adjusted + 1) * 86400000;
  return new Date(ms);
}

/**
 * Attempt deterministic parsing of common date string formats.
 */
function tryParseString(input: string): { date: Date; source: DateParseSource } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // ISO 8601: 2022-06-19, 2022-06-19T00:00:00Z, etc.
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
    if (isPlausibleDate(d)) return { date: d, source: 'iso_string' };
  }

  // US format: MM/DD/YYYY or M/D/YYYY
  const usMatch = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (usMatch) {
    const month = Number(usMatch[1]);
    const day = Number(usMatch[2]);
    const year = Number(usMatch[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, month - 1, day));
      if (isPlausibleDate(d)) return { date: d, source: 'us_format' };
    }
  }

  // Textual: "Jun 19, 2007", "June 19 2007", "19 Jun 2007", etc.
  const monthNames: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5,
    jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
  };

  // "Jun 19, 2007" or "June 19 2007"
  const textMatch1 = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (textMatch1) {
    const m = monthNames[textMatch1[1].toLowerCase()];
    if (m !== undefined) {
      const d = new Date(Date.UTC(Number(textMatch1[3]), m, Number(textMatch1[2])));
      if (isPlausibleDate(d)) return { date: d, source: 'textual' };
    }
  }

  // "19 Jun 2007" or "19-Jun-2007"
  const textMatch2 = trimmed.match(/^(\d{1,2})[\s\-.]([A-Za-z]+)[\s\-.](\d{4})$/);
  if (textMatch2) {
    const m = monthNames[textMatch2[2].toLowerCase()];
    if (m !== undefined) {
      const d = new Date(Date.UTC(Number(textMatch2[3]), m, Number(textMatch2[1])));
      if (isPlausibleDate(d)) return { date: d, source: 'textual' };
    }
  }

  // "YYYY/MM/DD"
  const yyyymmdd = trimmed.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (yyyymmdd) {
    const d = new Date(Date.UTC(Number(yyyymmdd[1]), Number(yyyymmdd[2]) - 1, Number(yyyymmdd[3])));
    if (isPlausibleDate(d)) return { date: d, source: 'iso_string' };
  }

  return null;
}

/**
 * Primary entry point: parse an inspection date from any raw cell value.
 *
 * Tries in order:
 * 1. null/undefined/empty → null result (no date)
 * 2. JS Date object → validate directly
 * 3. Number → treat as Excel serial if in plausible range
 * 4. String → deterministic regex parsing
 * 5. String (fallback) → Gemini-assisted interpretation
 *
 * Never returns Invalid Date. Never invents a date. Always records provenance.
 */
export async function parseInspectionDate(
  value: unknown,
  contextYear?: number
): Promise<DateParseResult> {
  // --- Null / empty ---
  if (value == null || value === '') {
    // If we have a context year (sheet name), we can infer Jan 1 of that year
    // as a lower-confidence fallback — but only record it, not invent precision
    if (contextYear && contextYear >= MIN_YEAR && contextYear <= MAX_YEAR) {
      return {
        date: new Date(Date.UTC(contextYear, 0, 1)),
        source: 'year_only',
        raw_value: '',
        confidence: 0.3,
        warning: `No inspection date provided; inferred Jan 1 ${contextYear} from sheet name. Review required.`
      };
    }
    return { date: null, source: null, raw_value: '', confidence: 0 };
  }

  const rawStr = String(value);

  // --- JS Date object (from cellDates: true) ---
  if (value instanceof Date) {
    if (isPlausibleDate(value)) {
      return { date: value, source: 'js_date', raw_value: rawStr, confidence: 1.0 };
    }
    return {
      date: null,
      source: null,
      raw_value: rawStr,
      confidence: 0,
      warning: `Date object "${rawStr}" is invalid or outside plausible range (${MIN_YEAR}–${MAX_YEAR})`
    };
  }

  // --- Numeric (Excel serial number) ---
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()))) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= MIN_EXCEL_SERIAL && num <= MAX_EXCEL_SERIAL) {
      const d = excelSerialToDate(num);
      if (isPlausibleDate(d)) {
        return { date: d, source: 'excel_serial', raw_value: rawStr, confidence: 1.0 };
      }
    }
    // A number outside serial range — could be a Unix timestamp or garbage
    if (Number.isFinite(num) && num > 1e9 && num < 3e9) {
      // Looks like Unix seconds
      const d = new Date(num * 1000);
      if (isPlausibleDate(d)) {
        return {
          date: d,
          source: 'excel_serial',
          raw_value: rawStr,
          confidence: 0.7,
          warning: 'Interpreted as Unix timestamp (seconds). Verify correctness.'
        };
      }
    }
    return {
      date: null,
      source: null,
      raw_value: rawStr,
      confidence: 0,
      warning: `Numeric value ${num} is not a valid Excel serial date or recognized timestamp`
    };
  }

  // --- String: deterministic parsing ---
  if (typeof value === 'string') {
    const parsed = tryParseString(value);
    if (parsed) {
      return { date: parsed.date, source: parsed.source, raw_value: rawStr, confidence: 1.0 };
    }

    // --- String fallback: Gemini-assisted ---
    try {
      const geminiResult = await parseWithGemini(value.trim());
      if (geminiResult) {
        return {
          date: geminiResult,
          source: 'gemini',
          raw_value: rawStr,
          confidence: 0.8,
          warning: `Date interpreted by Gemini from "${value}". Manual verification recommended.`
        };
      }
    } catch {
      // Gemini failure is non-fatal
    }

    return {
      date: null,
      source: null,
      raw_value: rawStr,
      confidence: 0,
      warning: `Could not parse date from string: "${value}"`
    };
  }

  return {
    date: null,
    source: null,
    raw_value: rawStr,
    confidence: 0,
    warning: `Unexpected value type for inspection date: ${typeof value}`
  };
}

/**
 * Synchronous-only date parser (no Gemini). Use when Gemini is not desired
 * or for non-critical date fields.
 */
export function parseInspectionDateSync(value: unknown): DateParseResult {
  if (value == null || value === '') {
    return { date: null, source: null, raw_value: '', confidence: 0 };
  }

  const rawStr = String(value);

  if (value instanceof Date) {
    if (isPlausibleDate(value)) {
      return { date: value, source: 'js_date', raw_value: rawStr, confidence: 1.0 };
    }
    return { date: null, source: null, raw_value: rawStr, confidence: 0, warning: `Invalid Date object: "${rawStr}"` };
  }

  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()))) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= MIN_EXCEL_SERIAL && num <= MAX_EXCEL_SERIAL) {
      const d = excelSerialToDate(num);
      if (isPlausibleDate(d)) {
        return { date: d, source: 'excel_serial', raw_value: rawStr, confidence: 1.0 };
      }
    }
    return { date: null, source: null, raw_value: rawStr, confidence: 0, warning: `Invalid numeric date: ${num}` };
  }

  if (typeof value === 'string') {
    const parsed = tryParseString(value);
    if (parsed) {
      return { date: parsed.date, source: parsed.source, raw_value: rawStr, confidence: 1.0 };
    }
    return { date: null, source: null, raw_value: rawStr, confidence: 0, warning: `Unparseable date string: "${value}"` };
  }

  return { date: null, source: null, raw_value: rawStr, confidence: 0, warning: `Unexpected type: ${typeof value}` };
}

/**
 * Gemini-assisted date interpretation. Only used when deterministic parsing fails.
 * Returns a validated Date or null. Never invents a date.
 */
async function parseWithGemini(rawInput: string): Promise<Date | null> {
  const { getGeminiClient } = await import('@/lib/gemini/client');
  const client = getGeminiClient();
  if (!client) return null;

  const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = `Parse this string as an inspection date and return ONLY an ISO date (YYYY-MM-DD) or the word "UNKNOWN" if it cannot be determined. Do NOT guess or invent dates. Input: "${rawInput}"`;

  const response = await model.generateContent(prompt);
  const text = response.response.text().trim();

  if (text === 'UNKNOWN' || text.length < 8) return null;

  const match = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return isPlausibleDate(d) ? d : null;
}
