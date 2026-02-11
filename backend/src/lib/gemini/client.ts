import { GoogleGenerativeAI } from '@google/generative-ai';

let client: GoogleGenerativeAI | null = null;

export function getGeminiClient() {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }

  if (!client) {
    client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  return client;
}
