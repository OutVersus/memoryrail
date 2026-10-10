import { createHash } from "node:crypto";
import type { Memory, MemoryType } from "./types.js";

const PREFIX: Record<MemoryType, string> = {
  decision: "DEC",
  constraint: "CON",
  gotcha: "GOT",
  attempt: "ATT",
  thread: "THR",
  session: "SES",
};

/**
 * A short, stable handle for citing a memory, e.g. `DEC-a3f9`.
 * Derived from the id, so it is never stored and two branches can never
 * allocate the same counter value.
 */
export function refOf(m: Pick<Memory, "id" | "type">): string {
  return `${PREFIX[m.type]}-${createHash("sha1").update(m.id).digest("hex").slice(0, 4)}`;
}

export const REF_PATTERN = /^[A-Za-z]{3}-[0-9a-f]{4}$/;
