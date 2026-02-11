export function normalizeClockValue(value: unknown): { raw: string; decimal: number | null } {
  if (value == null || value === '') {
    return { raw: '', decimal: null };
  }

  if (value instanceof Date) {
    const hours24 = value.getHours() + value.getMinutes() / 60;
    const h = hours24 % 12;
    return { raw: `${value.getHours()}:${String(value.getMinutes()).padStart(2, '0')}`, decimal: h === 0 ? 12 : h };
  }

  if (typeof value === 'number') {
    if (value >= 0 && value <= 1) {
      const totalHours = value * 24;
      const normalized = totalHours % 12;
      return { raw: String(value), decimal: normalized === 0 ? 12 : normalized };
    }

    const normalized = value % 12;
    return { raw: String(value), decimal: normalized === 0 ? 12 : normalized };
  }

  const raw = String(value).trim();
  const parts = raw.replace(/\s+/g, '').split(':');

  if (parts.length >= 2) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      const decimal = (h % 12) + m / 60;
      return { raw, decimal: decimal === 0 ? 12 : decimal };
    }
  }

  const numeric = Number(raw);
  if (!Number.isNaN(numeric)) {
    const normalized = numeric % 12;
    return { raw, decimal: normalized === 0 ? 12 : normalized };
  }

  return { raw, decimal: null };
}

export function clockCircularDistance(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) {
    return null;
  }

  const aNorm = a % 12;
  const bNorm = b % 12;
  const diff = Math.abs(aNorm - bNorm);
  return Math.min(diff, 12 - diff);
}
