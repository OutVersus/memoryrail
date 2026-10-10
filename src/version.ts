import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Read from package.json so the CLI, the MCP server and npm can never disagree. */
export const VERSION: string = (require("../package.json") as { version: string }).version;
