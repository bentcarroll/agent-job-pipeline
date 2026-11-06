// Secrets are added in the Cloudflare dashboard after `deploy`, which already
// starts the five-minute dispatcher. A scheduled run whose credentials are not
// there yet would fail on its first provider call, often before it could post
// an alert, so the dispatcher skips it and logs which names are missing.
export const SCHEDULED_SECRETS = {
  fixed: ["SLACK_BOT_TOKEN"],
  discovery: ["SLACK_BOT_TOKEN", "SERPER_API_KEY"],
  lifecycle: ["SLACK_BOT_TOKEN", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"],
  radar: ["SLACK_BOT_TOKEN", "TWITTERAPI_IO_KEY", "ANTHROPIC_API_KEY"],
} as const;

export type ScheduledWork = keyof typeof SCHEDULED_SECRETS;

export function missingSecrets(env: object, work: ScheduledWork): string[] {
  return SCHEDULED_SECRETS[work].filter(name => {
    const value = (env as Record<string, unknown>)[name];
    return typeof value !== "string" || !value.trim();
  });
}

/** True when every secret `work` needs is set; otherwise logs the missing names (never values). */
export function secretsReady(env: object, work: ScheduledWork): boolean {
  const missing = missingSecrets(env, work);
  if (missing.length) console.warn(`Scheduled ${work} run skipped: ${missing.join(", ")} not set on this Worker yet`);
  return missing.length === 0;
}
