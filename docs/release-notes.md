# v0.1.0-beta.3 beta

Agent Job Pipeline is a source-available personal workflow for your own job search. The [license](../LICENSE) allows personal setup, inspection and private modification. Commercial use, redistribution and service operation require the owner's permission. This is not an open-source license.

## Changes since v0.1.0-beta.2

- Setup can now deploy. A new `deploy` stage deploys both Workers from the reviewed activation, records the public address Slack and Google need, and names a missing workers.dev subdomain instead of failing silently. It deploys only what activation recorded: an edited config, a changed instance or different release files stop with `ACTIVATION_STALE`. SETUP.md adds the Slack app manifest, the secrets each Worker needs and a first `/job` test. In November 2026 the stage ran a from-scratch install on a separate Cloudflare account and Slack workspace; the problems that install exposed are fixed below.
- Screening records every verdict. Before, a possible match the approved policy could not confirm, and a rejection it could not verify, were refused and re-screened every six to forty-eight hours for ever, never reaching Slack; in the live install that was 17 of 36 postings. Now a rejection is recorded as the model gave it, and a possible match the policy cannot confirm is recorded as needs review and posted once with what to check: the work arrangement reads two ways, a clearance requirement is unclear, the location cannot be settled, or a lane asks for a company category the search cannot verify. `/job` cards carry the same notes. A posting whose arrangement is simply not stated is accepted as the model judged it.
- A posting the model fails on gets three screening tries, six and twelve hours apart; after the third failure it rests for a year with its last error on record.
- The screening model can now say it cannot decide. Its verdict is `match`, `no_match` or `needs_review`; before, told that unresolved eligibility supported neither of two verdicts, it hedged with a no-match that still named the fitting lane, which the parser refused twice per posting and sent to retry (3 of 8 probed calls in the live install). A `needs_review` from the model, and that older hedge, become a review card with the model's reason as the first thing to confirm; a proven exclusion still outranks it. A review card is posted even when the posting's location or full text cannot be verified at delivery time; in the live install every review card had been held for that verification and none was posted. Only a possible match waits for a verified location. The prompt also names an onsite or hybrid role outside every commute location, with no remote option, as the location exclusion rather than a review.
- Legacy screening asks the model for low reasoning effort. At the model's default, the live install measured 75 to 174 seconds a verdict, with the 4,000-token answer budget often spent on reasoning and no tool call at the end (two of four probed postings); at low effort the same postings answered in 7 to 17 seconds with valid verdicts, at about a fifth of the neurons. A Worker variable `SCREENING_REASONING_EFFORT` of `high` or `max` restores more reasoning.
- Scheduled runs start. The dispatcher assigns a cron tick delivered seconds late to its five-minute slot; before, it required exact alignment and no scheduled work ever ran.
- The generated configs bind Worker version metadata, which discovery accounting reads; without it every discovery run failed at its first step.
- SETUP.md passes the Cloudflare API token through the macOS Keychain and verifies it before use, after two pasted tokens arrived truncated.
- Hosted CI runs on GitHub's macOS 15 Arm64 image. GitHub retired every macOS 14 image on November 2, 2026, and the first push of this release was cancelled on arrival with "The configuration 'macos-14-arm64-us-default' is not supported".
- Scheduled runs whose secrets are not added yet are skipped with a log of the missing names, so the minutes between `deploy` and adding secrets produce no failed runs.
- `preview`, `activate` and `deploy` on an unprovisioned instance now stop with `RESOURCES_REQUIRED` instead of a generic failure.
- Gmail tracking is turned on after authorization, so its credentials exist before its first run.
- The materials procedure makes writing in the posting's language an explicit step: run the term check before the first render, name supported work in the posting's wording, keep bullets concrete, and leave out anything the evidence does not support.
- The Gmail tracker settles a message deleted from the mailbox as ignored. Before, a deleted message failed every later run and stopped the tracker.
- Screening keeps pay lines that sit in the elided middle of a long posting, so a salary line before a long closing block no longer reads as no pay disclosed. Dollar, pound and euro amounts count.
- The README and SETUP.md are rewritten in plain language, with prerequisites and measured monthly costs. The repository moved to github.com/bentcarroll/agent-job-pipeline, and the release tool checks the new name.

## Scope

The workflow separates the approved candidate profile, private career workspace and hosted D1 ledger. It includes scheduled discovery, verification and screening, Slack review and `/job` intake, Gmail lifecycle reconciliation, and requested application materials through shared Codex and Claude Code skills. The optional AI radar starts disabled. Materials preparation never establishes submission.

The measured local platform is macOS arm64, Node 22 and Python 3.12, with macOS Arial document checks. Linux, Windows and other architectures are untested. Python dependency versions are pinned for the measured platform; wheel artifacts are not hash-locked. No fonts are distributed. [Installation results](installation-results.md) were measured on v0.1.0-beta.1.

This beta does not claim a verified hosted installation. A from-scratch install on a separate Cloudflare account and Slack workspace has run through deploy, `/job` and scheduled discovery once; live Gmail consent and recovery, and resource cleanup remain open checks. Beta publication requires passed local workflow checks, material and visual evidence, matching hosted CI and independent review. The beta is a GitHub prerelease, never the latest stable release.

## Setup prompt

> Set up Agent Job Pipeline from https://github.com/bentcarroll/agent-job-pipeline at the reviewed v0.1.0-beta.3 prerelease. Read SETUP.md and AGENTS.md, then walk me through it: interview me from my resume, show me my search criteria before I approve them, tell me which accounts, schedules and costs each step involves before using them, and keep my keys out of this chat.

## Known limits

- Account selection, sign-in and consent are done by the person. A fresh Slack app needs an unused workspace-wide `/job` command; a separate channel does not isolate a conflicting command.
- Runtime secrets are entered in the Cloudflare dashboard; setup does not upload them, except the Gmail helper's three.
- Gmail consent is read-only for the selected account. In Google's Testing mode, sign-in normally expires after seven days.
- Missing macOS Arial or an existing `~/.wrangler` directory blocks the isolated preflight. Do not move another operator's files or change HOME to bypass it.
- Heuristic privacy scans supplement independent disclosure review. Publication starts from the explicit committed-file manifest and fresh history; extraction and development history is never pushed.
