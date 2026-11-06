import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ WorkflowEntrypoint: class { env: unknown; constructor(_ctx: unknown, env: unknown) { this.env = env; } } }));
import { AgentWorkflow } from "../../src/index";
import { UnboundedAgentWorkflow } from "../../src/unbounded/index";
import * as sources from "../../src/sources";
import * as discovery from "../../src/unbounded/discovery";
import { CHICAGO_OPERATIONS } from "../fixtures/candidates";
import { completePosting } from "../fixtures/policy-postings";
import { baselineSources } from "../../src/discovery/baseline";
import { loadRuntimeConfig } from "../../src/config/candidate";
import { activateCandidateConfig } from "../../src/config/run-context";
import { createDatabase, loadSchema } from "./harness";

// The first live install retried every possible match the policy could not
// confirm, every six to forty-eight hours, for ever, and never posted it.
// Legacy mode now records such a match as needs_review, posts it once with
// the gaps named, and leaves retries to real provider failures.
let db: D1Database, dispose: () => Promise<void>;
const instance = JSON.parse(readFileSync(new URL("../../examples/instance.json", import.meta.url), "utf8"));
instance.screeningMode = "legacy";
const step = { do: async (_name: string, ...args: any[]) => args.at(-1)(), sleep: async () => {} };
const fit = JSON.stringify({ match: true, lane: "A", hard_exclude: null, reason: "Operations fit." });
type Post = { text?: string; blocks?: any[] };
const cardText = (post: Post) => JSON.stringify(post.blocks ?? []);

beforeEach(async () => {
  ({ db, dispose } = await createDatabase());
  await loadSchema(db, "root");
  await db.prepare("INSERT INTO fixed_baselines VALUES (?,?,?)").bind(instance.instanceId, baselineSources(CHICAGO_OPERATIONS.search.sources), "2026-01-01").run();
  await activateCandidateConfig(db, instance.instanceId, await loadRuntimeConfig(CHICAGO_OPERATIONS), null);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await dispose(); });

function arrange(kind: "fixed" | "unbounded", jobs: sources.NormalizedJob[], model: (id: number) => Promise<unknown>) {
  vi.spyOn(sources, "fetchAllPostings").mockResolvedValue({ jobs, errors: [] });
  vi.spyOn(discovery, "findPostingsForPhrases").mockResolvedValue({ refs: jobs.map(job => ({ ats: "greenhouse", slug: "example-automation", postingId: job.id.split(":").at(-1)!, url: job.url, title: job.title })), errors: [] } as any);
  vi.spyOn(sources, "fetchPosting").mockImplementation(async ref => jobs.find(job => job.id.endsWith(`:${ref.postingId}`)) ?? null);
  const posts: Post[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
    expect(String(input)).toBe("https://slack.com/api/chat.postMessage");
    posts.push(JSON.parse(init.body));
    return Response.json({ ok: true, ts: `${posts.length}` });
  }));
  const calls: number[] = [];
  const AI = { run: async (_model: string, input: any) => {
    const id = Number(/jobs\/(9\d\d)/.exec(input.messages[1].content)![1]);
    calls.push(id);
    return model(id);
  } };
  const env = { DB: db, CANDIDATE_CONFIG: JSON.stringify(CHICAGO_OPERATIONS), INSTANCE_CONFIG: JSON.stringify(instance), AI, SLACK_BOT_TOKEN: "SYNTHETIC-BOT", SLACK_CHANNEL_ID: "CSYNTHETIC" };
  const Workflow = kind === "fixed" ? AgentWorkflow : UnboundedAgentWorkflow;
  const run = (name: string) => new Workflow({} as any, env as any).run({ instanceId: `${name}-${kind}`, payload: {} } as any, step as any);
  const prefix = kind === "fixed" ? "greenhouse:Example Automation:" : "greenhouse:example-automation:";
  return { posts, calls, run, prefix };
}

it.each(["fixed", "unbounded"] as const)("%s worker records an unconfirmed possible match as needs_review and posts it once with its gaps", async kind => {
  const jobs = [
    completePosting({ id: "greenhouse:Example Automation:900", url: "https://job-boards.greenhouse.io/example-automation/jobs/900", description: "Lead operations. This role is full-time or contract employment." }),
    completePosting({ id: "greenhouse:Example Automation:901", url: "https://job-boards.greenhouse.io/example-automation/jobs/901" }),
  ];
  const { posts, calls, run, prefix } = arrange(kind, jobs, async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "record_verdict", arguments: fit } }] }, finish_reason: "tool_calls" }] }));
  await run("first");
  expect(calls.sort()).toEqual([900, 901]);

  // The unbounded search cannot verify a company category, so lane A's
  // restriction makes its plain match a review too.
  const reviewed = kind === "fixed" ? [prefix + "900"] : [prefix + "900", prefix + "901"];
  expect((await db.prepare("SELECT id,match FROM jobs ORDER BY id").all()).results)
    .toEqual([{ id: prefix + "900", match: null }, { id: prefix + "901", match: kind === "fixed" ? 1 : null }]);
  const evaluations = (await db.prepare("SELECT job_id,state,decision_json FROM job_evaluations ORDER BY job_id").all<{ job_id: string; state: string; decision_json: string }>()).results;
  expect(evaluations.map(row => [row.job_id, row.state])).toEqual(reviewed.map(id => [id, "needs_review"]));
  const decision = JSON.parse(evaluations[0].decision_json);
  expect(decision).toMatchObject({ state: "needs_review", lane: null, reason: "Operations fit.", hardExclude: null, promptVersion: "legacy-verdict-v1" });
  expect(decision.gaps).toEqual([...(kind === "fixed" ? [] : [expect.stringMatching(/applied AI/)]), expect.stringMatching(/employment arrangement/)]);
  expect((await db.prepare("SELECT job_id,status FROM screening_deliveries ORDER BY job_id").all()).results).toEqual(reviewed.map(job_id => ({ job_id, status: "delivered" })));
  expect(await db.prepare("SELECT count(*) AS n FROM discovery_retries").first()).toEqual({ n: 0 });

  // One header, then one card per posting; the review card names the gap.
  expect(posts).toHaveLength(3);
  expect(posts[0].text).toMatch(kind === "fixed" ? /1 possible match\(es\); 1 need\(s\) review/ : /0 possible match\(es\); 2 need\(s\) review/);
  const review = posts.find(post => post.text?.includes("Operations manager") && cardText(post).includes("full-time"));
  expect(cardText(review!)).toMatch(/Needs review/);
  expect(cardText(review!)).toMatch(/employment arrangement is stated ambiguously/);
  if (kind === "fixed") expect(posts.filter(post => cardText(post).includes("Needs review"))).toHaveLength(1);

  // A later run neither re-screens nor re-posts a settled review.
  await run("second");
  expect(calls).toHaveLength(2);
  expect(posts).toHaveLength(3);
});

it.each(["fixed", "unbounded"] as const)("%s worker records the model's own needs_review and posts it once with its reason", async kind => {
  const job = completePosting({ id: "greenhouse:Example Automation:920", url: "https://job-boards.greenhouse.io/example-automation/jobs/920" });
  const hedge = JSON.stringify({ verdict: "needs_review", lane: "A", hard_exclude: null, reason: "Remote permission for Illinois is not stated." });
  const { posts, calls, run, prefix } = arrange(kind, [job], async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "record_verdict", arguments: hedge } }] }, finish_reason: "tool_calls" }] }));
  await run("hedge");
  expect(calls).toEqual([920]);
  expect(await db.prepare("SELECT match FROM jobs WHERE id=?").bind(prefix + "920").first()).toEqual({ match: null });
  const row = await db.prepare("SELECT state, decision_json FROM job_evaluations WHERE job_id=?").bind(prefix + "920").first<{ state: string; decision_json: string }>();
  expect(row!.state).toBe("needs_review");
  expect(JSON.parse(row!.decision_json).gaps[0]).toBe("Remote permission for Illinois is not stated.");
  expect(await db.prepare("SELECT status FROM screening_deliveries WHERE job_id=?").bind(prefix + "920").first()).toEqual({ status: "delivered" });
  expect(await db.prepare("SELECT count(*) AS n FROM discovery_retries").first()).toEqual({ n: 0 });
  const review = posts.find(post => cardText(post).includes("Needs review"));
  expect(cardText(review!)).toMatch(/Remote permission for Illinois is not stated\./);
});

it.each(["fixed", "unbounded"] as const)("%s worker gives up on a posting after its third failed screening", async kind => {
  const job = completePosting({ id: "greenhouse:Example Automation:950", url: "https://job-boards.greenhouse.io/example-automation/jobs/950" });
  const { calls, run, prefix } = arrange(kind, [job], async () => { throw new Error("synthetic provider outage"); });
  const pipeline = kind === "fixed" ? "fixed_boards" : "unbounded_discovery";
  await db.prepare("INSERT INTO discovery_retries VALUES (?,?,'filter',2,'earlier','synthetic',0,0)").bind(pipeline, prefix + "950").run();
  const before = Date.now();
  await run("third");
  expect(calls).toEqual([950]);
  const retry = await db.prepare("SELECT attempts,next_attempt_at FROM discovery_retries WHERE job_id=?").bind(prefix + "950").first<{ attempts: number; next_attempt_at: number }>();
  expect(retry!.attempts).toBe(3);
  expect(retry!.next_attempt_at).toBeGreaterThan(before + 300 * 86_400_000);
  await run("fourth");
  expect(calls).toEqual([950]);
  expect(await db.prepare("SELECT count(*) AS n FROM jobs").first()).toEqual({ n: 0 });
});
