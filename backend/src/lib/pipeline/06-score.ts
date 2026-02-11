import { Exception, MatchedPair } from '@/lib/db/models';

export async function postScoreAndCategorize(jobId: string) {
  const pairs = await MatchedPair.find({ job_id: jobId }).lean();

  let high = 0;
  let medium = 0;
  let low = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exceptionInserts: any[] = [];

  for (const pair of pairs) {
    if (pair.confidence_category === 'HIGH') high += 1;
    if (pair.confidence_category === 'MEDIUM') medium += 1;
    if (pair.confidence_category === 'LOW') {
      low += 1;
      exceptionInserts.push({
        job_id: jobId,
        run_id: pair.run_a_run_id,
        feature_id: pair.run_a_feature_id,
        category: 'LOW_CONFIDENCE',
        severity: pair.confidence_score < 25 ? 'HIGH' : 'MEDIUM',
        details: {
          matchPairId: pair._id,
          score: pair.confidence_score,
          category: pair.match_category
        }
      });
    }

    if (pair.clock_residual_hrs == null) {
      exceptionInserts.push({
        job_id: jobId,
        run_id: pair.run_a_run_id,
        feature_id: pair.run_a_feature_id,
        category: 'CLOCK_MISSING',
        severity: 'LOW',
        details: {
          matchPairId: pair._id
        }
      });
    }
  }

  // Bulk insert all exceptions in batches of 1000
  for (let i = 0; i < exceptionInserts.length; i += 1000) {
    await Exception.insertMany(exceptionInserts.slice(i, i + 1000), { ordered: false });
  }

  return {
    total_matches: pairs.length,
    high_confidence: high,
    medium_confidence: medium,
    low_confidence: low,
    avg_growth_pct_yr:
      pairs.length > 0
        ? pairs.reduce((acc, pair) => acc + (pair.depth_growth_pct_yr ?? 0), 0) / pairs.length
        : 0
  };
}
