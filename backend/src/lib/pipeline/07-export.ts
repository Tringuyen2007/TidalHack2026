import fs from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { AuditLog, Exception, Feature, MatchedPair, Run } from '@/lib/db/models';
import type { Types } from 'mongoose';

/**
 * Flatten a nested object into dot-delimited keys.
 * { a: { b: 1 } } → { 'a.b': 1 }
 */
function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      Object.assign(result, flattenObject(val as Record<string, unknown>, fullKey));
    } else if (Array.isArray(val)) {
      result[fullKey] = val.join('; ');
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}

/**
 * Convert an array of flat-keyed rows into a CSV string with a deterministic
 * column order. `orderedColumns` defines the column order; any remaining keys
 * found in the data are appended alphabetically.
 */
function toCsvString(rows: Record<string, unknown>[], orderedColumns: string[]): string {
  if (rows.length === 0) return '';
  // Collect all keys across all rows
  const allKeys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) allKeys.add(key);
  }
  // Order: explicit columns first (if present), then remainder alphabetically
  const columns = orderedColumns.filter(c => allKeys.has(c));
  const remainder = [...allKeys].filter(k => !orderedColumns.includes(k)).sort();
  const finalCols = [...columns, ...remainder];

  const escape = (v: unknown): string => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = finalCols.map(escape).join(',');
  const body = rows.map(row => finalCols.map(col => escape(row[col])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

// ── Canonical column order for MatchedPair CSV ──
// This defines the preferred column order. Flattened standards_applied sub-keys
// will appear under their dot-notation names.
const MATCH_COLUMNS = [
  '_id',
  'job_id',
  'run_a_feature_id',
  'run_b_feature_id',
  'run_a_run_id',
  'run_b_run_id',
  'distance_residual_ft',
  'clock_residual_hrs',
  'type_compatibility',
  'dimensional_similarity',
  'confidence_score',
  'confidence_category',
  'match_category',
  'depth_growth_pct_yr',
  'length_growth_in_yr',
  'width_growth_in_yr',
  'years_between',
  'competing_candidates',
  'override_by',
  'override_at',
  'override_reason',
  'original_category',
  'is_overridden',
  // Standards (flattened)
  'standards_applied.asme_b31_8s.applied',
  'standards_applied.asme_b31_8s.interaction_zone',
  'standards_applied.asme_b31_8s.interaction_severity',
  'standards_applied.asme_b31_8s.severity_level',
  'standards_applied.asme_b31_8s.repair_recommendation',
  'standards_applied.asme_b31_8s.rationale',
  'standards_applied.api_1163.applied',
  'standards_applied.api_1163.tool_weight',
  'standards_applied.api_1163.adjusted_confidence',
  'standards_applied.api_1163.adjustment_reason',
  'standards_applied.nace_sp0502.applied',
  'standards_applied.nace_sp0502.corrosion_class',
  'standards_applied.nace_sp0502.remaining_life_years',
  'standards_applied.nace_sp0502.reassessment_interval_years',
  'standards_applied.phmsa.audit_logged',
  'standards_applied.phmsa.decision_rationale',
  'createdAt',
  'updatedAt',
];

// Exception-specific columns appended after the shared schema
const EXCEPTION_ONLY_COLUMNS = [
  'exception_category',
  'exception_severity',
  'exception_details',
];

export async function generateExports(jobId: string) {
  const [matches, exceptions, audit] = await Promise.all([
    MatchedPair.find({ job_id: jobId }).lean(),
    Exception.find({ job_id: jobId }).lean(),
    AuditLog.find({ job_id: jobId }).lean()
  ]);

  const outDir = path.join('/tmp', 'ili-exports', jobId);
  await fs.mkdir(outDir, { recursive: true });

  // ── Flatten matches for CSV ──
  const flatMatches = matches.map(m => {
    const { standards_applied, competing_candidates, __v, ...rest } = m as Record<string, unknown>;
    const flat: Record<string, unknown> = { ...rest };
    // Flatten standards_applied
    if (standards_applied && typeof standards_applied === 'object') {
      Object.assign(flat, flattenObject(standards_applied as Record<string, unknown>, 'standards_applied'));
    }
    delete flat.standards_applied;
    // Flatten competing_candidates array to semicolon-delimited string
    if (Array.isArray(competing_candidates)) {
      flat.competing_candidates = competing_candidates.map(String).join('; ');
    }
    return flat;
  });

  // ── Build exceptions with match-schema parity ──
  // For each exception, look up the associated Feature to populate shared fields.
  const exceptionFeatureIds = exceptions
    .map(e => (e as Record<string, unknown>).feature_id as Types.ObjectId | undefined)
    .filter((id): id is Types.ObjectId => id != null);

  const exceptionRunIds = exceptions
    .map(e => (e as Record<string, unknown>).run_id as Types.ObjectId | undefined)
    .filter((id): id is Types.ObjectId => id != null);

  const [exceptionFeatures, exceptionRuns] = await Promise.all([
    exceptionFeatureIds.length > 0
      ? Feature.find({ _id: { $in: exceptionFeatureIds } }).lean()
      : Promise.resolve([]),
    exceptionRunIds.length > 0
      ? Run.find({ _id: { $in: exceptionRunIds } }).select({ _id: 1, year: 1, label: 1, vendor: 1, tool_type: 1 }).lean()
      : Promise.resolve([]),
  ]);

  const featureLookup = new Map(
    (exceptionFeatures as Array<Record<string, unknown>>).map(f => [String(f._id), f])
  );
  const runLookup = new Map(
    (exceptionRuns as Array<Record<string, unknown>>).map(r => [String(r._id), r])
  );

  const flatExceptions = exceptions.map(rawExc => {
    const exc = rawExc as Record<string, unknown>;
    const feat = featureLookup.get(String(exc.feature_id ?? ''));
    const run = runLookup.get(String(exc.run_id ?? ''));

    // Build a row that mirrors the match schema columns, populated where possible.
    // Fields that don't apply are left as null/empty.
    const row: Record<string, unknown> = {};

    // ── Shared columns (match schema parity) ──
    row['_id'] = exc._id;
    row['job_id'] = exc.job_id;
    // Feature IDs: exception has one feature, not a pair
    row['run_a_feature_id'] = exc.feature_id ?? '';
    row['run_b_feature_id'] = '';  // no counterpart
    row['run_a_run_id'] = exc.run_id ?? '';
    row['run_b_run_id'] = '';
    row['distance_residual_ft'] = '';
    row['clock_residual_hrs'] = '';
    row['type_compatibility'] = '';
    row['dimensional_similarity'] = '';
    row['confidence_score'] = '';
    row['confidence_category'] = '';
    row['match_category'] = '';
    row['depth_growth_pct_yr'] = '';
    row['length_growth_in_yr'] = '';
    row['width_growth_in_yr'] = '';
    row['years_between'] = '';
    row['competing_candidates'] = '';
    row['override_by'] = '';
    row['override_at'] = '';
    row['override_reason'] = '';
    row['original_category'] = '';
    row['is_overridden'] = '';

    // Standards columns — empty for exceptions (standards only apply to matched pairs)
    row['standards_applied.asme_b31_8s.applied'] = '';
    row['standards_applied.asme_b31_8s.interaction_zone'] = '';
    row['standards_applied.asme_b31_8s.interaction_severity'] = '';
    row['standards_applied.asme_b31_8s.severity_level'] = '';
    row['standards_applied.asme_b31_8s.repair_recommendation'] = '';
    row['standards_applied.asme_b31_8s.rationale'] = '';
    row['standards_applied.api_1163.applied'] = '';
    row['standards_applied.api_1163.tool_weight'] = '';
    row['standards_applied.api_1163.adjusted_confidence'] = '';
    row['standards_applied.api_1163.adjustment_reason'] = '';
    row['standards_applied.nace_sp0502.applied'] = '';
    row['standards_applied.nace_sp0502.corrosion_class'] = '';
    row['standards_applied.nace_sp0502.remaining_life_years'] = '';
    row['standards_applied.nace_sp0502.reassessment_interval_years'] = '';
    row['standards_applied.phmsa.audit_logged'] = '';
    row['standards_applied.phmsa.decision_rationale'] = '';

    row['createdAt'] = exc.createdAt ?? '';
    row['updatedAt'] = exc.updatedAt ?? '';

    // ── Feature-enriched fields (read-only from Feature doc, not fabricated) ──
    // These give downstream users context about the excepted anomaly.
    if (feat) {
      row['feature_type'] = feat.event_type_canonical ?? '';
      row['feature_type_raw'] = feat.event_type_raw ?? '';
      row['corrected_distance_ft'] = feat.corrected_distance_ft ?? '';
      row['log_distance_ft'] = feat.log_distance_ft ?? '';
      row['depth_percent'] = feat.depth_percent ?? '';
      row['depth_in'] = feat.depth_in ?? '';
      row['length_in'] = feat.length_in ?? '';
      row['width_in'] = feat.width_in ?? '';
      row['wall_thickness_in'] = feat.wall_thickness_in ?? '';
      row['clock_decimal'] = feat.clock_decimal ?? '';
      row['clock_position_raw'] = feat.clock_position_raw ?? '';
      row['joint_number'] = feat.joint_number ?? '';
    } else {
      row['feature_type'] = '';
      row['feature_type_raw'] = '';
      row['corrected_distance_ft'] = '';
      row['log_distance_ft'] = '';
      row['depth_percent'] = '';
      row['depth_in'] = '';
      row['length_in'] = '';
      row['width_in'] = '';
      row['wall_thickness_in'] = '';
      row['clock_decimal'] = '';
      row['clock_position_raw'] = '';
      row['joint_number'] = '';
    }

    // Run context
    if (run) {
      row['run_year'] = run.year ?? '';
      row['run_label'] = run.label ?? '';
      row['run_vendor'] = run.vendor ?? '';
      row['run_tool_type'] = run.tool_type ?? '';
    } else {
      row['run_year'] = '';
      row['run_label'] = '';
      row['run_vendor'] = '';
      row['run_tool_type'] = '';
    }

    // ── Exception-specific columns (appended after shared schema) ──
    row['exception_category'] = exc.category ?? '';
    row['exception_severity'] = exc.severity ?? '';
    row['exception_details'] = exc.details ? JSON.stringify(exc.details) : '';

    return row;
  });

  // ── Column order for exceptions CSV ──
  // Match columns first, then feature-enriched, then run context, then exception-only
  const EXCEPTION_COLUMNS = [
    ...MATCH_COLUMNS,
    // Feature-enriched
    'feature_type', 'feature_type_raw',
    'corrected_distance_ft', 'log_distance_ft',
    'depth_percent', 'depth_in', 'length_in', 'width_in',
    'wall_thickness_in', 'clock_decimal', 'clock_position_raw', 'joint_number',
    // Run context
    'run_year', 'run_label', 'run_vendor', 'run_tool_type',
    // Exception-specific
    ...EXCEPTION_ONLY_COLUMNS,
  ];

  // ── Generate CSVs ──
  const matchesCsv = toCsvString(flatMatches, MATCH_COLUMNS);
  const exceptionsCsv = toCsvString(flatExceptions, EXCEPTION_COLUMNS);

  await fs.writeFile(path.join(outDir, 'matches.csv'), matchesCsv, 'utf8');
  await fs.writeFile(path.join(outDir, 'exceptions.csv'), exceptionsCsv, 'utf8');

  // ── XLSX with both sheets ──
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(flatMatches), 'matches');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(flatExceptions), 'exceptions');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(audit as Record<string, unknown>[]), 'audit');

  const xlsxPath = path.join(outDir, 'alignment-report.xlsx');
  XLSX.writeFile(workbook, xlsxPath);

  return {
    outDir,
    files: {
      xlsx: xlsxPath,
      matchesCsv: path.join(outDir, 'matches.csv'),
      exceptionsCsv: path.join(outDir, 'exceptions.csv')
    }
  };
}
