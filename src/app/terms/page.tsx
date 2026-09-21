"use client";

import { LegalLayout } from "@/components/legal-layout";
import { useT } from "@/i18n/i18n-context";

export default function TermsPage() {
  const t = useT();
  return <LegalLayout title={t.legal.termsTitle} body={t.legal.termsBody} />;
}
