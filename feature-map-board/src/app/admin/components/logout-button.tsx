"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", {
      method: "POST"
    });
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => {
        void handleLogout();
      }}
      className="text-sm text-slate-600 underline underline-offset-4"
    >
      退出登录
    </button>
  );
}
