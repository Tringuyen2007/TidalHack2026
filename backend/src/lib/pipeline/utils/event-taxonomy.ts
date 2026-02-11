import { canonicalizeWithGemini } from '@/lib/gemini/canonicalize';

const DIRECT_MAP: Record<string, string> = {
  'girth weld': 'GIRTH_WELD',
  girthweld: 'GIRTH_WELD',
  gw: 'GIRTH_WELD',
  'metal loss': 'METAL_LOSS',
  'metal loss axial': 'METAL_LOSS',
  cluster: 'CLUSTER',
  'metal loss-manufacturing anomaly': 'METAL_LOSS_MFG',
  'metal loss manufacturing anomaly': 'METAL_LOSS_MFG',
  'metal loss manufacturing': 'METAL_LOSS_MFG',
  bend: 'BEND',
  'field bend': 'FIELD_BEND',
  valve: 'VALVE',
  tee: 'TEE',
  tap: 'TAP',
  agm: 'AGM',
  dent: 'DENT',
  'seam weld manufacturing anomaly': 'SEAM_WELD_MFG',
  'seam weld': 'SEAM_WELD_MFG',
  'sleeve start': 'SLEEVE_START',
  'sleeve end': 'SLEEVE_END',
  attachment: 'ATTACHMENT',
  'repair marker start': 'REPAIR_MARKER_START',
  'repair marker end': 'REPAIR_MARKER_END',
  'composite wrap start': 'COMPOSITE_WRAP_START',
  'composite wrap end': 'COMPOSITE_WRAP_END',
  launcher: 'LAUNCHER',
  receiver: 'RECEIVER',
  flange: 'FLANGE',
  support: 'SUPPORT',
  magnet: 'MAGNET',
  'cp point': 'CP_POINT',
  'recoat start': 'RECOAT_START',
  'recoat end': 'RECOAT_END'
};

const cache = new Map<string, string>();

export async function canonicalizeEventType(rawValue: unknown): Promise<string> {
  if (!rawValue) {
    return 'OTHER';
  }

  const input = String(rawValue).trim();
  if (!input) {
    return 'OTHER';
  }

  const key = input.toLowerCase();
  if (cache.has(key)) {
    return cache.get(key)!;
  }

  const direct = DIRECT_MAP[key];
  if (direct) {
    cache.set(key, direct);
    return direct;
  }

  const gemini = await canonicalizeWithGemini(input);
  cache.set(key, gemini);
  return gemini;
}

export function canonicalizeEventTypeSync(rawValue: unknown): string {
  if (!rawValue) {
    return 'OTHER';
  }

  const key = String(rawValue).trim().toLowerCase();
  if (!key) {
    return 'OTHER';
  }

  return DIRECT_MAP[key] ?? cache.get(key) ?? 'OTHER';
}
