import { env } from "@/env";
import { ApplyForm } from "./ApplyForm";

// Reads BLOB_READ_WRITE_TOKEN at request time to choose direct-to-Blob uploads.
export const dynamic = "force-dynamic";

export const metadata = { title: "Apply — All In Capital" };

export default function ApplyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Apply to All In Capital</h1>
      <p className="text-sm text-muted-foreground">
        Tell us about your company. You&apos;ll get a reference number straight away; a person on the team reads every
        application.
      </p>
      <ApplyForm directUpload={Boolean(env().BLOB_READ_WRITE_TOKEN)} />
    </div>
  );
}
