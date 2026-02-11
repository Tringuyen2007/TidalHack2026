import { Types } from 'mongoose';
import { Feature, Run, Dataset } from '@/lib/db/models';
import type { ParsedRun } from './types';
import { buildColumnMap } from './utils/column-mapper';
import { normalizeClockValue } from './utils/clock';
import { canonicalizeEventType } from './utils/event-taxonomy';
import { parseInspectionDate } from './utils/date-parser';

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isReferencePoint(eventType: string) {
  return ['GIRTH_WELD', 'VALVE', 'TEE', 'TAP', 'FLANGE', 'LAUNCHER', 'RECEIVER', 'SUPPORT'].includes(eventType);
}

export async function normalizeAndPersistRuns(args: {
  datasetId: string;
  orgId: string;
  runs: ParsedRun[];
}): Promise<{ runIds: string[]; totalFeatures: number }> {
  const datasetObjectId = new Types.ObjectId(args.datasetId);
  const orgObjectId = new Types.ObjectId(args.orgId);

  const runIds: string[] = [];
  let totalFeatures = 0;

  for (const run of args.runs) {
    // Parse inspection date using robust multi-format parser
    const dateParsed = await parseInspectionDate(
      run.summary?.inspection_date_raw,
      run.year
    );

    if (dateParsed.warning) {
      console.warn(`[normalize] Run ${run.year}: ${dateParsed.warning}`);
    }

    const runDoc = await Run.create({
      dataset_id: datasetObjectId,
      org_id: orgObjectId,
      year: run.year,
      label: run.label,
      vendor: run.summary?.vendor,
      tool_type: run.summary?.tool_type,
      inspection_date: dateParsed.date,
      inspection_date_raw: dateParsed.raw_value,
      inspection_date_source: dateParsed.source,
      inspection_date_confidence: dateParsed.confidence,
      inspection_date_warning: dateParsed.warning,
      start_odometer_ft: run.summary?.start_odometer_ft,
      end_odometer_ft: run.summary?.end_odometer_ft,
      total_rows: run.rows.length
    });

    runIds.push(runDoc._id.toString());

    const columnMap = buildColumnMap(run.year, run.headers);
    const uniqueRawTypes = new Set<string>();

    for (const row of run.rows) {
      const eventRaw = columnMap.event_type ? row[columnMap.event_type] : null;
      if (eventRaw != null && String(eventRaw).trim()) {
        uniqueRawTypes.add(String(eventRaw));
      }
    }

    const canonicalByRaw = new Map<string, string>();
    await Promise.all(
      [...uniqueRawTypes].map(async (raw) => {
        canonicalByRaw.set(raw, await canonicalizeEventType(raw));
      })
    );

    const featureDocs = run.rows.map((row, idx) => {
      const eventRaw = columnMap.event_type ? row[columnMap.event_type] : null;
      const eventRawString = eventRaw == null ? '' : String(eventRaw);
      const eventTypeCanonical = canonicalByRaw.get(eventRawString) ?? 'OTHER';

      const clockInput = columnMap.clock_position ? row[columnMap.clock_position] : null;
      const clock = normalizeClockValue(clockInput);

      return {
        run_id: runDoc._id,
        org_id: orgObjectId,
        row_index: idx + 1,
        joint_number: toNumber(columnMap.joint_number ? row[columnMap.joint_number] : null),
        joint_length_ft: toNumber(columnMap.joint_length_ft ? row[columnMap.joint_length_ft] : null),
        wall_thickness_in: toNumber(columnMap.wall_thickness_in ? row[columnMap.wall_thickness_in] : null),
        log_distance_ft: toNumber(columnMap.log_distance_ft ? row[columnMap.log_distance_ft] : null),
        corrected_distance_ft: toNumber(columnMap.log_distance_ft ? row[columnMap.log_distance_ft] : null),
        dist_to_upstream_weld_ft: toNumber(
          columnMap.dist_to_upstream_weld_ft ? row[columnMap.dist_to_upstream_weld_ft] : null
        ),
        event_type_raw: eventRawString,
        event_type_canonical: eventTypeCanonical,
        depth_percent: toNumber(columnMap.depth_percent ? row[columnMap.depth_percent] : null),
        depth_in: toNumber(columnMap.depth_in ? row[columnMap.depth_in] : null),
        length_in: toNumber(columnMap.length_in ? row[columnMap.length_in] : null),
        width_in: toNumber(columnMap.width_in ? row[columnMap.width_in] : null),
        clock_position_raw: clock.raw,
        clock_decimal: clock.decimal,
        is_reference_point: isReferencePoint(eventTypeCanonical),
        elevation_ft: toNumber(columnMap.elevation_ft ? row[columnMap.elevation_ft] : null),
        comments: columnMap.comments ? String(row[columnMap.comments] ?? '') : '',
        original_metadata: row
      };
    });

    if (featureDocs.length > 0) {
      await Feature.insertMany(featureDocs, { ordered: false });
    }

    await Run.updateOne({ _id: runDoc._id }, { total_features: featureDocs.length });
    totalFeatures += featureDocs.length;
  }

  await Dataset.updateOne(
    { _id: datasetObjectId },
    {
      run_ids: runIds.map((id) => new Types.ObjectId(id)),
      total_features: totalFeatures
    }
  );

  return { runIds, totalFeatures };
}
