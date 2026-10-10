/**
 * Client for any OpenAI-compatible `POST {baseUrl}/embeddings` endpoint
 * (Ollama, LM Studio, llama.cpp server, OpenAI, Voyage, ...). No dependencies.
 *
 * This is the only code in MemoryRail that can talk to a network, and it is
 * off unless the user configures it. Memory text is sent to the configured
 * endpoint, so non-local endpoints need an explicit `allowRemote`.
 */

export interface EmbeddingsConfig {
  /** e.g. http://localhost:11434/v1 (the client appends /embeddings). */
  baseUrl: string;
  model: string;
  /** NAME of an environment variable holding the API key. The key itself is never stored. */
  apiKeyEnv?: string;
  dimensions?: number;
  /** Cosine similarity a memory must reach to count as a semantic match. Model-dependent. */
  minSimilarity?: number;
  /** Acknowledges that memory text is sent to a non-local endpoint. */
  allowRemote?: boolean;
}

export const DEFAULT_MIN_SIMILARITY = 0.5;
/** A match must also be within this much of the best match, so one query doesn't match everything. */
export const DEFAULT_MARGIN = 0.05;
/**
 * With three or more memories, the best match must also stand out from the median
 * score by this much. For a query that means nothing, every memory scores about the
 * same, and without this rule they would all "match".
 */
export const DEFAULT_CONTRAST = 0.05;
export const BATCH_SIZE = 32;

export function isLocalUrl(raw: string): boolean {
  let host: string;
  try {
    host = new URL(raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/** Lenient read of config.json: anything malformed counts as "not configured". */
export function parseEmbeddingsConfig(raw: unknown): EmbeddingsConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r["baseUrl"] !== "string" || typeof r["model"] !== "string" || !r["baseUrl"] || !r["model"]) return undefined;
  const cfg: EmbeddingsConfig = { baseUrl: r["baseUrl"], model: r["model"] };
  if (typeof r["apiKeyEnv"] === "string" && r["apiKeyEnv"]) cfg.apiKeyEnv = r["apiKeyEnv"];
  if (typeof r["dimensions"] === "number" && r["dimensions"] > 0) cfg.dimensions = r["dimensions"];
  if (typeof r["minSimilarity"] === "number") cfg.minSimilarity = r["minSimilarity"];
  if (r["allowRemote"] === true) cfg.allowRemote = true;
  return cfg;
}

export function assertUsable(cfg: EmbeddingsConfig): void {
  let url: URL;
  try {
    url = new URL(cfg.baseUrl);
  } catch {
    throw new Error(`embeddings baseUrl is not a valid URL: ${cfg.baseUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`embeddings baseUrl must be http or https, got ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("embeddings baseUrl must not contain credentials; put the key in an environment variable and set apiKeyEnv");
  }
  if (!isLocalUrl(cfg.baseUrl) && !cfg.allowRemote) {
    throw new Error(
      `${url.host} is not a local address, so memory text would be sent off this machine. ` +
        `If that is what you want, enable it explicitly with --allow-remote.`,
    );
  }
}

/** Identifies what produced a vector. Vectors from different models or endpoints must never be mixed. */
export function fingerprint(cfg: EmbeddingsConfig): string {
  return `${cfg.baseUrl.replace(/\/+$/, "")}|${cfg.model}|${cfg.dimensions ?? ""}`;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (!norm) throw new Error("embedding endpoint returned a zero vector");
  return v.map((x) => x / norm);
}

export interface EmbedderOptions {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class Embedder {
  readonly config: EmbeddingsConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly env: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;

  constructor(config: EmbeddingsConfig, opts: EmbedderOptions = {}) {
    assertUsable(config);
    this.config = config;
    this.fetchImpl = opts.fetch ?? fetch;
    this.env = opts.env ?? process.env;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  /** Returns unit-length vectors, in the same order as `texts`. */
  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      out.push(...(await this.batch(texts.slice(i, i + BATCH_SIZE))));
    }
    return out;
  }

  private async batch(input: string[]): Promise<number[][]> {
    const { baseUrl, model, apiKeyEnv, dimensions } = this.config;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKeyEnv) {
      const key = this.env[apiKeyEnv];
      if (!key) throw new Error(`environment variable ${apiKeyEnv} is not set`);
      headers["authorization"] = `Bearer ${key}`;
    }
    const body: Record<string, unknown> = { model, input };
    if (dimensions) body["dimensions"] = dimensions;

    let res: Response;
    try {
      res = await this.fetchImpl(`${baseUrl.replace(/\/+$/, "")}/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const why = e instanceof Error ? (e.name === "TimeoutError" ? `timed out after ${this.timeoutMs} ms` : e.message) : String(e);
      throw new Error(`could not reach the embeddings endpoint ${new URL(baseUrl).host}: ${why}`);
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`embeddings endpoint returned ${res.status}${text ? `: ${text}` : ""}`);
    }

    const json = (await res.json().catch(() => null)) as { data?: Array<{ embedding?: unknown; index?: number }> } | null;
    const data = json?.data;
    if (!Array.isArray(data) || data.length !== input.length) {
      throw new Error(`embeddings endpoint returned ${Array.isArray(data) ? data.length : "no"} vectors for ${input.length} inputs`);
    }
    const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return ordered.map((d) => {
      if (!Array.isArray(d.embedding) || d.embedding.length === 0 || !d.embedding.every((x) => typeof x === "number" && Number.isFinite(x))) {
        throw new Error("embeddings endpoint returned a malformed vector");
      }
      return normalize(d.embedding as number[]);
    });
  }
}
