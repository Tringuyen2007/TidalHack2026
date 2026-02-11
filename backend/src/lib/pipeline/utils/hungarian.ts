export type Assignment = {
  row: number;
  col: number;
  cost: number;
};

// Hungarian algorithm for minimum cost assignment.
export function hungarian(costMatrix: number[][]): Assignment[] {
  const n = costMatrix.length;
  const m = costMatrix[0]?.length ?? 0;
  if (n === 0 || m === 0) {
    return [];
  }

  const size = Math.max(n, m);
  const matrix = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => {
      if (i < n && j < m) {
        return Number.isFinite(costMatrix[i][j]) ? costMatrix[i][j] : 1e6;
      }
      return 1e6;
    })
  );

  const u = Array(size + 1).fill(0);
  const v = Array(size + 1).fill(0);
  const p = Array(size + 1).fill(0);
  const way = Array(size + 1).fill(0);

  for (let i = 1; i <= size; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array(size + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;

      for (let j = 1; j <= size; j += 1) {
        if (used[j]) continue;
        const cur = matrix[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= size; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignments: Assignment[] = [];
  for (let j = 1; j <= size; j += 1) {
    if (p[j] > 0 && p[j] <= n && j <= m) {
      assignments.push({ row: p[j] - 1, col: j - 1, cost: matrix[p[j] - 1][j - 1] });
    }
  }

  return assignments;
}
