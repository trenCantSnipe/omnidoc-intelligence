import Anthropic from '@anthropic-ai/sdk';

/**
 * The LLM is the *interface*, not the intelligence. Everything it is given has already been
 * computed by the deterministic engines; it is only allowed to explain and phrase.
 */
export interface NarrationRequest {
  task: 'answer' | 'brief' | 'freeform';
  question?: string;
  /** Deterministic draft produced by the engines. May be empty for freeform questions. */
  draft: string;
  /** Structured facts the answer must be grounded in. */
  facts?: unknown;
}

export interface Narrator {
  narrate(req: NarrationRequest): Promise<string>;
}

/** Default narrator: the engines' own text, unchanged. Works offline and is fully deterministic. */
export class PlainNarrator implements Narrator {
  async narrate(req: NarrationRequest): Promise<string> {
    return req.draft || 'I can only answer from the hotel data I have. Try asking what changed, why a metric moved, or what to focus on.';
  }
}

const SYSTEM = `You are the communication layer of a hotel operations intelligence platform.
You are given FACTS and a DRAFT computed by deterministic analytics engines from the hotel's own data.
Rules:
- Use ONLY the numbers and claims in FACTS/DRAFT. Never invent figures, causes, dates or competitors.
- Keep every number exactly as given (currency in ₹).
- If the facts do not answer the question, say what is missing instead of guessing.
- Write for a busy hotel manager: lead with the answer, be concise, plain language, no filler.
- For recommendations, keep the recommended action and its guardrails; do not strengthen or weaken them.`;

/**
 * Optional Claude-backed narrator. Any failure (network, refusal, empty output) falls back to the
 * deterministic draft, so an LLM outage degrades the *wording*, never the *answer*.
 */
export class AnthropicNarrator implements Narrator {
  private client: Anthropic;

  constructor(
    private opts: { model?: string; maxTokens?: number; client?: Anthropic } = {},
  ) {
    // Credentials resolve from the environment (ANTHROPIC_API_KEY etc.) unless a client is injected.
    this.client = opts.client ?? new Anthropic();
  }

  async narrate(req: NarrationRequest): Promise<string> {
    const user = [
      req.question ? `QUESTION: ${req.question}` : `TASK: rewrite the ${req.task} below for the reader.`,
      `FACTS:\n${JSON.stringify(req.facts ?? {}, null, 2)}`,
      req.draft ? `DRAFT:\n${req.draft}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      const res = await this.client.messages.create({
        model: this.opts.model ?? 'claude-opus-5-5',
        max_tokens: this.opts.maxTokens ?? 2000,
        output_config: { effort: 'low' },
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      });
      if (res.stop_reason === 'refusal') return req.draft;
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      return text || req.draft;
    } catch {
      return req.draft; // network/auth/rate-limit: keep the deterministic answer
    }
  }
}
