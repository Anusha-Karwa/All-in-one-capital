import { describe, expect, it } from "vitest";
import {
  attendeesFor,
  businessDaysAfter,
  candidateSlots,
  istTime,
  onCounterProposal,
  onSilence,
  proposeSlots,
  slotViolations,
} from "./scheduling";

// Monday 23 Nov 2026, 11:00 IST
const NOW = istTime(2026, 10, 23, 11);
const slot = (y: number, m: number, d: number, h: number, min = 0) => ({
  start: istTime(y, m, d, h, min),
  end: istTime(y, m, d, h, min + 30),
});
const istHM = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 16);

describe("attendees (KILL-9)", () => {
  it("Aditya joins deeptech only", () => {
    expect(attendeesFor(true)).toEqual(["riya", "aditya"]);
    expect(attendeesFor(false)).toEqual(["riya"]);
  });
});

describe("slots", () => {
  it("2 business days after Monday is Wednesday; after Friday is Tuesday", () => {
    expect(istHM(businessDaysAfter(NOW, 2))).toBe("2026-11-25T00:00");
    expect(istHM(businessDaysAfter(istTime(2026, 10, 27, 16), 2))).toBe("2026-12-01T00:00");
  });

  it("all candidates are Tue/Thu 14:00–17:30 IST starts, ≥2 business days, ≤14 days", () => {
    const c = candidateSlots(NOW);
    expect(c.length).toBeGreaterThan(0);
    for (const s of c) {
      expect(slotViolations(s, { now: NOW })).toEqual([]);
      const t = istHM(s.start).slice(11);
      expect(t >= "14:00" && t <= "17:30").toBe(true);
    }
    expect(istHM(c[0].start)).toBe("2026-11-26T14:00"); // Thu (Tue 24th is <2 business days)
    expect(istHM(c.at(-1)!.start)).toBe("2026-12-03T17:30"); // Thu 3 Dec; Tue 8 Dec is past now + 14 days (Mon 7 Dec 11:00)
  });

  it("rejects counter-proposals that break a rule", () => {
    expect(slotViolations(slot(2026, 10, 26, 16), { now: NOW })).toEqual([]); // "Thursday works, 4pm" ✓
    expect(slotViolations(slot(2026, 10, 25, 15), { now: NOW })).toContain("not Tue/Thu"); // Wednesday
    expect(slotViolations(slot(2026, 10, 26, 18), { now: NOW })).toContain("outside 14:00–18:00 IST");
    expect(slotViolations(slot(2026, 10, 26, 13, 30), { now: NOW })).toContain("outside 14:00–18:00 IST");
    expect(slotViolations(slot(2026, 10, 24, 15), { now: NOW })).toContain("less than 2 business days out");
    expect(slotViolations(slot(2026, 11, 10, 15), { now: NOW })).toContain("more than 14 days out");
    expect(
      slotViolations({ start: istTime(2026, 10, 26, 15), end: istTime(2026, 10, 26, 16) }, { now: NOW }),
    ).toContain("not 30 minutes");
  });

  it("proposes 3 free slots on different days, skipping busy and rejected times", () => {
    const busy = [{ start: istTime(2026, 10, 26, 14), end: istTime(2026, 10, 26, 15) }]; // Aditya busy Thu 14–15
    const p = proposeSlots({ now: NOW, busy, rejectedStarts: [istTime(2026, 11, 1, 14).toISOString()] });
    expect(p.map((s) => istHM(s.start))).toEqual(["2026-11-26T15:00", "2026-12-01T14:30", "2026-12-03T14:00"]);
  });

  it("returns [] when nothing fits (agent escalates)", () => {
    expect(
      proposeSlots({ now: NOW, busy: [{ start: NOW, end: istTime(2026, 11, 31, 0) }], rejectedStarts: [] }),
    ).toEqual([]);
  });
});

describe("timers and caps (D11)", () => {
  const sent = istTime(2026, 10, 23, 10);
  const at = (h: number, m = 0) => new Date(sent.getTime() + (h * 60 + m) * 60_000);
  it("47h59m silent → wait; 48h → follow-up; after a follow-up, 48h more → escalate", () => {
    expect(onSilence(sent, at(47, 59), 0)).toBe("wait");
    expect(onSilence(sent, at(48, 0), 0)).toBe("send_follow_up");
    expect(onSilence(sent, at(48, 1), 0)).toBe("send_follow_up");
    expect(onSilence(sent, at(47, 59), 1)).toBe("wait");
    expect(onSilence(sent, at(48, 1), 1)).toBe("escalate");
  });
  it("counter once → propose again; second counter → escalate exactly at the cap", () => {
    expect(onCounterProposal(0)).toEqual({ replyRound: 1, next: "propose_again" });
    expect(onCounterProposal(1)).toEqual({ replyRound: 2, next: "escalate" });
  });
});
