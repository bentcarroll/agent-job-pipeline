# Guided setup on macOS

This guide is written for Claude Code or Codex to follow with you. Each step says what it does, what it needs from you and whether it touches an outside account. Setup stops cleanly at any step and resumes from where it stopped.

Paste this prompt into Claude Code or Codex, opened in a checkout of the release:

> Set up Agent Job Pipeline from https://github.com/bentcarroll/agent-job-pipeline at the reviewed v0.1.0-beta.3 prerelease. Read SETUP.md and AGENTS.md, then walk me through it: interview me from my resume, show me my search criteria before I approve them, tell me which accounts, schedules and costs each step involves before using them, and keep my keys out of this chat.

This is the `0.1.0-beta.3` beta. Automated tests, the offline setup stages and materials rendering pass on macOS with Apple silicon. A from-scratch install on a new Cloudflare account and Slack workspace is still an open release check.

## Before you start

- A Mac with Apple silicon, with Node 22 and Python 3.12. If they are missing: `brew install node@22 python@3.12`. Linux and Windows are untested.
- Arial, which macOS includes. Setup's document check stops without it.
- Accounts: Cloudflare on the Workers Paid plan, a Slack workspace where you can add an app, and a Serper API key. Gmail tracking and the AI radar are optional. See [accounts](docs/accounts.md) for what each one is used for and what it costs.
- Keys never go in the chat. You enter them in Cloudflare's dashboard, in your own terminal or in the provider's own sign-in page when a step asks.

All `/absolute/private/workspace` and `/absolute/python3.12` paths below are placeholders. Resolve them to the real selected paths; do not use another person's defaults. The workspace must be outside the release checkout and protected source directories, including after symlink resolution.

## Assistant access

Both assistants follow this guide and the same skills. In Codex, open the release checkout and make sure the selected workspace is writable; a CLI session may use `--add-dir /absolute/private/workspace`. `codex exec` defaults to read-only, so file edits need `--sandbox workspace-write`. Do not bypass approvals or read saved authentication files. See [project instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md) and [noninteractive execution](https://learn.chatgpt.com/docs/non-interactive-mode).

In Claude Code, start in the release checkout, confirm that CLAUDE.md imports AGENTS.md, and grant the selected workspace through the session's directory access (`--add-dir /absolute/private/workspace` where supported). The `.claude/skills` adapter routes material requests to the shared procedure. See [skills](https://code.claude.com/docs/en/skills) and [headless execution](https://code.claude.com/docs/en/headless).

For either assistant, confirm the session really has shell and file tools, Python and PDF tools, and can look at rendered images before relying on them. Sign-ins and consent screens are done by the person. Never present an instruction-only or offline walkthrough as a real installation.

## 1. Choose a workspace and approve your profile

Read [onboarding](skills/onboard/SKILL.md). Copy the selected resume byte for byte into the private workspace, interview the candidate, and reconcile direct corrections into the reviewed factual digest and writing preferences. Keep unresolved evidence gaps explicit. Create private `materials.json` using that skill's schema, including the resume page count and whether letters are wanted.

Prepare private `criteria.md` and `candidate.json` using the [candidate schema](schemas/candidate.schema.json). Review, in plain language: eligibility, employment type, clearance, comparable annual base pay and currency, commute and remote arrangements, function lanes, search phrases and employer boards. Remote alone does not prove eligibility, and pay that cannot be compared goes to review. After the candidate approves the actual readable file and machine configuration, record the SHA-256 of the readable file, `candidatePolicyHash(policy)` and `candidateCriteriaVersion(candidate)` as `readableSha256`, `policySha256` and `configSha256`, plus the real approval time. These functions live in [candidate configuration](src/config/candidate.ts). Setup verifies approvals; it never creates them. Any change to search phrases or policy needs a fresh review.

Create private `instance.json` from the synthetic [draft](examples/instance.draft.json), guided by the [instance schema](schemas/instance.schema.json). Set your own Cloudflare account ID (shown on the dashboard's account home), operator contact, Slack channel and user IDs, flags and schedule. In Slack, a channel's ID is at the bottom of its details panel, and your user ID is under your profile's "Copy member ID". Leave Gmail tracking off (`lifecycle.enabled: false`) for the first install; step 7 turns it on. The database ID stays null until step 3. The examples are fabricated, not working accounts.

## 2. Check this Mac

Create the workspace directory with private permissions. From the release checkout, install the locked dependencies into the workspace using core Node only (nothing is installed globally or in the checkout):

```sh
node tools/setup/bootstrap.mjs --workspace /absolute/private/workspace
```

Bootstrap prints the private loader path that every command below uses. Then check this Mac and read the setup status:

```sh
node --import /absolute/private/workspace/.setup/dependencies/node_modules/tsx/dist/loader.mjs tools/setup/cli.ts check --workspace /absolute/private/workspace --instance /absolute/private/workspace/instance.json --python /absolute/python3.12
node --import /absolute/private/workspace/.setup/dependencies/node_modules/tsx/dist/loader.mjs tools/setup/cli.ts status --workspace /absolute/private/workspace --instance /absolute/private/workspace/instance.json
```

`check` installs a private Python environment, then embeds macOS Arial in a test PDF, extracts its text and renders it. HOME, CODEX_HOME and global settings stay unchanged. For materials, an installed Liberation Sans can replace Arial explicitly; see the [materials procedure](skills/prepare-application/SKILL.md). See [dependency isolation](docs/setup.md) for details.

## 3. Create the Cloudflare resources

This step writes to the selected Cloudflare account. Confirm the account and get the person's go-ahead first.

Create an API token in the Cloudflare dashboard (My Profile, API Tokens): start from the "Edit Cloudflare Workers" template and add the account permissions D1 Edit and AI Gateway Edit, limited to the selected account. The person makes the token available to the assistant without showing it: in the terminal that will start Claude Code or Codex, run `read -s CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN`, paste the token, press Return, then start the assistant from that terminal. Never paste the token into the chat or a command argument. Then:

```sh
node --import /absolute/private/workspace/.setup/dependencies/node_modules/tsx/dist/loader.mjs tools/setup/cli.ts resources --workspace /absolute/private/workspace --instance /absolute/private/workspace/instance.json --provider-writes approved
```

This creates the D1 database, AI Gateway and the two Workers (empty, no code yet) under random names, initializes the schema and writes the real IDs into `instance.json`. If it stops, rerun it with the same workspace; it reconciles from its saved record and never adopts resources by name. See [recovery](docs/recovery.md).

## 4. Preview offline

```sh
node --import /absolute/private/workspace/.setup/dependencies/node_modules/tsx/dist/loader.mjs tools/setup/cli.ts preview --workspace /absolute/private/workspace --instance /absolute/private/workspace/instance.json
```

This checks the approvals and bindings and builds both Workers offline. It does not run discovery, call the model or post to Slack. Run it after `resources`; before that it stops with `RESOURCES_REQUIRED`.

## 5. Review the schedule and activate

Show the person the timezone, local run times (five-minute steps), discovery weekdays, whether Gmail tracking and the radar are on, the Slack channels, the radar's monthly data budget and the services each feature uses. The radar is off by default. When it is on, choose its topics from `enterprise_adoption`, `agents_in_operations`, `operating_models`, `governance_policy`, `frontier_releases`, `ai_economics`, `data_analysis`, `hands_on`; the budget covers X data only. Changing any of these choices means rerunning `preview`.

After the person approves these exact choices:

```sh
node --import /absolute/private/workspace/.setup/dependencies/node_modules/tsx/dist/loader.mjs tools/setup/cli.ts activate --workspace /absolute/private/workspace --instance /absolute/private/workspace/instance.json --provider-writes approved
```

The first run stops on purpose with `ACTIVATION_REVIEW_REQUIRED` and writes `.setup/activation-review.json`. On a first install nothing is deployed yet, so there is nothing to pause or drain: set `externalQuiesced` and `receiptsReconciled` to true, write evidence such as "First install: no Worker code deployed and no deliveries exist", and set `reviewedAt` to the current time. The review is accepted for one hour after `reviewedAt`. When upgrading a running instance, pause scheduled and manual delivery, let running Workflows finish and reconcile uncertain Slack requests first, and record what was actually done. Then:

```sh
node --import /absolute/private/workspace/.setup/dependencies/node_modules/tsx/dist/loader.mjs tools/setup/cli.ts activate --workspace /absolute/private/workspace --instance /absolute/private/workspace/instance.json --provider-writes approved --review /absolute/private/workspace/.setup/activation-review.json
```

Activation records the approved criteria in D1 and writes the two operational Worker configs, each with one five-minute dispatcher that runs your local schedule. It does not deploy them.

## 6. Deploy and connect Slack

This step deploys code to the selected Cloudflare account and starts the schedule. Get the person's go-ahead first.

```sh
node --import /absolute/private/workspace/.setup/dependencies/node_modules/tsx/dist/loader.mjs tools/setup/cli.ts deploy --workspace /absolute/private/workspace --instance /absolute/private/workspace/instance.json --provider-writes approved
```

It deploys the fixed Worker (its name ends in `-fixed`), then the unbounded one (its name ends in `-open`), and prints the unbounded Worker's address, `https://<worker name>.<your subdomain>.workers.dev`. If it stops with `WORKERS_DEV_SUBDOMAIN_REQUIRED`, open Workers & Pages in the Cloudflare dashboard once, accept a workers.dev subdomain and rerun. If it stops with `ACTIVATION_STALE`, the configs, instance or release files changed after activation; rerun `preview` and both `activate` steps first. Until the secrets below are added, scheduled runs are skipped and the Worker logs which secret is missing, so nothing fails while you finish this step.

Create the Slack app. Check the workspace's installed apps first: if another app already owns `/job`, use a different Slack workspace, and never repoint an existing app. At api.slack.com/apps choose Create New App, From a manifest, pick the workspace and paste this, with the printed address in both URLs:

```yaml
display_information:
  name: Job Pipeline
features:
  bot_user:
    display_name: Job Pipeline
  slash_commands:
    - command: /job
      url: https://<unbounded worker address>/slack/commands
      description: Screen a job posting by link
      usage_hint: <posting link>
oauth_config:
  scopes:
    bot:
      - chat:write
      - commands
settings:
  interactivity:
    is_enabled: true
    request_url: https://<unbounded worker address>/slack/actions
```

Install the app to the workspace, then invite it to the channel set in `instance.json` (`/invite @Job Pipeline`), and to the radar channel too if the radar is on.

Add the secrets in the Cloudflare dashboard (Workers & Pages, the Worker, Settings, Variables and Secrets, Add, type Secret). The person copies each value straight from its source:

| Secret | Fixed Worker (`-fixed`) | Unbounded Worker (`-open`) | Where it comes from |
| --- | --- | --- | --- |
| `SLACK_BOT_TOKEN` | yes | yes | Slack app, OAuth & Permissions, Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | | yes | Slack app, Basic Information, Signing Secret |
| `TRIGGER_SECRET` | yes | yes | any long random string, for example from `openssl rand -hex 32` in the person's own terminal |
| `SERPER_API_KEY` | | yes | serper.dev dashboard |
| `TWITTERAPI_IO_KEY`, `ANTHROPIC_API_KEY` | | radar only | twitterapi.io and the Anthropic Console |

Test it: in the channel, type `/job` followed by a real posting link. The app answers with its screening result. Scheduled discovery starts at the next discovery time.

## 7. Add Gmail tracking (optional)

Gmail tracking needs the deployed Worker, which serves the `/` and `/privacy` pages Google's consent screen points to. Review those pages at the unbounded Worker's address, set up your Google project and Desktop OAuth client, then follow [Gmail setup](docs/lifecycle-setup.md). Consent must name the selected Gmail account and read-only processing, with classification through Workers AI and no Gateway logging or caching.

First authorize, so the credentials are in place before tracking starts. With the person's go-ahead and the Cloudflare token exported as in step 3:

```sh
node --import /absolute/private/workspace/.setup/dependencies/node_modules/tsx/dist/loader.mjs tools/gmail-auth/auth.mjs --instance /absolute/private/workspace/instance.json --client /absolute/private/workspace/oauth-client.json --workspace /absolute/private/workspace
```

The helper opens Google's consent page, then writes the three Gmail secrets straight to the unbounded Worker and shows only success or failure. Then turn tracking on in `instance.json`: set `lifecycle.enabled` to true, `lifecycle.since` to the earliest date whose mail should count, `lifecycle.oauthMode` to the Google mode you actually use, and `schedule.lifecycleLocalTime` to a daily time. Show the person the change, then rerun `preview`, both `activate` steps and `deploy`. In Google's Testing mode, sign-in normally expires after seven days.

## 8. Resume and operate

Run `status` to see where setup stands, then rerun the stage that stopped, with the same workspace and instance. [Recovery](docs/recovery.md) covers interrupted provider writes, locks, Gmail failures and changed approvals; [upgrades](docs/upgrades.md) covers moving to a newer release.

D1 holds the jobs and application status. Slack review and `/job` do not prepare materials on their own. Ask for them by job ID, for example "prepare materials for this job ID using my materials.json"; Codex's `.agents/skills/job-materials` and Claude's `.claude/skills/job-materials` both hand off to the [materials procedure](skills/prepare-application/SKILL.md). Review the real PDF pages before marking a package `materials_ready`. A prepared package is not a submitted application, and setup never contacts employers.
