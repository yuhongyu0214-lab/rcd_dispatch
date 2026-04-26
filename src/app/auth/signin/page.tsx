"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/admin";

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    const result = await signIn("credentials", {
      identifier,
      password,
      redirect: false,
      callbackUrl
    });

    setIsSubmitting(false);

    if (!result || result.error) {
      setErrorMessage("账号或密码错误");
      return;
    }

    router.push(result.url ?? "/admin");
    router.refresh();
  }

  return (
    <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <p className="text-sm font-medium uppercase tracking-[0.3em] text-primary">
        Stage 3
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">登录后台</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        使用邮箱或手机号与密码登录。当前默认管理员支持两种账号：
        admin@dispatch.dev 或 13800000000。
      </p>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <label className="block text-sm font-medium text-slate-700">
          邮箱或手机号
          <input
            className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-primary"
            type="text"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="admin@dispatch.dev 或 13800000000"
            autoComplete="username"
            required
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          密码
          <input
            className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-primary"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="请输入密码"
            autoComplete="current-password"
            required
          />
        </label>

        {errorMessage ? (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
            {errorMessage}
          </p>
        ) : null}

        <button
          className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "登录中..." : "登录"}
        </button>
      </form>

      <div className="mt-6 rounded-2xl bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
        <p>默认账号：</p>
        <p>邮箱：admin@dispatch.dev</p>
        <p>手机号：13800000000</p>
        <p>密码：admin123</p>
      </div>

      <Link className="mt-6 inline-flex text-sm text-primary" href="/">
        返回首页
      </Link>
    </div>
  );
}

function SignInFallback() {
  return (
    <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <p className="text-sm text-slate-500">加载中...</p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16 text-foreground">
      <Suspense fallback={<SignInFallback />}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
