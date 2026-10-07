"use client";
import { useRouter } from "next/navigation";

export function SignOut() {
  const router = useRouter();
  return (
    <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/admin/login"); }}>
      Sign out
    </button>
  );
}
