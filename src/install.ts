import fs from "node:fs";
import path from "node:path";

export type Client = "claude" | "cursor";

export const CLIENT_FILES: Record<Client, string> = {
  claude: ".mcp.json", // Claude Code project-scoped MCP servers
  cursor: ".cursor/mcp.json",
};

export interface InstallResult {
  client: Client;
  file: string;
  action: "created" | "updated" | "unchanged";
}

export function serverEntry(opts: { npx?: boolean } = {}): { command: string; args: string[] } {
  return opts.npx ? { command: "npx", args: ["-y", "memoryrail", "serve"] } : { command: "memoryrail", args: ["serve"] };
}

/**
 * Register the MemoryRail MCP server in a client's project config, keeping
 * every other server and setting in the file. Refuses to touch invalid JSON.
 */
export function installMcp(root: string, client: Client, opts: { npx?: boolean } = {}): InstallResult {
  const rel = CLIENT_FILES[client];
  const abs = path.join(root, rel);
  const entry = serverEntry(opts);

  let doc: Record<string, unknown> = {};
  const exists = fs.existsSync(abs);
  if (exists) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(abs, "utf8"));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      doc = parsed as Record<string, unknown>;
    } catch (e) {
      throw new Error(`${rel} is not valid JSON (${e instanceof Error ? e.message : String(e)}); fix it first. Nothing was changed.`);
    }
  }

  const servers =
    doc["mcpServers"] && typeof doc["mcpServers"] === "object" && !Array.isArray(doc["mcpServers"])
      ? (doc["mcpServers"] as Record<string, unknown>)
      : {};
  if (JSON.stringify(servers["memoryrail"]) === JSON.stringify(entry)) {
    return { client, file: rel, action: "unchanged" };
  }
  const next = { ...doc, mcpServers: { ...servers, memoryrail: entry } };
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(next, null, 2) + "\n");
  return { client, file: rel, action: exists ? "updated" : "created" };
}

export function isInstalled(root: string, client: Client): boolean {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(root, CLIENT_FILES[client]), "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    return Boolean(doc.mcpServers && "memoryrail" in doc.mcpServers);
  } catch {
    return false;
  }
}
