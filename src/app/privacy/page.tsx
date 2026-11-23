export const metadata = { title: "Privacy notice — All In Capital applications" };

export default function Privacy() {
  return (
    <article className="prose prose-sm mx-auto max-w-2xl space-y-3 text-sm">
      <h1 className="text-xl font-semibold">Privacy notice for applicants</h1>
      <p className="text-xs text-muted-foreground">DRAFT — to be reviewed by the fund before going live.</p>
      <h2 className="font-medium">What we collect</h2>
      <p>
        Your company details, your pitch deck and other documents you upload, and for each founder: name, email, phone
        (optional), LinkedIn URL (optional), role and a short background.
      </p>
      <h2 className="font-medium">Why</h2>
      <p>To assess your application and, if we&apos;d like to talk, to contact you and schedule a call.</p>
      <h2 className="font-medium">How it is used</h2>
      <p>
        We use software, including AI models, to help summarise your application and check it against public information
        about your company. Founder contact details are stored encrypted and are not sent to AI models.{" "}
        <strong>No application is rejected or advanced automatically</strong> — a person on the team reviews every one.
      </p>
      <h2 className="font-medium">How long we keep it</h2>
      <p>
        If we do not proceed, we delete your personal data 180 days after our decision. You can ask us to export or
        delete your data at any time by replying to any email from us and quoting your reference number.
      </p>
      <h2 className="font-medium">Your rights</h2>
      <p>
        You may access, correct or erase your personal data and withdraw consent, as provided by India&apos;s Digital
        Personal Data Protection Act, 2023 and, where it applies, the GDPR.
      </p>
    </article>
  );
}
