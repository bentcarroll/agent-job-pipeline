import { describe, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ WorkflowEntrypoint: class {} }));
import { advisoryFailure } from "./workflow";
import { displayVerdict } from "./delivery";
import { LocationEligibilityError } from "../location";
import type { ManualCard } from "./types";

const card = (advisoryError: string | null): ManualCard => ({
  requestId: "a".repeat(64), userId: "USYNTHETIC", selectedAt: "2026-02-02T12:00:00Z", verdict: null, advisoryError,
  job: { id: "greenhouse:synthetic:1", company: "Synthetic Works", title: "Operations Lead", url: "https://job-boards.greenhouse.io/synthetic/jobs/1",
    location: "Remote-Friendly, United States", department: null, isRemote: null, employmentType: null, postedAt: null, compensation: null, description: null } as unknown as ManualCard["job"],
});

describe("manual intake advisory failures", () => {
  // A /job posting whose location the policy can't settle used to read as a
  // provider failure in Slack; scheduled discovery already calls it a review.
  it("labels a location the policy can't settle as a review, and anything else as a provider error", () => {
    expect(advisoryFailure(new LocationEligibilityError("Remote eligibility is not stated"))).toBe("location_review");
    expect(advisoryFailure(new Error("Workers AI unavailable"))).toBe("provider_error");
    expect(advisoryFailure("not an error")).toBe("provider_error");
  });

  it("tells the person to check the location instead of saying screening was unavailable", () => {
    expect(displayVerdict(card("location_review")).reason).toMatch(/could not settle the location/);
    expect(displayVerdict(card("location_review")).reason).not.toMatch(/unavailable/);
    expect(displayVerdict(card("provider_error")).reason).toMatch(/unavailable/);
  });
});
