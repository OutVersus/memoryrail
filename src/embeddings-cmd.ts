import fs from "node:fs";
import { parseArgs } from "node:util";
import { DEFAULT_CONTRAST, DEFAULT_MARGIN, DEFAULT_MIN_SIMILARITY, Embedder, assertUsable, isLocalUrl, type EmbeddingsConfig } from "./embeddings.js";
import { rank, semanticCandidates } from "./search.js";
import { describeEndpoint, indexPath, indexStatus, refreshIndex, semanticScores } from "./semantic.js";
import { refOf } from "./refs.js";
import { writeConfig, type Store } from "./store.js";

export const EMBEDDINGS_HELP = `memoryrail embeddings <command>

Optional semantic search: find memories by meaning, not just matching words.
Off by default. When on, memory text is sent to the embeddings endpoint you
configure (a local one such as Ollama keeps it on this machine).

Commands:
  setup --url <baseUrl> --model <name>    Turn it on and build the index
      --key-env <VAR>                       Env var holding the API key (the key is never stored)
      --dimensions <n>                      For models that support it
      --min-similarity <0..1>               Match threshold (default ${DEFAULT_MIN_SIMILARITY}; depends on the model)
      --allow-remote                        Required for a non-local URL: memory text leaves this machine
  status                                  Show the configuration and index (no network)
  index [--rebuild]                       Embed new and changed memories
  explain <query>                         Show how each memory scores, to tune --min-similarity
  off                                     Turn it off and delete the index

Example with Ollama:
  ollama pull nomic-embed-text
  memoryrail embeddings setup --url http://localhost:11434/v1 --model nomic-embed-text`;

const out = (s: string) => process.stdout.write(s.endsWith("\n") ? s : s + "\n");

class Usage extends Error {}

export async function runEmbeddings(args: string[], store: Store): Promise<number> {
  const [sub, ...rest] = args;
  if (!sub || sub === "help" || sub === "--help") {
    out(EMBEDDINGS_HELP);
    return 0;
  }
  const parse = <T extends Record<string, { type: "string" | "boolean" }>>(options: T) =>
    parseArgs({ args: rest, options, allowPositionals: true, strict: true });

  switch (sub) {
    case "setup": {
      const { values } = parse({
        url: { type: "string" },
        model: { type: "string" },
        "key-env": { type: "string" },
        dimensions: { type: "string" },
        "min-similarity": { type: "string" },
        "allow-remote": { type: "boolean" },
      });
      if (!values.url || !values.model) throw new Usage("usage: memoryrail embeddings setup --url <baseUrl> --model <name> [--key-env VAR]");
      const cfg: EmbeddingsConfig = { baseUrl: values.url, model: values.model };
      if (values["key-env"]) cfg.apiKeyEnv = values["key-env"];
      if (values.dimensions) {
        const d = Number(values.dimensions);
        if (!Number.isInteger(d) || d <= 0) throw new Usage("--dimensions must be a positive integer");
        cfg.dimensions = d;
      }
      if (values["min-similarity"]) {
        const s = Number(values["min-similarity"]);
        if (!(s >= 0 && s <= 1)) throw new Usage("--min-similarity must be between 0 and 1");
        cfg.minSimilarity = s;
      }
      if (values["allow-remote"]) cfg.allowRemote = true;

      assertUsable(cfg); // refuses a remote URL without --allow-remote, before any request
      const embedder = new Embedder(cfg);
      const [probe] = await embedder.embed(["memoryrail connection test"]);
      out(`Connected: ${describeEndpoint(cfg)}, ${probe?.length ?? 0}-dimensional vectors.`);
      writeConfig(store.root, { ...store.config(), embeddings: cfg });
      const r = await refreshIndex(store, embedder, { rebuild: true });
      out(`Indexed ${r.embedded} of ${r.total} memories. recall and precheck now use semantic search.`);
      out(
        isLocalUrl(cfg.baseUrl)
          ? "The index lives in .memoryrail/index/ and is not committed (git-ignored)."
          : "WARNING: the text of your memories is sent to that remote endpoint whenever they change or you search. Do not use this for memory you would not share with that provider.",
      );
      out(`If matches look too loose or too strict, run: memoryrail embeddings explain "<a query>"`);
      return 0;
    }

    case "status": {
      parse({});
      const cfg = store.config().embeddings;
      if (!cfg) {
        out("Semantic search is off (keyword search only). Turn it on with: memoryrail embeddings setup");
        return 0;
      }
      const s = indexStatus(store, cfg);
      out(`endpoint:        ${describeEndpoint(cfg)}`);
      out(`model:           ${cfg.model}${cfg.apiKeyEnv ? `  (key from $${cfg.apiKeyEnv})` : ""}`);
      out(`min similarity:  ${cfg.minSimilarity ?? DEFAULT_MIN_SIMILARITY} (also within ${DEFAULT_MARGIN} of the best match, and ${DEFAULT_CONTRAST} above the median)`);
      out(`index:           ${s.exists ? `${s.indexed}/${s.total} memories up to date${s.matchesConfig ? "" : " (built with a different model or endpoint)"}` : "not built yet"}`);
      if (s.stale) out(`${s.stale} memor${s.stale === 1 ? "y is" : "ies are"} new or changed; the next search (or \`memoryrail embeddings index\`) embeds them.`);
      return 0;
    }

    case "index": {
      const { values } = parse({ rebuild: { type: "boolean" } });
      const cfg = store.config().embeddings;
      if (!cfg) throw new Usage("semantic search is off. Run `memoryrail embeddings setup` first.");
      const r = await refreshIndex(store, new Embedder(cfg), { rebuild: values.rebuild });
      out(`Embedded ${r.embedded} memor${r.embedded === 1 ? "y" : "ies"} (${r.total} total).`);
      return 0;
    }

    case "explain": {
      const { positionals } = parse({});
      const query = positionals.join(" ").trim();
      if (!query) throw new Usage('usage: memoryrail embeddings explain "<query>"');
      const cfg = store.config().embeddings;
      if (!cfg) throw new Usage("semantic search is off. Run `memoryrail embeddings setup` first.");
      let failure = "";
      const sem = await semanticScores(store, query, { warn: (m) => (failure = m) });
      if (!sem) {
        process.stderr.write(`memoryrail: ${failure || "no scores"}\n`);
        return 1;
      }
      const memories = store.list().filter((m) => m.status === "active");
      const picked = new Set(semanticCandidates(memories, sem).map((m) => m.id));
      const lexical = new Set(rank(memories, query).filter((h) => h.score > 0.01).map((h) => h.memory.id));
      const rows = memories
        .map((m) => ({ m, s: sem.scores.get(m.id) }))
        .filter((r): r is { m: (typeof memories)[number]; s: number } => r.s !== undefined)
        .sort((a, b) => b.s - a.s)
        .slice(0, 15);
      out(`query: "${query}"   threshold: ${sem.minSimilarity}, within ${sem.margin} of the best, and ${sem.contrast} above the median\n`);
      out("score  semantic  keyword  memory");
      for (const r of rows) {
        out(`${r.s.toFixed(3)}  ${picked.has(r.m.id) ? "match   " : "        "}  ${lexical.has(r.m.id) ? "match  " : "       "}  [${refOf(r.m)}] ${r.m.title}`);
      }
      out(`\nRaise --min-similarity if unrelated memories match; lower it if related ones don't. Set it with: memoryrail embeddings setup (same url and model) --min-similarity <n>`);
      return 0;
    }

    case "off": {
      parse({});
      const config = store.config();
      delete config.embeddings;
      writeConfig(store.root, config);
      fs.rmSync(indexPath(store.root), { force: true });
      out("Semantic search is off and the index is deleted. Search uses keywords only.");
      return 0;
    }

    default:
      throw new Usage(`unknown command "embeddings ${sub}". Run \`memoryrail embeddings help\`.`);
  }
}

export { Usage as EmbeddingsUsageError };
