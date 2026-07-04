import { fail, ok } from "@/lib/api-response";
import { hashPassword } from "@/lib/auth/password";
import { getTraceId } from "@/lib/middleware/trace";
import { prisma } from "@/lib/prisma";

function normalizePhoneAccount(account: string) {
  return account.replace(/\s+/g, "");
}

export async function POST(request: Request) {
  const traceId = getTraceId(request);

  try {
    const body = (await request.json()) as {
      account?: string;
      name?: string;
      password?: string;
    };
    const account = normalizePhoneAccount(body.account ?? "");
    const password = body.password ?? "";
    const name = body.name?.trim() || "运营管理员";

    if (!account) {
      return fail("请输入账号", { status: 400, traceId });
    }

    if (!password) {
      return fail("请输入密码", { status: 400, traceId });
    }

    if (!/^1\d{10}$/.test(account)) {
      return fail("请输入有效手机号账号", { status: 400, traceId });
    }

    const existingUser = await prisma.user.findUnique({
      where: { phone: account },
      select: { id: true }
    });

    if (existingUser) {
      return fail("账号已存在", { status: 409, traceId });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: `${account}@dispatch.local`,
        phone: account,
        name,
        password: passwordHash,
        role: "admin"
      },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        role: true
      }
    });

    return ok(user, { status: 201, traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "注册失败，请稍后重试";

    return fail(message, { status: 500, traceId });
  }
}
