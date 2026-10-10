/**
 * Minimal frontmatter codec. Values are written as JSON, which is a valid
 * subset of YAML, so the files stay readable by any YAML tooling while this
 * package needs no YAML dependency.
 */

export interface Parsed {
  data: Record<string, unknown>;
  body: string;
}

export function parse(text: string): Parsed {
  const src = text.replace(/\r\n/g, "\n");
  if (!src.startsWith("---\n")) {
    throw new Error("missing frontmatter (file must start with ---)");
  }
  const rest = src.slice(4);
  let end = rest.indexOf("\n---\n");
  let bodyStart: number;
  if (end !== -1) {
    bodyStart = end + 5;
  } else if (rest.endsWith("\n---")) {
    end = rest.length - 4;
    bodyStart = rest.length;
  } else if (rest.startsWith("---\n")) {
    end = 0;
    bodyStart = 4;
  } else {
    throw new Error("unterminated frontmatter (missing closing ---)");
  }

  const data: Record<string, unknown> = {};
  const block = end === 0 ? "" : rest.slice(0, end);
  for (const [i, line] of block.split("\n").entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (!m) throw new Error(`invalid frontmatter line ${i + 2}: ${line}`);
    data[m[1]!] = parseValue(m[2]!);
  }
  return { data, body: rest.slice(bodyStart).replace(/^\n+/, "").replace(/\s+$/, "") };
}

function parseValue(raw: string): unknown {
  const v = raw.trim();
  if (v === "") return "";
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export function stringify(data: Record<string, unknown>, body: string): string {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  const trimmed = body.replace(/\s+$/, "");
  return `---\n${lines.join("\n")}\n---\n${trimmed ? `\n${trimmed}\n` : ""}`;
}
