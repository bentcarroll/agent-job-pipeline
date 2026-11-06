import type { ScheduleConfig } from "./types";

export type ScheduledSlot = { workflow: "fixed" | "discovery" | "lifecycle" | "radar" | "intake"; slotKey: string };
export const DISPATCHER_CRON = "*/5 * * * *";
const TICK_MS = 5 * 60_000;
const MAX_TICK_DRIFT_MS = 2 * 60_000;

/** Calendar slots share an ID across a DST fold; nonexistent spring slots never match.
 * Intake is a separate UTC tick, so a fold cannot suppress request/lease recovery. */
export function dueWorkflows(scheduledAt: Date, schedule: ScheduleConfig): readonly ScheduledSlot[] {
  if (!Number.isFinite(scheduledAt.getTime())) throw new Error("Invalid schedule date");
  // Cloudflare's scheduledTime is seconds off the boundary in practice (a live
  // tick reported :40:25.735), so a tick belongs to the nearest five-minute
  // mark. One more than two minutes from any mark is ignored as ambiguous.
  // A repeated delivery maps to the same slot, whose ID keeps it to one run.
  const nearest = Math.round(scheduledAt.getTime() / TICK_MS) * TICK_MS;
  if (Math.abs(scheduledAt.getTime() - nearest) > MAX_TICK_DRIFT_MS) return [];
  const at = new Date(nearest);
  const parts = new Intl.DateTimeFormat("en", { timeZone: schedule.timezone,
    calendar: "gregory", numberingSystem: "latn", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === name)!.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const time = `${part("hour")}:${part("minute")}`;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  const due: ScheduledSlot[] = [];
  const add = (workflow: ScheduledSlot["workflow"]) => due.push({ workflow, slotKey: `${workflow}-${date}-${time.replace(":", "")}` });
  if (schedule.discoveryWeekdays.includes(weekday) && schedule.discoveryLocalTimes.includes(time)) {
    add("fixed"); add("discovery");
  }
  if (schedule.lifecycleLocalTime === time) add("lifecycle");
  if (schedule.radarLocalTime === time) add("radar");
  const utc = at.toISOString();
  due.push({ workflow: "intake", slotKey: `intake-${utc.slice(0, 10)}-${utc.slice(11, 16).replace(":", "")}Z` });
  return due;
}
