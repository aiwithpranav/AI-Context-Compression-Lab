/**
 * server/providers/openai.js
 * OpenAI as the text engine: structured JSON from Chat Completions, and exact
 * token counts from OpenAI's tokenizer (computed locally — no API call, no key).
 */

import OpenAI from 'openai';
import { encode } from 'gpt-tokenizer';
import { LlmError } from '../prompts.js';

export const name = 'openai';

// Any model that supports strict structured outputs works. Model names change
// over time, so this is configurable rather than hard-wired.
export const model = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';

export const ready = () => Boolean(process.env.OPENAI_API_KEY);

let _client = null;
function client() {
  // OPENAI_BASE_URL is honoured by the SDK; tests point it at a fake server.
  if (!_client) _client = new OpenAI();
  return _client;
}

/** Test hook: drop the cached client so a changed env is picked up. */
export function resetClient() { _client = null; }

function translateError(err) {
  if (err instanceof LlmError) return err;
  if (err instanceof OpenAI.AuthenticationError) return new LlmError('The OpenAI API key was rejected. Check OPENAI_API_KEY.', 401);
  if (err instanceof OpenAI.RateLimitError) return new LlmError('OpenAI rate limit or quota reached. Wait a moment, or check your billing/quota.', 429);
  if (err instanceof OpenAI.NotFoundError) return new LlmError(`OpenAI model "${model()}" was not found for your account. Set OPENAI_MODEL to a model you can use.`, 400);
  if (err instanceof OpenAI.BadRequestError) return new LlmError(`OpenAI rejected the request: ${err.message}`, 400);
  if (err instanceof OpenAI.APIConnectionError) return new LlmError('Could not reach the OpenAI API.', 502);
  if (err instanceof OpenAI.APIError) return new LlmError(`OpenAI API error (${err.status}).`, 502);
  return err;
}

/** One structured call. Returns { data, usage } where data matches `schema`. */
export async function generateJson({ system, user, schema }) {
  let res;
  try {
    res = await client().chat.completions.create({
      model: model(),
      max_completion_tokens: 16000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } },
    });
  } catch (err) {
    throw translateError(err);
  }

  const choice = res.choices?.[0];
  if (choice?.message?.refusal) throw new LlmError('The model declined to process this text.', 422);
  if (choice?.finish_reason === 'length') {
    throw new LlmError('The response was cut off. Try a shorter input or a stronger compression level.', 422);
  }
  try {
    return { data: JSON.parse(choice.message.content), usage: { inputTokens: res.usage?.prompt_tokens ?? null } };
  } catch {
    throw new LlmError('The model returned an unreadable response. Please retry.', 502);
  }
}

/** Exact token counts (o200k tokenizer, used by current OpenAI models). Null if it can't be computed. */
export function countTokens(texts) {
  try {
    return texts.map(t => encode(t).length);
  } catch {
    return null;
  }
}
