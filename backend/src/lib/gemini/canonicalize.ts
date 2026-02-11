import { getGeminiClient } from './client';
import { CANONICAL_EVENT_TYPES } from '@/lib/db/models';

export async function canonicalizeWithGemini(rawType: string): Promise<string> {
  const client = getGeminiClient();
  if (!client) {
    return 'OTHER';
  }

  const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = `Map this ILI event type to one of the canonical values: ${CANONICAL_EVENT_TYPES.join(', ')}.\nInput: ${rawType}\nOutput ONLY the canonical token.`;

  try {
    const response = await model.generateContent(prompt);
    const text = response.response.text().trim().toUpperCase();
    return CANONICAL_EVENT_TYPES.includes(text as (typeof CANONICAL_EVENT_TYPES)[number]) ? text : 'OTHER';
  } catch {
    return 'OTHER';
  }
}
