# Agent Job Pipeline

A personal job-search assistant that runs on your own accounts. On a schedule you set, it reads new postings from company job boards and the open web, screens each one against criteria you approved in plain English, and sends the matches to Slack. When you pick a role, Claude Code or Codex writes a tailored resume and cover letter from your own career record, in the posting's language, and checks every page before you see it. An optional Gmail tracker keeps your application list current from confirmation, rejection and interview emails.

It was built for a career that doesn't fit one job title. You can search in several lanes at once: one that follows a kind of work, another that follows a kind of company.

## How it works

- **Discovery.** Two Cloudflare Workers pull new postings from the job boards of employers you list and from web searches for your role phrases.
- **Screening.** A small model on Cloudflare Workers AI checks each posting against your criteria: function, level, pay, location and work arrangement. A possible match it can't fully confirm (the work arrangement reads two ways, the location can't be settled, a lane asks for a kind of company the search can't verify) is still posted, marked for review with what to check.
- **Review.** Matches arrive in a Slack channel. `/job <link>` adds any posting by hand.
- **Materials.** Ask your coding assistant to prepare materials for a job. It drafts from your verified career facts, uses the posting's terms where your experience supports them, never invents a fact, renders the PDFs and inspects every page.
- **Tracking (optional).** Reads Gmail read-only for application confirmations, rejections and interview invitations, updates your ledger, and asks in Slack when it isn't sure.
- **AI radar (optional).** A daily digest of AI news and debate from X, filtered to your interests.

Nothing applies for you or messages an employer.

## What you need

- A Mac with Apple silicon, Node 22 and Python 3.12 (`brew install node@22 python@3.12`)
- Claude Code or Codex
- A Cloudflare account on the Workers Paid plan, and an API token
- A Slack workspace where you can add an app
- A [Serper](https://serper.dev/) API key for web search
- Optional: a Google Cloud project for Gmail tracking; [twitterapi.io](https://twitterapi.io/) and Anthropic API keys for the radar

Details are in [accounts](docs/accounts.md).

## What it costs

Measured in October 2026 on the author's own deployment of the private pipeline this release comes from: about 5,000 postings screened, 6,600 web searches, a daily tracker run and a daily radar run.

| Item | Monthly cost |
| --- | --- |
| Cloudflare Workers Paid plan, including the screening model | $8 to $10 |
| Serper web search | about $7 in queries, bought $50 at a time (valid six months); first 2,500 free |
| Optional AI radar (X data plus a Claude editor) | about $8 |
| Gmail tracking and Slack | free |
| Resumes and letters | your existing Claude or ChatGPT subscription |

The Workers Paid plan ($5 a month) is required because the screening model needs a paid account. Your cost scales with how many search phrases, employer boards and runs you choose. Check current prices with each provider.

## Set up

Clone the repository, open Claude Code or Codex in it, and paste:

> Set up Agent Job Pipeline from https://github.com/bentcarroll/agent-job-pipeline at the reviewed v0.1.0-beta.3 prerelease. Read SETUP.md and AGENTS.md, then walk me through it: interview me from my resume, show me my search criteria before I approve them, tell me which accounts, schedules and costs each step involves before using them, and keep my keys out of this chat.

The assistant follows [SETUP.md](SETUP.md). It interviews you from your resume, drafts your criteria for your approval, creates the Cloudflare resources, deploys both Workers and walks you through the Slack app. You enter keys in Cloudflare's dashboard or your own terminal, never in the chat. Setup can stop and resume at any step.

More detail: [setup mechanics](docs/setup.md), [Gmail tracking](docs/lifecycle-setup.md), [upgrades](docs/upgrades.md) and [recovery](docs/recovery.md). The assistant's rules are in [AGENTS.md](AGENTS.md), and materials follow one [procedure](skills/prepare-application/SKILL.md).

## Status

This is a beta. The automated tests, the offline setup stages and materials rendering pass on macOS with Apple silicon. A from-scratch install on a new Cloudflare account and Slack workspace is still an open release check, so expect rough edges and please report them. Linux and Windows are untested. See the [release notes](docs/release-notes.md).

## License

Free for personal use under the [Personal Evaluation License](LICENSE). It is source-available, not open source: commercial use and redistribution need permission.
