import { describe, expect, it } from "vitest";
import { htmlToText, htmlToTextWithProvenance, MAX_DESCRIPTION_CHARS } from "./description";

// A posting long enough to be cut, with the pay line after the head and
// before a long closing block, so a plain head + tail cut drops it.
function longPosting(payLine: string): string {
  return [
    `LEAD THE PRACTICE. ${"mission ".repeat(800)}`,
    `${"responsibility ".repeat(150)}`,
    payLine,
    `${"benefits ".repeat(600)}`,
    "Equal opportunity employer.",
  ].join("\n");
}

describe("htmlToText pay lines", () => {
  it("keeps a pay line from the elided middle", () => {
    const out = htmlToText(longPosting("Salary range $150,000 to $190,000 USD"))!;
    expect(out).toContain("Salary range $150,000 to $190,000 USD");
    expect(out).toContain("LEAD THE PRACTICE.");
    expect(out).toContain("Equal opportunity employer.");
    expect(out.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
  });

  it.each(["Base pay £95,000 to £110,000", "Base pay €120k plus bonus"])("keeps a non-dollar pay line: %s", line => {
    expect(htmlToText(longPosting(line))).toContain(line);
  });

  it("keeps only an excerpt around the amount from a very long line", () => {
    const line = `${"context ".repeat(60)}Compensation $175,000 annually ${"detail ".repeat(60)}`;
    const out = htmlToText(longPosting(line))!;
    expect(out).toContain("Compensation $175,000 annually");
    expect(out).not.toContain(line.trim());
    expect(out.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
  });

  it("leaves the plain head and tail cut when the middle names no pay", () => {
    const out = htmlToText(longPosting("Travel up to 20% of the time"))!;
    expect(out.match(/middle of posting omitted/g)).toHaveLength(1);
    expect(out).not.toContain("Travel up to 20%");
  });

  it("keeps a salary line the plain cut kept, and no budget or stipend in its place", () => {
    const out = htmlToText([
      `LEAD THE PRACTICE. ${"mission ".repeat(800)}`,
      "Own a $500k annual vendor budget.", "Learning stipend of $10,000.", "Relocation support up to $15,000.",
      `${"responsibility ".repeat(150)}`,
      "Salary range $150,000 to $190,000 USD", "Location: US remote only",
      `${"benefits ".repeat(290)}`, "Equal opportunity employer.",
    ].join("\n"))!;
    expect(out).toContain("Salary range $150,000 to $190,000 USD");
    expect(out).toContain("Location: US remote only");
    expect(out).not.toMatch(/vendor budget|stipend|Relocation/);
    expect(out.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
  });

  it("keeps the salary and leaves out other amounts when both sit in the middle", () => {
    const out = htmlToText([
      `LEAD THE PRACTICE. ${"mission ".repeat(800)}`,
      "Learning stipend of $10,000.", `${"responsibility ".repeat(150)}`, "Compensation: $150,000 to $190,000",
      `${"benefits ".repeat(600)}`, "Equal opportunity employer.",
    ].join("\n"))!;
    expect(out).toContain("Compensation: $150,000 to $190,000");
    expect(out).not.toContain("stipend");
  });

  it("gives up only the room the kept line needs, so text near the start of the tail survives", () => {
    const out = htmlToText([
      `LEAD THE PRACTICE. ${"mission ".repeat(800)}`, `${"responsibility ".repeat(150)}`, "Salary $150,000 to $190,000",
      `${"benefits ".repeat(60)}`, "Location: US remote only", `${"benefits ".repeat(300)}`, "Equal opportunity employer.",
    ].join("\n"))!;
    expect(out).toContain("Salary $150,000 to $190,000");
    expect(out).toContain("Location: US remote only");
  });

  it("keeps a bare amount when nothing after the head names pay", () => {
    expect(htmlToText(longPosting("Up to $120k"))).toContain("Up to $120k");
  });

  it("records the normalizer that kept the pay line", () => {
    const { provenance } = htmlToTextWithProvenance(longPosting("Salary range $150,000 to $190,000"), MAX_DESCRIPTION_CHARS, ["synthetic.description"]);
    expect(provenance).toMatchObject({ truncated: true, normalizerVersion: "plain-text-v3" });
    expect(provenance.retainedChars).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
  });
});
