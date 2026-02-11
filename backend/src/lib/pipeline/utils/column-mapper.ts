type CanonicalField =
  | 'joint_number'
  | 'joint_length_ft'
  | 'wall_thickness_in'
  | 'dist_to_upstream_weld_ft'
  | 'dist_to_downstream_weld_ft'
  | 'log_distance_ft'
  | 'event_type'
  | 'depth_percent'
  | 'depth_in'
  | 'length_in'
  | 'width_in'
  | 'clock_position'
  | 'elevation_ft'
  | 'comments';

export type ColumnMap = Record<CanonicalField, string | null>;

const KNOWN_MAPPINGS: Record<number, Partial<ColumnMap>> = {
  2007: {
    joint_number: 'J. no.',
    joint_length_ft: 'J. len [ft]',
    wall_thickness_in: 't [in]',
    dist_to_upstream_weld_ft: 'to u/s w. [ft]',
    log_distance_ft: 'log dist. [ft]',
    event_type: 'event',
    depth_percent: 'depth [%]',
    length_in: 'length [in]',
    width_in: 'width [in]',
    clock_position: "o'clock",
    elevation_ft: 'Height [ft]',
    comments: 'comment'
  },
  2015: {
    joint_number: 'J. no.',
    joint_length_ft: 'J. len [ft]',
    wall_thickness_in: 'Wt [in]',
    dist_to_upstream_weld_ft: 'to u/s w. [ft]',
    dist_to_downstream_weld_ft: 'to d/s w. [ft]',
    log_distance_ft: 'Log Dist. [ft]',
    event_type: 'Event Description',
    depth_percent: 'Depth [%]',
    depth_in: 'Depth [in]',
    length_in: 'Length [in]',
    width_in: 'Width [in]',
    clock_position: "O'clock",
    elevation_ft: 'Elevation [ft]',
    comments: 'Comments'
  },
  2022: {
    joint_number: 'Joint Number',
    joint_length_ft: 'Joint Length [ft]',
    wall_thickness_in: 'WT [in]',
    dist_to_upstream_weld_ft: 'Distance to U/S GW \n[ft]',
    dist_to_downstream_weld_ft: 'Distance to D/S GW \n[ft]',
    log_distance_ft: 'ILI Wheel Count \n[ft.]',
    event_type: 'Event Description',
    depth_percent: 'Metal Loss Depth \n[%]',
    depth_in: 'Metal Loss Depth \n[in]',
    length_in: 'Length [in]',
    width_in: 'Width [in]',
    clock_position: "O'clock\n[hh:mm]",
    elevation_ft: 'Elevation [ft]',
    comments: 'Comments'
  }
};

const CANONICAL_FIELDS = Object.keys(KNOWN_MAPPINGS[2015]) as CanonicalField[];

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9%./\[\]]+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[a.length][b.length];
}

export function buildColumnMap(year: number, headers: string[]): ColumnMap {
  const result: ColumnMap = {
    joint_number: null,
    joint_length_ft: null,
    wall_thickness_in: null,
    dist_to_upstream_weld_ft: null,
    dist_to_downstream_weld_ft: null,
    log_distance_ft: null,
    event_type: null,
    depth_percent: null,
    depth_in: null,
    length_in: null,
    width_in: null,
    clock_position: null,
    elevation_ft: null,
    comments: null
  };

  const rawToActual = new Map(headers.map((h) => [normalizeHeader(h), h]));
  const known = KNOWN_MAPPINGS[year] ?? {};

  for (const field of CANONICAL_FIELDS) {
    const direct = known[field];
    if (direct && headers.includes(direct)) {
      result[field] = direct;
      continue;
    }

    if (direct) {
      const normalized = normalizeHeader(direct);
      const maybe = rawToActual.get(normalized);
      if (maybe) {
        result[field] = maybe;
        continue;
      }
    }

    const candidates = headers
      .map((header) => ({
        header,
        distance: levenshtein(normalizeHeader(header), normalizeHeader(field.replace(/_/g, ' ')))
      }))
      .sort((a, b) => a.distance - b.distance);

    if (candidates.length > 0 && candidates[0].distance <= 10) {
      result[field] = candidates[0].header;
    }
  }

  return result;
}
