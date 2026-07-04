import { fail, ok } from "@/lib/api-response";
import { findUserForLogin } from "@/lib/auth/current-user";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, getSessionCookieOptions } from "@/lib/auth/session";

export async function POST(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();

  try {
    const body = (await request.json()) as {
      account?: string;
      email?: string;
      password?: string;
    };
    const account = (body.account ?? body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";

    if (!account) {
      return fail("请输入账号", { status: 400, traceId });
    }

    if (!password) {
      return fail("请输入密码", { status: 400, traceId });
    }

    const user = await findUserForLogin(account);

    if (!user) {
      return fail("账号/密码错误", { status: 401, traceId });
    }

    const passwordMatched = await verifyPassword(password, user.password);

    if (!passwordMatched) {
      return fail("账号/密码错误", { status: 401, traceId });
    }

    const token = createSessionToken({
      userId: user.id,
      role: user.role
    });
    const response = ok(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      { traceId }
    );

    response.cookies.set({
      ...getSessionCookieOptions(),
      value: token
    });

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "登录失败，请稍后重试";

    return fail(message, { status: 500, traceId });
  }
}
