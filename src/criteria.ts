export const VERDICT_TOOL = {
  type: "function" as const,
  function: {
    name: "record_verdict",
    description: "Record the match verdict for this job posting",
    parameters: {
      type: "object",
      properties: {
        verdict: {
          type: "string",
          enum: ["match", "no_match", "needs_review"],
          description: "match: surface this posting; no_match: a supported hard exclusion, or no function fit; needs_review: eligibility cannot be settled from the posting",
        },
        hard_exclude: {
          type: ["string", "null"],
          enum: ["1", "2", "3", "4", null],
          description: "For a no_match, which hard-exclude rule triggered (1-4); otherwise null",
        },
        lane: {
          type: ["string", "null"],
          enum: ["A", "B", null],
          description: "The function-fit lane for a match, the fitting lane if any for a needs_review, or null",
        },
        reason: { type: "string", description: "One sentence explaining the verdict" },
      },
      required: ["verdict", "reason", "lane", "hard_exclude"],
      additionalProperties: false,
    },
  },
};

// review marks the model's own needs_review: it could not settle eligibility
// from the posting. match is false for it, and the lane, if any, is the one
// the responsibilities fit.
export type Verdict = {
  match: boolean;
  hard_exclude: string | null;
  lane: "A" | "B" | null;
  reason: string;
  review?: true;
};

const WIRE_KEYS = { verdict: "hard_exclude,lane,reason,verdict", match: "hard_exclude,lane,match,reason" };
const contradictory = () => new Error("verdict contains unsupported or contradictory fields");

export function parseVerdict(argsJson: string): Verdict {
  let parsed;
  try { parsed = JSON.parse(argsJson); }
  catch { throw new Error("verdict requires complete, valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("verdict requires the complete supported wire contract");
  // The current contract names the verdict. The earlier boolean contract is
  // still read, so a model that remembers it is not refused.
  const keys = Object.keys(parsed).sort().join(",");
  let state: "match" | "no_match" | "needs_review";
  if (keys === WIRE_KEYS.verdict && ["match", "no_match", "needs_review"].includes(parsed.verdict)) state = parsed.verdict;
  else if (keys === WIRE_KEYS.match && typeof parsed.match === "boolean") state = parsed.match ? "match" : "no_match";
  else throw new Error("verdict requires the complete supported wire contract");
  if (typeof parsed.reason !== "string" || !parsed.reason.trim()) throw new Error("verdict requires the complete supported wire contract");
  // Retain the supported provider spelling for an explicit null exclusion.
  const hardExclude = parsed.hard_exclude === "null" ? null : parsed.hard_exclude;
  if (![null, "1", "2", "3", "4"].includes(hardExclude) || ![null, "A", "B"].includes(parsed.lane)) throw contradictory();
  // Seen live: told that unresolved eligibility supports neither verdict, the
  // model answered no_match and still named the fitting lane. That is the
  // model declining to decide, not a function-fit rejection.
  if (state === "no_match" && hardExclude === null && parsed.lane !== null) state = "needs_review";
  if (state === "match" && (hardExclude !== null || parsed.lane === null)) throw contradictory();
  if (state === "needs_review" && hardExclude !== null) throw contradictory();
  const verdict: Verdict = { match: state === "match", hard_exclude: hardExclude, lane: parsed.lane, reason: parsed.reason };
  return state === "needs_review" ? { ...verdict, review: true } : verdict;
}
