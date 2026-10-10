/**
 * Memory is committed to git and fed back to models, so a secret written once
 * is published and re-sent forever. Scan on write and refuse.
 *
 * Findings carry only the rule name, never the matched text.
 */

export interface SecretFinding {
  rule: string;
}

const MIXED = String.raw`(?=[^\s'"]*\d)(?=[^\s'"]*[A-Za-z])[^\s'"]{8,}`;

const RULES: Array<[string, RegExp]> = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["stripe-key", /\b[rs]k_live_[A-Za-z0-9]{16,}\b/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["openai-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ["url-credentials", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{3,}@/i],
  [
    "credential-assignment",
    new RegExp(String.raw`\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth)\w*\s*[:=]\s*['"]?${MIXED}`, "i"),
  ],
];

export function scanSecrets(...texts: Array<string | undefined>): SecretFinding[] {
  const found = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const [rule, re] of RULES) if (re.test(t)) found.add(rule);
  }
  return [...found].map((rule) => ({ rule }));
}

export class SecretError extends Error {
  constructor(readonly findings: SecretFinding[]) {
    super(
      `refusing to save: looks like it contains a secret (${findings.map((f) => f.rule).join(", ")}). ` +
        `Describe where the secret lives instead of what it is. Humans can override with --allow-secrets.`,
    );
  }
}
