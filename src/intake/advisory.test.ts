import { describe, expect, it, vi } from "vitest";
import { displayVerdict, sendManualCard } from "./delivery";
import type { ManualCard } from "./types";

const fit = { match: true, lane: "A" as const, hard_exclude: null, reason: "Operations fit." };
const card = (overrides: Partial<ManualCard>): ManualCard => ({
  requestId: "a".repeat(64), userId: "USYNTHETIC", selectedAt: "2026-02-02T12:00:00Z", verdict: null, advisoryError: null, gaps: [],
  job: { id: "greenhouse:synthetic:1", company: "Synthetic Works", title: "Operations Lead", url: "https://job-boards.greenhouse.io/synthetic/jobs/1",
    location: "Remote-Friendly, United States", department: null, isRemote: null, employmentType: null, postedAt: null, compensation: null, description: null } as unknown as ManualCard["job"],
  ...overrides,
});

// A /job posting the policy could not fully confirm used to read as a provider
// failure in Slack. It is a possible match with named gaps, like a discovery card.
describe("manual intake advisory display", () => {
  it("shows a possible match with gaps as a review, naming what to check", () => {
    const shown = displayVerdict(card({ verdict: fit, gaps: ["The employment arrangement is stated ambiguously; your profile allows full-time."] }));
    expect(shown).toMatchObject({ match: true, lane: "A" });
    expect(shown.reason).toMatch(/^Added by hand\. Operations fit\. Needs review: The employment arrangement is stated ambiguously/);
    expect(shown.reason).not.toMatch(/unavailable/);
  });
  it("shows the model's own needs_review once, not as a disagreement", () => {
    const hedge = { match: false, lane: "A" as const, hard_exclude: null, reason: "Eligibility unresolved.", review: true as const };
    const shown = displayVerdict(card({ verdict: hedge, gaps: ["Eligibility unresolved."] }));
    expect(shown.reason).toBe("Added by hand. Needs review: Eligibility unresolved.");
    expect(shown.match).toBe(true);
  });
  it("still says screening was unavailable only for a provider failure", () => {
    expect(displayVerdict(card({ advisoryError: "provider_error" })).reason).toMatch(/unavailable/);
    expect(displayVerdict(card({ verdict: fit })).reason).toBe("Added by hand. Operations fit.");
  });
  it("posts each gap as its own line under a heading the person can act on", async () => {
    const posted: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => { posted.push(JSON.parse(init.body)); return Response.json({ ok: true, channel: "CSYNTHETIC", ts: "1700000000.000100" }); }));
    try {
      const outcome = await sendManualCard({ SLACK_BOT_TOKEN: "synthetic", SLACK_CHANNEL_ID: "CSYNTHETIC" } as any,
        card({ verdict: fit, gaps: ["Lane A is limited to applied AI companies in your profile; this company's category is not verified.", "Remote eligibility is not stated."] }), "manual:greenhouse:synthetic:1");
      expect(outcome.kind).toBe("accepted");
      const text = JSON.stringify(posted[0].blocks);
      expect(text).toMatch(/To confirm/);
      expect(text).toMatch(/• Lane A is limited to applied AI companies/);
      expect(text).toMatch(/• Remote eligibility is not stated\./);
    } finally { vi.unstubAllGlobals(); }
  });
});
