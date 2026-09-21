"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { AuthForm } from "@/components/auth/auth-form";

export default function SignupPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Уже залогинен — на главную (в чат).
  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  return <AuthForm mode="signup" />;
}
