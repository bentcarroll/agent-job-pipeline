// Retain the head and tail of bounded posting text: role scope often appears
// near the start, while compensation and location conditions may appear last.
// Truncation remains explicit evidence uncertainty for screening.
export const MAX_DESCRIPTION_CHARS = 8000;

// Normalize and bound compensation HTML before model and Slack use.
export const MAX_COMPENSATION_CHARS = 400;

// The materials path reads the whole posting. MAX_DESCRIPTION_CHARS bounds
// per-posting screening spend on a match/no-match decision; reusing it here
// would tailor a resume against a budget artifact whose elided middle is
// usually the responsibilities the hiring argument is built from. This bound
// only guards against a pathological page.
export const MAX_MATERIALS_CHARS = 100000;
const HEAD_CHARS = 5000;
const ELISION = "\n\n… [middle of posting omitted] …\n\n";

export type TextProvenance = {
  provided: boolean;
  // Counts normalized plain text, not raw HTML. Null means no string was observed.
  originalChars: number | null;
  // Includes any omission marker in the returned text.
  retainedChars: number;
  truncated: boolean | null;
  sourceFields: string[];
  normalizerVersion: string;
};

const NORMALIZER_VERSION = "plain-text-v3";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// Returns readable plain text, or null when the posting has no usable body.
// Handles both real HTML (Ashby, Lever) and Greenhouse's entity-encoded
// HTML, which needs decoding before its tags can be stripped at all.
export function htmlToText(raw: string | null | undefined, limit: number = MAX_DESCRIPTION_CHARS): string | null {
  return htmlToTextWithProvenance(raw, limit).text;
}

// This records retention of observed provider text, never completeness of the
// entire posting. An empty string is observed input; an absent field is unknown.
export function htmlToTextWithProvenance(
  raw: unknown,
  limit: number = MAX_DESCRIPTION_CHARS,
  sourceFields: string[] = [],
): { text: string | null; provenance: TextProvenance } {
  const provenance: TextProvenance = {
    provided: typeof raw === "string", originalChars: null, retainedChars: 0,
    truncated: null, sourceFields: [...sourceFields], normalizerVersion: NORMALIZER_VERSION,
  };
  if (typeof raw !== "string") return { text: null, provenance };

  let text = decodeEntities(raw);
  text = text
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    // `li` is absent by design: <li> already opened its own line above, so
    // closing it too would double-space every bullet.
    .replace(/<\/(p|div|h[1-6]|tr|ul|ol|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  // Entities that were themselves encoded (&amp;nbsp;) survive the first
  // pass as literal text; this catches them.
  text = decodeEntities(text);

  text = text
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  provenance.originalChars = text.length;
  provenance.truncated = text.length > limit;
  const retained = truncate(text, limit) || null;
  provenance.retainedChars = retained?.length ?? 0;
  return { text: retained, provenance };
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= 0) return "";
  // A limit below the head budget (compensation, say) is a plain head cut:
  // there is no "middle" worth eliding in a field that short.
  if (limit <= HEAD_CHARS) return `${cutForward(text.slice(0, limit - 1))}…`;
  const headBudget = Math.min(HEAD_CHARS, limit - ELISION.length - 1);
  const head = cutForward(text.slice(0, headBudget));
  const tailBudget = limit - headBudget - ELISION.length;
  const tail = cutBackward(text.slice(text.length - tailBudget));
  const plain = `${head}${ELISION}${tail}`;
  // A long EEO or benefits block at the end can push the salary line out of
  // the tail into the elided middle, which reads to screening as no pay
  // disclosed. Pay lines found there are kept between two elisions. The tail
  // gives up only the room they and the second elision take, and a line the
  // shortened tail still holds is not repeated.
  const minTail = tailBudget - ELISION.length - MAX_PAY_CHARS;
  if (minTail <= 0) return plain;
  // When any line after the head names pay or gives a range, other amounts
  // (a budget, a stipend) are left out so they can't read as the salary.
  const all = payCandidates(text, head.length, text.length);
  const candidates = (all.some(c => c.rank < 2) ? all.filter(c => c.rank < 2) : all).filter(c => c.start < text.length - minTail);
  if (!candidates.some(c => c.start < text.length - tail.length)) return plain;
  let kept = selectPayLines(candidates);
  for (;;) {
    const middle = kept.map(c => c.excerpt).join("\n");
    const shortTail = cutBackward(text.slice(text.length - (tailBudget - ELISION.length - middle.length)));
    const tailStart = text.length - shortTail.length;
    const outside = kept.filter(c => c.start < tailStart);
    if (!outside.length) return plain;
    if (outside.length === kept.length) return `${head}${ELISION}${middle}${ELISION}${shortTail}`;
    kept = outside;
  }
}

const MAX_PAY_CHARS = 600;
// "$209,000", "£95,000", "€120k": a currency sign before an annual-scale amount.
const PAY_AMOUNT = /[$£€]\s?\d{2,3}(?:,\d{3})+|[$£€]\s?\d{2,3}(?:\.\d+)?\s?[kK]\b/;
const PAY_AMOUNTS = new RegExp(PAY_AMOUNT.source, "g");
// Words that make an amount the role's pay rather than a budget, stipend or fund.
const PAY_WORD = /\b(salary|salaries|compensation|base pay|pay range|pay band|pay|wage|hourly rate|OTE|on-target earnings)\b/i;

type PayCandidate = { start: number; excerpt: string; rank: number };

// Lines starting in [from, to) that carry an amount. Rank 0 names pay, rank 1
// is a bare range (common under a "Salary" heading), rank 2 is any other amount.
function payCandidates(text: string, from: number, to: number): PayCandidate[] {
  const out: PayCandidate[] = [];
  let start = 0;
  for (const line of text.split("\n")) {
    const at = line.search(PAY_AMOUNT);
    if (start >= from && start < to && at >= 0) {
      const excerpt = line.length <= 300 ? line : cutForward(cutBackward(line.slice(Math.max(0, at - 100), at + 200)));
      const rank = PAY_WORD.test(line) ? 0 : (line.match(PAY_AMOUNTS)?.length ?? 0) >= 2 ? 1 : 2;
      out.push({ start, excerpt, rank });
    }
    start += line.length + 1;
  }
  return out;
}

// The most pay-like lines first, within MAX_PAY_CHARS, returned in document order.
function selectPayLines(candidates: PayCandidate[]): PayCandidate[] {
  const kept: PayCandidate[] = [];
  let used = 0;
  for (const c of [...candidates].sort((a, b) => a.rank - b.rank || a.start - b.start)) {
    if (used + c.excerpt.length + 1 > MAX_PAY_CHARS) continue;
    kept.push(c);
    used += c.excerpt.length + 1;
  }
  return kept.sort((a, b) => a.start - b.start);
}

// Both cuts land on whitespace so GLM never sees a severed word that reads
// as a different one — "Secret" out of "Secretary" would invent a clearance
// requirement that the posting never stated.
function cutForward(chunk: string): string {
  const boundary = chunk.lastIndexOf(" ");
  return (boundary > chunk.length * 0.8 ? chunk.slice(0, boundary) : chunk).trimEnd();
}

function cutBackward(chunk: string): string {
  const boundary = chunk.indexOf(" ");
  return (boundary >= 0 && boundary < chunk.length * 0.2 ? chunk.slice(boundary) : chunk).trimStart();
}
