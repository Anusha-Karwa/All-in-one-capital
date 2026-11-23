"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SECTORS = [
  ["fintech", "Fintech"],
  ["deeptech", "Deeptech"],
  ["consumer_tech", "Consumer tech"],
  ["consumer_brand", "Consumer brand"],
  ["other", "Other"],
] as const;
const STAGES = [
  ["idea", "Idea"],
  ["pre_seed", "Pre-seed"],
  ["seed", "Seed"],
  ["series_a", "Series A"],
  ["later", "Later"],
] as const;

type Founder = {
  fullName: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  role: string;
  background: string;
};
const blankFounder = (): Founder => ({ fullName: "", email: "", phone: "", linkedinUrl: "", role: "", background: "" });

const field = "flex flex-col gap-1 text-sm";
const select = "h-9 rounded-md border bg-background px-3 text-sm";

export function ApplyForm() {
  const router = useRouter();
  const [founders, setFounders] = useState<Founder[]>([blankFounder()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    const f = new FormData(e.currentTarget);
    const payload = {
      companyName: f.get("companyName"),
      website: f.get("website"),
      sector: f.get("sector"),
      stage: f.get("stage"),
      location: f.get("location"),
      incorporated: f.get("incorporated"),
      amountRaising: f.get("amountRaising"),
      valuation: f.get("valuation"),
      oneLiner: f.get("oneLiner"),
      howHeard: f.get("howHeard"),
      referrer: f.get("referrer"),
      founders,
      consent: f.get("consent") === "on",
    };
    const body = new FormData();
    body.set("payload", JSON.stringify(payload));
    body.set("fax", String(f.get("fax") ?? ""));
    for (const k of ["deck", "form"]) {
      const file = f.get(k);
      if (file instanceof File && file.size) body.set(k, file);
    }
    try {
      const res = await fetch("/api/applications", { method: "POST", body });
      const json = await res.json();
      if (res.ok && json.publicRef) router.push(`/apply/thanks?ref=${encodeURIComponent(json.publicRef)}`);
      else if (res.ok) router.push("/apply/thanks");
      else
        setErrors(
          json.issues?.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`) ?? [json.error],
        );
    } catch {
      setErrors(["Network error — please try again."]);
    } finally {
      setBusy(false);
    }
  }

  const setF = (i: number, k: keyof Founder, v: string) =>
    setFounders((fs) => fs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <label className={field}>
          Company name *<Input name="companyName" required minLength={2} />
        </label>
        <label className={field}>
          Website
          <Input name="website" type="url" placeholder="https://" />
        </label>
        <label className={field}>
          Sector *
          <select name="sector" required className={select} defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {SECTORS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          Stage *
          <select name="stage" required className={select} defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {STAGES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          City / country
          <Input name="location" />
        </label>
        <label className={field}>
          Incorporated (year / entity)
          <Input name="incorporated" />
        </label>
        <label className={field}>
          Amount raising
          <Input name="amountRaising" placeholder="e.g. ₹1.2 Cr" />
        </label>
        <label className={field}>
          Valuation (if set)
          <Input name="valuation" />
        </label>
        <label className={`${field} sm:col-span-2`}>
          One line: what you do
          <Input name="oneLiner" maxLength={300} />
        </label>
        <label className={field}>
          How did you hear about us?
          <select name="howHeard" className={select} defaultValue="public_form">
            <option value="public_form">Website / public form</option>
            <option value="warm_intro">Warm introduction</option>
            <option value="event">Event</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className={field}>
          If introduced, by whom?
          <Input name="referrer" />
        </label>
      </section>

      <section className="space-y-4">
        <h2 className="font-medium">Founders</h2>
        {founders.map((fd, i) => (
          <div key={i} className="grid gap-3 rounded-md border p-4 sm:grid-cols-2">
            <label className={field}>
              Full name *<Input required value={fd.fullName} onChange={(e) => setF(i, "fullName", e.target.value)} />
            </label>
            <label className={field}>
              Role *
              <Input
                required
                value={fd.role}
                onChange={(e) => setF(i, "role", e.target.value)}
                placeholder="CEO, CTO…"
              />
            </label>
            <label className={field}>
              Email *<Input required type="email" value={fd.email} onChange={(e) => setF(i, "email", e.target.value)} />
            </label>
            <label className={field}>
              Phone
              <Input value={fd.phone} onChange={(e) => setF(i, "phone", e.target.value)} />
            </label>
            <label className={`${field} sm:col-span-2`}>
              LinkedIn URL
              <Input type="url" value={fd.linkedinUrl} onChange={(e) => setF(i, "linkedinUrl", e.target.value)} />
            </label>
            <label className={`${field} sm:col-span-2`}>
              Background (what you&apos;ve done before — no contact details here)
              <textarea
                className="min-h-20 rounded-md border bg-background p-2 text-sm"
                maxLength={600}
                value={fd.background}
                onChange={(e) => setF(i, "background", e.target.value)}
              />
            </label>
            {founders.length > 1 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setFounders((fs) => fs.filter((_, j) => j !== i))}
              >
                Remove founder
              </Button>
            )}
          </div>
        ))}
        {founders.length < 6 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFounders((fs) => [...fs, blankFounder()])}
          >
            Add founder
          </Button>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <label className={field}>
          Pitch deck (PDF, ≤ 20 MB) *<Input name="deck" type="file" accept="application/pdf" required />
        </label>
        <label className={field}>
          Anything else (PDF, optional)
          <Input name="form" type="file" accept="application/pdf" />
        </label>
      </section>

      {/* honeypot — hidden from people, filled by bots */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Fax
          <input name="fax" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" required className="mt-1" />
        <span>
          I have read the{" "}
          <a className="underline" href="/privacy" target="_blank">
            privacy notice
          </a>{" "}
          and consent to All In Capital processing this application, including automated assistance in reviewing it. A
          person reviews every application.
        </span>
      </label>

      {errors.length > 0 && (
        <ul className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? "Submitting…" : "Submit application"}
      </Button>
    </form>
  );
}
