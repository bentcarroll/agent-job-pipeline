import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filterJob as rawFilterJob, type FilterEnv } from "./filter";
import { parseVerdict } from "./criteria";
import { evaluateJob, parseScreeningResponse } from "./screening/evaluate";
import { loadRuntimeConfig } from "./config/candidate";
import { createPostingSnapshot as rawCreatePostingSnapshot } from "./screening/snapshot";
import { CHICAGO_OPERATIONS } from "../tests/fixtures/candidates";
import { completePosting, fact } from "../tests/fixtures/policy-postings";
const positive = { match: true, lane: "A", hard_exclude: null, reason: "Operations fit." };
const response = (args: string, name = "record_verdict") => ({ choices: [{ message: { tool_calls: [{ function: { name, arguments: args } }] }, finish_reason: "tool_calls" }] });
async function env(run: (...args: unknown[]) => Promise<unknown>): Promise<FilterEnv> {
  return { runtime: await loadRuntimeConfig(CHICAGO_OPERATIONS), AI_GATEWAY_ID: "synthetic", AI: { run } as unknown as Ai };
}
let telemetry: Record<string,unknown>[];
beforeEach(()=>{telemetry=[];const original=console.log;vi.spyOn(console,"log").mockImplementation((...args)=>{try{const value=JSON.parse(String(args[0]));if(args.length===1&&value.event==="model_attempt"){expect(value).toMatchObject({jobId:expect.any(String),attempt:expect.any(Number),outcome:expect.any(String)});telemetry.push(value);return;}}catch{}original(...args);throw new Error("Unexpected model diagnostic");});});
afterEach(() => vi.restoreAllMocks());

describe("synthetic model response regressions", () => {
  it.each([
    '{"match":true,"lane":"A",',
    JSON.stringify({ ...positive, hard_exclude: "3" }),
    JSON.stringify({ ...positive, reason: "" }),
    JSON.stringify({ ...positive, lane: null }),
  ])("rejects malformed or contradictory positive verdicts: %s", args => {
    expect(() => parseVerdict(args)).toThrow();
  });
  it.each(['{"match":false,"reason":"unterminated', '{"match":false}', JSON.stringify({match:false,lane:null,hard_exclude:"99",reason:"Unknown pay"}), JSON.stringify({match:false,lane:"C",hard_exclude:null,reason:"Unknown"})])("retries invalid negative output: %s", async args => {
    expect(() => parseVerdict(args)).toThrow();
    const run = vi.fn(async () => response(args));
    await expect(filterJob(await env(run), completePosting())).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("records a no-function-fit decision on an incomplete posting instead of retrying it", async () => {
    const noFit = {match:false,lane:null,hard_exclude:null,reason:"No function fit"};
    const run = async () => response(JSON.stringify(noFit));
    expect(await filterJob(await env(run), completePosting({description:null}))).toEqual({ state: "no_match", verdict: noFit, gaps: [] });
  });
  it("normalizes the provider's literal null only in the binary contract", () => {
    expect(parseVerdict(JSON.stringify({ ...positive, hard_exclude: "null" }))).toEqual(positive);
  });
  it.each(["wrong_tool", "duplicate"])("rejects %s tool output", async kind => {
    const result = response(JSON.stringify(positive), kind === "wrong_tool" ? kind : "record_verdict");
    if (kind === "duplicate") result.choices[0].message.tool_calls.push(result.choices[0].message.tool_calls[0]);
    await expect(filterJob(await env(async () => result), completePosting())).rejects.toThrow(/unexpected screening tool/);
  });
  it("resamples truncated output and recovers a complete decision", async () => {
    const run = vi.fn().mockResolvedValueOnce({ choices: [{ message: {}, finish_reason: "length" }], usage: { completion_tokens: 4000 } }).mockResolvedValueOnce(response(JSON.stringify(positive)));
    expect(await filterJob(await env(run), completePosting())).toEqual({ state: "match", verdict: positive, gaps: [] });
    expect(run).toHaveBeenCalledTimes(2);
    expect(telemetry).toHaveLength(2);
    expect(run.mock.calls[0][0]).toBe("@cf/zai-org/glm-5.3-flash");
  });
  it("does not invent a rejection when no tool call comes back", async () => {
    const run = vi.fn().mockResolvedValue({ choices: [{ message: {}, finish_reason: "length" }], usage: { completion_tokens: 4000 } });
    await expect(filterJob(await env(run), completePosting())).rejects.toThrow(/no tool call returned/);
    expect(run).toHaveBeenCalledTimes(2);
    expect(telemetry).toHaveLength(2);
  });
  it("records runtime provenance on transport retries", async () => {
    const result = await evaluateJob(await env(async () => { throw new Error("synthetic transport failure"); }), completePosting());
    expect(result.decision).toMatchObject({ state: "retry", criteriaVersion: "d5c13c7f8c8abbc3dc82f607241ac34aa14b2b0b5f4fb212944fa8e72406f7e6" });
  });
  it("requires explicit wire enums and anchored positive evidence", async () => {
    const snapshot = await createPostingSnapshot(completePosting());
    const runtime = await loadRuntimeConfig(CHICAGO_OPERATIONS);
    const raw = { state: "match", lane: "A", hardExclude: "none", reason: "Fit", gaps: [], evidence: [fact("function", "description", "Lead operations and improve workflows."), fact("location", "location", "Chicago, IL")] };
    expect(parseScreeningResponse(JSON.stringify(raw), snapshot, runtime).state).toBe("match");
    expect(() => parseScreeningResponse(JSON.stringify({ ...raw, hardExclude: null }), snapshot, runtime)).toThrow(/wire enums/);
    expect(() => parseScreeningResponse('{"state":"match",', snapshot, runtime)).toThrow();
    expect(parseScreeningResponse(JSON.stringify({ ...raw, evidence: [] }), snapshot, runtime).state).toBe("needs_review");
  });
});

// Seen live: told that unresolved eligibility supports neither verdict but
// given only two to choose from, the model hedged with a no-match that still
// named the fitting lane, and the parser refused it twice per posting.
describe("the model can say it cannot decide", () => {
  const hedge = { verdict: "needs_review", lane: "A", hard_exclude: null, reason: "Eligibility unresolved." };
  it("accepts a needs_review verdict that names the fitting lane", () => {
    expect(parseVerdict(JSON.stringify(hedge))).toEqual({ match: false, lane: "A", hard_exclude: null, reason: "Eligibility unresolved.", review: true });
    expect(parseVerdict(JSON.stringify({ ...hedge, lane: null }))).toMatchObject({ match: false, lane: null, review: true });
  });
  it("accepts the verdict enum for match and no_match without a review flag", () => {
    expect(parseVerdict(JSON.stringify({ verdict: "match", lane: "A", hard_exclude: null, reason: "Operations fit." }))).toEqual(positive);
    expect(parseVerdict(JSON.stringify({ verdict: "no_match", lane: null, hard_exclude: "3", reason: "Below the floor." }))).toEqual({ match: false, lane: null, hard_exclude: "3", reason: "Below the floor." });
  });
  it("reads the live hedge, a no-match that still names a lane, as the model declining to decide", () => {
    expect(parseVerdict(JSON.stringify({ match: false, lane: "A", hard_exclude: null, reason: "Requires review rather than a confident verdict." })))
      .toEqual({ match: false, lane: "A", hard_exclude: null, reason: "Requires review rather than a confident verdict.", review: true });
  });
  it.each([
    JSON.stringify({ ...hedge, hard_exclude: "2" }),
    JSON.stringify({ verdict: "match", lane: "A", hard_exclude: "3", reason: "Mixed." }),
    JSON.stringify({ verdict: "maybe", lane: "A", hard_exclude: null, reason: "Unknown state." }),
    JSON.stringify({ verdict: "match", match: true, lane: "A", hard_exclude: null, reason: "Both spellings." }),
  ])("still rejects a contradictory or unknown verdict: %s", args => {
    expect(() => parseVerdict(args)).toThrow();
  });
  it("tells the model about the third option", async () => {
    const { buildCriteriaPrompt } = await import("./config/prompts");
    expect(buildCriteriaPrompt(await loadRuntimeConfig(CHICAGO_OPERATIONS))).toMatch(/needs_review/);
  });
});

// Seen live at the model's default (maximum) reasoning effort: 75 to 174
// seconds a call, and the 4,000-token answer budget spent on reasoning with
// no tool call at the end. At low effort the same postings answered in 7 to
// 17 seconds with valid verdicts.
describe("legacy screening reasoning effort", () => {
  it("asks for low effort unless the Worker is told otherwise", async () => {
    for (const [configured, expected] of [[undefined, "low"], ["high", "high"], ["low", "low"], ["max", undefined]] as const) {
      const run = vi.fn(async () => response(JSON.stringify(positive)));
      const configuredEnv = { ...(await env(run)), ...(configured === undefined ? {} : { SCREENING_REASONING_EFFORT: configured }) };
      await filterJob(configuredEnv, completePosting());
      expect((run.mock.calls[0] as unknown[])[1]).toMatchObject(expected === undefined ? {} : { reasoning_effort: expected });
      if (expected === undefined) expect((run.mock.calls[0] as unknown[])[1]).not.toHaveProperty("reasoning_effort");
    }
  });
  it("refuses an unsupported configured effort instead of silently using the default", async () => {
    const run = vi.fn(async () => response(JSON.stringify(positive)));
    await expect(filterJob({ ...(await env(run)), SCREENING_REASONING_EFFORT: "medium" } as FilterEnv, completePosting())).rejects.toThrow(/effort/);
    expect(run).not.toHaveBeenCalled();
  });
});

const filterJob: typeof rawFilterJob = (env,job,category="applied AI",options) => rawFilterJob(env,job,category,options);

const createPostingSnapshot: typeof rawCreatePostingSnapshot = (job,category="applied AI") => rawCreatePostingSnapshot(job,category);
