/**
 * Scheduling rules (BUILD_SPEC §8.3, R11) — pure functions the LangGraph agent (Phase 8) calls.
 *
 *  - Calls: Tuesday or Thursday, 14:00–18:00 IST, 30 minutes.
 *  - Proposed slots: ≥ 2 business days out, ≤ 14 days out, 3 of them, free for every attendee, never a rejected time.
 *  - Attendees: Riya always; Aditya ONLY for deeptech (kill criterion 9).
 *  - No reply: follow-up at ≥ 48h (47h59m → still waiting); another 48h silent → escalate.
 *  - Counter-proposals: reply_round 1 → loop back; reply_round 2 without confirmation → escalate (at cap, not cap+1).
 * Public holidays are not modelled (documented limitation — a human approves every proposal email).
 */
export const IST_OFFSET_MS = 5.5 * 3600 * 1000;
export const CALL_DAYS = [2, 4] as const; // Tue, Thu (0 = Sunday)
export const WINDOW = { startHour: 14, endHour: 18, slotMinutes: 30 } as const;
export const MIN_BUSINESS_DAYS_OUT = 2;
export const MAX_DAYS_OUT = 14;
export const FOLLOW_UP_AFTER_MS = 48 * 3600 * 1000;
export const MAX_REPLY_ROUNDS = 2;

export interface Interval {
  start: Date;
  end: Date;
}
export type Attendee = "riya" | "aditya";

export function attendeesFor(isDeeptech: boolean): Attendee[] {
  return isDeeptech ? ["riya", "aditya"] : ["riya"];
}

/** IST calendar parts of a UTC instant. */
function ist(d: Date) {
  const x = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    y: x.getUTCFullYear(),
    m: x.getUTCMonth(),
    day: x.getUTCDate(),
    dow: x.getUTCDay(),
    h: x.getUTCHours(),
    min: x.getUTCMinutes(),
    s: x.getUTCSeconds(),
  };
}
/** UTC instant for an IST wall-clock time. */
export function istTime(y: number, m: number, day: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m, day, h, min) - IST_OFFSET_MS);
}

/** Start (IST midnight) of the day that is `n` business days (Mon–Fri) after `now`'s IST date. */
export function businessDaysAfter(now: Date, n: number): Date {
  const p = ist(now);
  let cur = istTime(p.y, p.m, p.day, 0);
  let left = n;
  while (left > 0) {
    cur = new Date(cur.getTime() + 24 * 3600 * 1000);
    const dow = ist(cur).dow;
    if (dow !== 0 && dow !== 6) left--;
  }
  return cur;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export interface SlotRules {
  now: Date;
}

/** Whether a slot obeys every rule (used to validate a founder's counter-proposal too). */
export function slotViolations(slot: Interval, { now }: SlotRules): string[] {
  const v: string[] = [];
  const p = ist(slot.start);
  const e = ist(slot.end);
  if (!(CALL_DAYS as readonly number[]).includes(p.dow)) v.push("not Tue/Thu");
  if (slot.end.getTime() - slot.start.getTime() !== WINDOW.slotMinutes * 60_000) v.push("not 30 minutes");
  const startMin = p.h * 60 + p.min;
  const endMin = e.h * 60 + e.min + (e.day !== p.day ? 24 * 60 : 0);
  if (startMin < WINDOW.startHour * 60 || endMin > WINDOW.endHour * 60) v.push("outside 14:00–18:00 IST");
  if (slot.start < businessDaysAfter(now, MIN_BUSINESS_DAYS_OUT)) v.push("less than 2 business days out");
  if (slot.start.getTime() > now.getTime() + MAX_DAYS_OUT * 24 * 3600 * 1000) v.push("more than 14 days out");
  return v;
}

export function candidateSlots(now: Date): Interval[] {
  const out: Interval[] = [];
  const first = businessDaysAfter(now, MIN_BUSINESS_DAYS_OUT);
  for (let i = 0; i <= MAX_DAYS_OUT + 1; i++) {
    const dayStart = new Date(first.getTime() + i * 24 * 3600 * 1000);
    const p = ist(dayStart);
    if (!(CALL_DAYS as readonly number[]).includes(p.dow)) continue;
    for (
      let mins = WINDOW.startHour * 60;
      mins + WINDOW.slotMinutes <= WINDOW.endHour * 60;
      mins += WINDOW.slotMinutes
    ) {
      const start = istTime(p.y, p.m, p.day, Math.floor(mins / 60), mins % 60);
      const slot = { start, end: new Date(start.getTime() + WINDOW.slotMinutes * 60_000) };
      if (slotViolations(slot, { now }).length === 0) out.push(slot);
    }
  }
  return out;
}

/**
 * Propose up to `count` slots free for all attendees, never a rejected time; spread across different days first.
 * Returns [] when nothing fits → the agent escalates to a human.
 */
export function proposeSlots(opts: {
  now: Date;
  busy: Interval[];
  rejectedStarts: string[];
  count?: number;
}): Interval[] {
  const count = opts.count ?? 3;
  const rejected = new Set(opts.rejectedStarts.map((s) => new Date(s).toISOString()));
  const free = candidateSlots(opts.now).filter(
    (s) => !rejected.has(s.start.toISOString()) && !opts.busy.some((b) => overlaps(s, b)),
  );
  const picked: Interval[] = [];
  const dayKey = (s: Interval) => `${ist(s.start).y}-${ist(s.start).m}-${ist(s.start).day}`;
  const usedDays = new Set<string>();
  for (const s of free) {
    if (picked.length >= count) break;
    if (!usedDays.has(dayKey(s))) {
      picked.push(s);
      usedDays.add(dayKey(s));
    }
  }
  for (const s of free) {
    if (picked.length >= count) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export type SilenceAction = "wait" | "send_follow_up" | "escalate";

/** What to do when the founder hasn't replied. Exactly 48h is the boundary (≥ 48h acts). */
export function onSilence(lastOutboundAt: Date, now: Date, followUpsSent: number): SilenceAction {
  if (now.getTime() - lastOutboundAt.getTime() < FOLLOW_UP_AFTER_MS) return "wait";
  return followUpsSent === 0 ? "send_follow_up" : "escalate";
}

/** After a counter-proposal: loop back once; at the cap, escalate (never a cap+1 round). */
export function onCounterProposal(replyRound: number): { replyRound: number; next: "propose_again" | "escalate" } {
  const r = replyRound + 1;
  return { replyRound: r, next: r >= MAX_REPLY_ROUNDS ? "escalate" : "propose_again" };
}
