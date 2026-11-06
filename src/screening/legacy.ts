import { enforcePolicyVerdict, settled } from "../config/policy";
import type { CandidatePolicy, RuntimeConfig } from "../config/types";
import type { Verdict } from "../criteria";
import { enforceLocationVerdict } from "../location";
import type { CompanyCategory, NormalizedJob } from "../sources";
import { createPostingSnapshot } from "./snapshot";
import type { LegacyScreening, ScreeningResult } from "./types";

export const LEGACY_SCREENING_VERSIONS = { promptVersion: "legacy-verdict-v1", model: "@cf/zai-org/glm-5.3-flash" } as const;

/** Settle a legacy model verdict against the approved policy and location
 * rules. A rejection from either rule set outranks a review: a role proved
 * ineligible needs no card. Gaps from both are kept for the card. */
export function settleVerdict(job: NormalizedJob, verdict: Verdict, policy: CandidatePolicy, category?: CompanyCategory): LegacyScreening {
  const checked = enforcePolicyVerdict(job, verdict, policy, category);
  if (!checked.verdict.match) return checked;
  const located = enforceLocationVerdict(job, checked.verdict, policy);
  if (!located.verdict.match) return located;
  return settled(verdict, [...checked.gaps, ...located.gaps]);
}

/** A legacy needs_review is stored and delivered the way evidence screening
 * stores its own: one evaluation with the posting snapshot, so the card is
 * posted once and the gaps travel with it. */
export async function legacyReviewResult(job: NormalizedJob, category: CompanyCategory | undefined, screening: LegacyScreening, config: RuntimeConfig): Promise<ScreeningResult> {
  if (screening.state !== "needs_review") throw new Error("Only a needs_review legacy screening is stored as an evaluation");
  const snapshot = await createPostingSnapshot(job, category);
  // Like an evidence needs_review, the lane is left open: a lane gap is one of
  // the things the card asks the person to confirm.
  return { snapshot, decision: {
    state: "needs_review", lane: null, hardExclude: null,
    reason: screening.verdict.reason,
    evidence: [], gaps: screening.gaps.map(gap => gap.reason), qualificationWarnings: [],
    criteriaVersion: config.criteriaVersion, ...LEGACY_SCREENING_VERSIONS,
  } };
}
