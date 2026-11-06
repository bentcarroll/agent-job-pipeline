import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRuntimeConfig } from "../../src/config/candidate";
import { evaluateJob } from "../../src/screening/evaluate";
import { filterJob as rawFilterJob } from "../../src/filter";
import { BOSTON_ENGINEERING, CHICAGO_OPERATIONS } from "../fixtures/candidates";
import { completePosting, fact } from "../fixtures/policy-postings";
import type { FilterEnv } from "../../src/filter";

describe("configured model boundary and deterministic policy", () => {
  it("screens engineering with its approved profile and records the identical version", async () => {
    const runtime = await loadRuntimeConfig(BOSTON_ENGINEERING);
    const job = completePosting({ location: "Boston, MA", description: "Build software and lead engineering delivery.", compensation: "Annual base salary USD 170,000 - USD 190,000" });
    let policyPrompt = "";
    const env = { runtime, AI_GATEWAY_ID: "synthetic", AI: { run: async (_model: string, input: { messages: { content: string }[] }) => {
      policyPrompt = input.messages[0].content;
      return { choices: [{ message: { tool_calls: [{ type: "function", function: { name: "record_screening_decision", arguments: JSON.stringify({ state: "match", lane: "A", hardExclude: "none", reason: "Engineering fits.", gaps: [], evidence: [fact("function", "description", job.description!), fact("location", "location", job.location)] }) } }] }, finish_reason: "tool_calls" }] };
    } } } as unknown as FilterEnv;
    const result = await evaluateJob(env, job, "applied AI");
      expect(policyPrompt).toContain(runtime.criteriaVersion);
      expect(policyPrompt).toContain("Software engineering");
      expect(policyPrompt).toContain("160000");
      expect(policyPrompt).not.toMatch(/USD150000|Pure software engineering/);

    expect(result.decision).toMatchObject({ state: "match", criteriaVersion: "b62f625205395fbb19dec5eef924b87560852185f86a41608478f8e19b6ef8da" });
    expect(result.decision.evidence.every(e => e.snapshotId === result.snapshot.id)).toBe(true);
  });
  it("overrides a legacy positive when comparable salary is below this candidate's floor", async () => {
    const runtime = await loadRuntimeConfig(BOSTON_ENGINEERING);
    const env = { runtime, AI_GATEWAY_ID: "synthetic", AI: { run: async () => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "record_verdict", arguments: JSON.stringify({ match: true, lane: "A", hard_exclude: null, reason: "Possible fit." }) } }] }, finish_reason: "tool_calls" }] }) } } as unknown as FilterEnv;
    expect(await filterJob(env, completePosting({ location: "Boston, MA", compensation: "Annual base salary USD 110,000 - USD 120,000" }), "applied AI")).toMatchObject({ state: "no_match", verdict: { match: false, hard_exclude: "3" } });
    expect(await filterJob({ ...env, runtime: await loadRuntimeConfig(CHICAGO_OPERATIONS) }, completePosting({ compensation: "Annual base salary USD 110,000 - USD 120,000" }), "applied AI")).toMatchObject({ state: "match", gaps: [] });
  });
});

describe("legacy guards share the approved candidate policy", () => {
  it.each(["allow", "review", "exclude_active"] as const)("enforces clearance mode %s after a neutral model positive", async clearance => {
    const { candidatePolicyHash, candidateCriteriaVersion } = await import("../../src/config/candidate");
    const candidate = structuredClone(CHICAGO_OPERATIONS);
    candidate.policy.clearance = clearance;
    candidate.approval.policySha256 = await candidatePolicyHash(candidate.policy);
    candidate.approval.configSha256 = await candidateCriteriaVersion(candidate);
    const runtime = await loadRuntimeConfig(candidate);
    const env = { runtime, AI_GATEWAY_ID: "synthetic", AI: { run: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "record_verdict", arguments: JSON.stringify({ match: true, lane: "A", hard_exclude: null, reason: "Fit." }) } }] }, finish_reason: "tool_calls" }] }) } } as unknown as FilterEnv;
    const result = await filterJob(env, completePosting({ description: "Lead operations. Must already hold active clearance at application." }));
    if (clearance === "review") expect(result).toMatchObject({ state: "needs_review", gaps: [{ field: "clearance" }] });
    else expect(result).toMatchObject(clearance === "allow" ? { state: "match" } : { verdict: { match: false, hard_exclude: "2" } });
  });
  it("records a model pay exclusion the policy cannot verify as the model gave it", async () => {
    const runtime = await loadRuntimeConfig(CHICAGO_OPERATIONS);
    const pay = { match: false, lane: null, hard_exclude: "3", reason: "Wrong floor." };
    const env = { runtime, AI_GATEWAY_ID: "synthetic", AI: { run: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "record_verdict", arguments: JSON.stringify(pay) } }] }, finish_reason: "tool_calls" }] }) } } as unknown as FilterEnv;
    expect(await filterJob(env, completePosting({ compensation: "Annual base salary USD 110,000 - USD 120,000" }))).toEqual({ state: "no_match", verdict: pay, gaps: [] });
  });
});

describe("review repairs at the legacy and evidence model boundary", () => {
  async function configured(patch: Partial<import("../../src/config/types").CandidatePolicy> = {}, verdict = { match: true, lane: "A" as "A" | null, hard_exclude: null as string | null, reason: "Synthetic model proposal." }): Promise<FilterEnv> {
    const { candidatePolicyHash, candidateCriteriaVersion } = await import("../../src/config/candidate");
    const candidate = structuredClone(CHICAGO_OPERATIONS);
    candidate.policy = { ...candidate.policy, ...patch };
    candidate.approval.policySha256 = await candidatePolicyHash(candidate.policy);
    candidate.approval.configSha256 = await candidateCriteriaVersion(candidate);
    return { runtime: await loadRuntimeConfig(candidate), AI_GATEWAY_ID: "synthetic", AI: { run: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "record_verdict", arguments: JSON.stringify(verdict) } }] }, finish_reason: "tool_calls" }] }) } as unknown as Ai };
  }
  it("I1 records a legacy fixed-pay rejection backed by an unparsed higher alternative as the model's own", async () => {
    const pay = { match: false, lane: null, hard_exclude: "3", reason: "Unsupported ceiling." };
    expect(await filterJob(await configured({}, pay), completePosting({ compensation: "Annual base salary USD 70,000 or 120000 for another location" }))).toEqual({ state: "no_match", verdict: pay, gaps: [] });
  });
  it.each(["full-time", null])("I2 reviews mixed role employment with structured %s", async employmentType => {
    expect(await filterJob(await configured(), completePosting({ employmentType, description: "Lead operations. This role is full-time or contract employment." }))).toMatchObject({ state: "needs_review", gaps: [{ field: "employment" }] });
  });
  it("I2 retains absence versus incidental employment language", async () => {
    expect(await filterJob(await configured(), completePosting({ description: "Lead operations. This role coordinates projects and contract negotiations." }))).toMatchObject({ state: "match" });
  });
  it.each(["allow", "review", "exclude_active"] as const)("I3 handles mandatory conjunctive clearance under %s", async clearance => {
    const result = await filterJob(await configured({ clearance }), completePosting({ description: "Lead operations. Must already hold active clearance at application and be eligible to obtain additional clearance after starting." }));
    if (clearance === "review") expect(result).toMatchObject({ state: "needs_review", gaps: [{ field: "clearance" }] });
    else expect(result).toMatchObject(clearance === "allow" ? { state: "match" } : { verdict: { match: false, hard_exclude: "2" } });
  });
  it("I3 reviews a disjunctive clearance alternative instead of requiring the active option", async () => {
    expect(await filterJob(await configured({ clearance: "exclude_active" }), completePosting({ description: "Lead operations. Must already hold active clearance at application or be eligible to obtain clearance after starting." }))).toMatchObject({ state: "needs_review", gaps: [{ field: "clearance" }] });
  });
  it.each(["onsite", "hybrid", ""])("I4 prevents a body-only %s office from satisfying remote-only policy", async arrangement => {
    const location = { ...CHICAGO_OPERATIONS.policy.location, allowOnsite: false, allowHybrid: false };
    const result = await filterJob(await configured({ location }), completePosting({ location: "Unknown", description: `Lead operations. This ${arrangement ? `${arrangement} ` : ""}role is based in our Chicago, IL office.` }));
    if (arrangement) expect(result).toMatchObject({ verdict: { match: false, hard_exclude: "4" } });
    else expect(result).toMatchObject({ state: "needs_review", gaps: [{ field: "location" }] });
  });
  it("I4 holds evidence-mode match on a disallowed body office with exact role evidence", async () => {
    const env = await configured({ location: { ...CHICAGO_OPERATIONS.policy.location, allowOnsite: false, allowHybrid: false } });
    env.AI = { run: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "record_screening_decision", arguments: JSON.stringify({ state: "match", lane: "A", hardExclude: "none", reason: "Synthetic proposal.", gaps: [], evidence: [fact("function", "description", "Lead operations and improve workflows."), fact("location", "description", "This onsite role is based in our Chicago, IL office.")] }) } }] }, finish_reason: "tool_calls" }] }) } as unknown as Ai;
    const result = await evaluateJob(env, completePosting({ location: "Unknown", description: "Lead operations and improve workflows. This onsite role is based in our Chicago, IL office." }));
    expect(result.decision.state).toBe("needs_review");
    expect(result.decision.evidence.every(f => f.snapshotId === result.snapshot.id)).toBe(true);
  });
  it("M1 rejects a concrete outside-commute office even when the state matches", async () => {
    expect(await filterJob(await configured(), completePosting({ location: "Springfield, IL", locationMetadata: { workplaceType: "OnSite", secondaryLocations: [], coverageGaps: [], sourceFields: ["synthetic"] } }))).toMatchObject({ verdict: { match: false, hard_exclude: "4" } });
  });
  it.each(["This role is full-time or seasonal employment.", "This role has a contract arrangement.", "This role follows an unusual employment arrangement."])("round2 I2/N1 reviews role-employment uncertainty through legacy screening: %s", assertion => {
    return configured().then(async env => {
      expect(await filterJob(env, completePosting({ description: `Lead operations. ${assertion}` }))).toMatchObject({ state: "needs_review", gaps: [{ field: "employment" }] });
    });
  });
  it.each([true, false])("round2 N2 settles onsite/remote alternatives when the legacy model says match=%s", async match => {
    const verdict = { match, lane: match ? "A" as const : null, hard_exclude: match ? null : "4", reason: "Synthetic proposal." };
    const env = await configured({ location: { ...CHICAGO_OPERATIONS.policy.location, allowOnsite: false, allowHybrid: false } }, verdict);
    const job = completePosting({ location: "Unknown", description: "Lead operations. This role is onsite in our Chicago, IL office or fully remote within the US." });
    // A possible match with unsettled alternatives is reviewed; the model's own location exclusion is recorded.
    expect(await filterJob(env, job)).toEqual(match ? { state: "needs_review", verdict, gaps: [{ field: "location", reason: expect.stringMatching(/alternatives/) }] } : { state: "no_match", verdict, gaps: [] });
  });
  it.each([true, false])("round2 N3 settles conflicting clearance when the legacy model says match=%s", async match => {
    const verdict = { match, lane: match ? "A" as const : null, hard_exclude: match ? null : "2", reason: "Synthetic proposal." };
    const env = await configured({ clearance: "exclude_active" }, verdict);
    const job = completePosting({ description: "Lead operations. Must already hold active clearance at application, but active clearance is not required at application." });
    expect(await filterJob(env, job)).toEqual(match ? { state: "needs_review", verdict, gaps: [{ field: "clearance", reason: expect.any(String) }] } : { state: "no_match", verdict, gaps: [] });
  });
  it.each(["This role is full-time or seasonal employment.", "This role has a contract arrangement.", "This role follows an unusual employment arrangement."])("round2 I2/N1 holds the evidence-model positive with an allowed fragment: %s", async assertion => {
    const env = await configured();
    const job = completePosting({ description: `Lead operations and improve workflows. ${assertion}` });
    env.AI = { run: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "record_screening_decision", arguments: JSON.stringify({ state: "match", lane: "A", hardExclude: "none", reason: "Synthetic proposal.", gaps: [], evidence: [fact("function", "description", "Lead operations and improve workflows."), fact("location", "location", "Chicago, IL"), fact("employment", "employmentType", "full-time")] }) } }] }, finish_reason: "tool_calls" }] }) } as unknown as Ai;
    expect((await evaluateJob(env, job)).decision.state).toBe("needs_review");
  });
  it("round2 N3 holds a selected active wire fact when the posting contradicts it", async () => {
    const env = await configured({ clearance: "exclude_active" });
    const active = "Must already hold active clearance at application";
    env.AI = { run: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "record_screening_decision", arguments: JSON.stringify({ state: "no_match", lane: "none", hardExclude: "clearance", reason: "Synthetic active quote.", gaps: [], evidence: [fact("clearance", "description", active)] }) } }] }, finish_reason: "tool_calls" }] }) } as unknown as Ai;
    const result = await evaluateJob(env, completePosting({ description: `Lead operations. ${active}, but active clearance is not required at application.` }));
    expect(result.decision).toMatchObject({ state: "needs_review", hardExclude: null });
    expect(result.decision.evidence[0]).toMatchObject({ snapshotId: result.snapshot.id, excerpt: active });
  });
});

// Regression: every explicit configured category constraint is authoritative.
it("enforces configured Lane A category evidence", async () => {
 const { supportedLane } = await import("../../src/config/policy");
 expect(supportedLane("A",CHICAGO_OPERATIONS.policy,"applied AI")).toBe(true);
 expect(supportedLane("A",CHICAGO_OPERATIONS.policy,"frontier AI")).toBe(false);
 expect(supportedLane("A",CHICAGO_OPERATIONS.policy)).toBe(false);
});

it.each(["A","B"] as const)("enforces restricted and unrestricted %s evidence",async lane=>{
 const {supportedLane}=await import("../../src/config/policy");
 const {candidatePolicyHash,candidateCriteriaVersion}=await import("../../src/config/candidate");
 const {createPostingSnapshot}=await import("../../src/screening/snapshot");
 const {validateScreeningDecision}=await import("../../src/discovery/evidence");
 for(const categories of [["applied AI"],[]] as const){
  const candidate=structuredClone(CHICAGO_OPERATIONS);candidate.policy.functionLanes=[{id:lane,description:"Synthetic function",companyCategories:[...categories]}];
  candidate.approval.policySha256=await candidatePolicyHash(candidate.policy);candidate.approval.configSha256=await candidateCriteriaVersion(candidate);
  const runtime=await loadRuntimeConfig(candidate), job=completePosting();
  const raw={state:"match",lane,hardExclude:null,reason:"Synthetic proposal",gaps:[],evidence:[fact("function","description",job.description!),fact("location","location",job.location)]};
  for(const category of [undefined,"frontier AI","applied AI"] as const){
   const expected=!categories.length||category==="applied AI";
   expect(supportedLane(lane,candidate.policy,category)).toBe(expected);
   expect(validateScreeningDecision(raw,await createPostingSnapshot(job,category),runtime).state).toBe(expected?"match":"needs_review");
  }
 }
});

const filterJob: typeof rawFilterJob = (env,job,category="applied AI",options) => rawFilterJob(env,job,category,options);

beforeEach(()=>{const original=console.log;vi.spyOn(console,"log").mockImplementation((...args)=>{let value;try{value=JSON.parse(String(args[0]));}catch{original(...args);return;}if(args.length===1&&value.event==="model_attempt"){expect(value).toMatchObject({jobId:expect.any(String),attempt:expect.any(Number),outcome:expect.any(String)});return;}original(...args);});});
afterEach(()=>vi.restoreAllMocks());

it.each(["A", "B"] as const)("I1 model boundary retains source-grounded category restrictions for %s", async lane => {
  const { candidatePolicyHash, candidateCriteriaVersion } = await import("../../src/config/candidate");
  const candidate = structuredClone(CHICAGO_OPERATIONS);
  candidate.policy.functionLanes = [{ id: lane, description: "Synthetic operations", companyCategories: ["applied AI"] }];
  candidate.approval.policySha256 = await candidatePolicyHash(candidate.policy);
  candidate.approval.configSha256 = await candidateCriteriaVersion(candidate);
  const env = { runtime: await loadRuntimeConfig(candidate), AI_GATEWAY_ID: "synthetic" } as FilterEnv;
  for (const scenario of [
    { category: "frontier AI" as const, excerpt: "frontier AI", sourceField: "companyCategory", description: "Lead operations and improve workflows.", expected: "needs_review" },
    { category: undefined, excerpt: "Lead operations and improve workflows.", sourceField: "description", description: "Lead operations and improve workflows.", expected: "needs_review" },
    { category: undefined, excerpt: "We are an applied AI company.", sourceField: "description", description: "Lead operations and improve workflows. We are an applied AI company.", expected: "needs_review" },
    { category: undefined, excerpt: "We are an applied AI company.", sourceField: "description", description: "Lead operations and improve workflows. Our client says:\nWe are an applied AI company.", expected: "needs_review" },
    { category: undefined, excerpt: "We are an applied AI company.", sourceField: "description", description: "Lead operations and improve workflows. It is false that\nWe are an applied AI company.", expected: "needs_review" },
    { category: "applied AI" as const, excerpt: "applied AI", sourceField: "companyCategory", description: "Lead operations and improve workflows.", expected: "match" },
  ]) {
    env.AI = { run: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "record_screening_decision", arguments: JSON.stringify({ state: "match", lane, hardExclude: "none", reason: "Synthetic proposal", gaps: [], evidence: [fact("function", "description", "Lead operations and improve workflows."), fact("location", "location", "Chicago, IL"), { field: "company_category", sourceField: scenario.sourceField, excerpt: scenario.excerpt, value: "applied AI" }] }) } }] }, finish_reason: "tool_calls" }] }) } as unknown as Ai;
    const result = await evaluateJob(env, completePosting({ description: scenario.description }), scenario.category);
    expect(result.decision.state).toBe(scenario.expected);
    expect(result.decision.evidence.every(e => e.snapshotId === result.snapshot.id)).toBe(true);
    if (scenario.expected === "needs_review") expect(result.decision.evidence.some(e => e.field === "company_category" && e.value === "applied AI")).toBe(false);
  }
});
