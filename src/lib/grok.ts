import axios from 'axios';

const getApiKey = () => {
  // Accept multiple environment variable names for flexibility
  let key = '';
  if (typeof process !== 'undefined' && process.env) {
    key = process.env.OPENROUTER_API_KEY || process.env.GROK_API_KEY || process.env.GEMINI_API_KEY || process.env.VITE_OPENROUTER_API_KEY || process.env.VITE_GROK_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
  }
  if (!key && typeof import.meta !== 'undefined' && (import.meta as any).env) {
    key = (import.meta as any).env.VITE_OPENROUTER_API_KEY || (import.meta as any).env.VITE_GROK_API_KEY || (import.meta as any).env.VITE_GEMINI_API_KEY || '';
  }
  return key;
};

const BASE = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter API with Step 3.5 Flash reasoning model.
 * - Chat: POST /chat/completions with { model, messages, reasoning } -> choices[0].message with reasoning_details
 * - Embeddings: POST /embeddings with { model, input } -> data[0].embedding
 */
export const grokRequest = async (endpoint: string, data: any) => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('OpenRouter API key is missing. Set OPENROUTER_API_KEY in your environment.');

  if (endpoint === 'chat') {
    const systemContent = (typeof data.systemPrompt === 'string' ? data.systemPrompt : '') || (typeof data.prompt === 'string' ? data.prompt : '');
    const userContent = typeof data.userMessage === 'string' ? data.userMessage : '';
    const history: { role: string; content: string; reasoning_details?: any }[] = Array.isArray(data.history) ? data.history : [];
    const messages: { role: 'system' | 'user' | 'assistant'; content: string; reasoning_details?: any }[] = [];

    // Preserve system role correctly. If only a system prompt is provided, send it as system.
    if (systemContent && !userContent && history.length === 0) {
      messages.push({ role: 'system', content: systemContent });
    } else {
      if (systemContent) messages.push({ role: 'system', content: systemContent });
      // Preserve explicit roles in history (system/assistant/user) and reasoning_details
      history.forEach((m: { role: string; content: string; reasoning_details?: any }) => {
        const role = m.role === 'assistant' ? 'assistant' : (m.role === 'system' ? 'system' : 'user');
        const msg: any = { role: role as any, content: m.content || '' };
        if (m.reasoning_details) msg.reasoning_details = m.reasoning_details;
        messages.push(msg);
      });
      if (userContent) messages.push({ role: 'user', content: userContent });
    }

    const body = {
      model: 'stepfun/step-3.5-flash:free',
      messages,
      reasoning: { enabled: true },
      max_tokens: 4096,
    };

    const res = await axios.post(`${BASE}/chat/completions`, body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
        'X-Title': 'BatchMind AI',
      },
    });
    // Extract content and reasoning_details from OpenRouter response
    const message = res.data?.choices?.[0]?.message;
    const content = message?.content ?? message?.text ?? res.data?.choices?.[0]?.text ?? res.data?.output?.[0]?.content ?? '';
    const reasoning_details = message?.reasoning_details ?? null;
    return { text: content, answer: content, reasoning_details };
  }

  if (endpoint === 'embeddings') {
    const input = typeof data.input === 'string' ? data.input : (Array.isArray(data.input) ? data.input : '');
    const body = { model: 'openai/text-embedding-3-small', input };
    const res = await axios.post(`${BASE}/embeddings`, body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
        'X-Title': 'BatchMind AI',
      },
    });
    // Support multiple response shapes and validate embedding is an array of numbers
    const raw = res.data?.data?.[0]?.embedding ?? res.data?.embedding ?? null;
    const embedding = Array.isArray(raw) && raw.every((v: any) => typeof v === 'number') ? raw : null;
    return { embedding };
  }

  throw new Error(`Unknown endpoint: ${endpoint}`);
};
