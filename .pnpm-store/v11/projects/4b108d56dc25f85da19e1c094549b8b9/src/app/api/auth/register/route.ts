import { fail, ok } from "@/lib/api-response";
import { hashPassword } from "@/lib/auth/password";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";

function normalizePhoneAccount(account: string) {
  return account.replace(/\s+/g, "");
}

export async function POST(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();

  try {
    const body = (await request.json()) as {
      account?: string;
      name?: string;
      password?: string;
      role?: string;
      alsoDriver?: boolean;
      storeId?: string;
    };
    const account = normalizePhoneAccount(body.account ?? "");
    const password = body.password ?? "";
    const name = body.name?.trim() || "运营管理员";
    const role = body.role && isAdminRole(body.role) ? body.role : "admin";
    const alsoDriver = body.alsoDriver === true && isAdminRole(role);
    const storeId = body.storeId?.trim();

    if (!account) {
      return fail("请输入账号", { status: 400, traceId });
    }

    if (!password) {
      return fail("请输入密码", { status: 400, traceId });
    }

    if (!/^1\d{10}$/.test(account)) {
      return fail("请输入有效手机号账号", { status: 400, traceId });
    }

    if (alsoDriver && !storeId) {
      return fail("注册为司机需要选择所属门店", { status: 400, traceId });
    }

    const existingUser = await prisma.user.findUnique({
      where: { phone: account },
      select: { id: true }
    });

    if (existingUser) {
      return fail("账号已存在", { status: 409, traceId });
    }

    const passwordHash = await hashPassword(password);

    let driverId: string | null = null;

    if (alsoDriver && storeId) {
      // 验证门店存在
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true, isActive: true }
      });

      if (!store || !store.isActive) {
        return fail("所选门店不存在或已停用", { status: 400, traceId });
      }

      // 先创建 Driver 记录
      const driver = await prisma.driver.create({
        data: {
          storeId,
          name,
          phone: account,
          status: "S1",
          isActive: true
        },
        select: { id: true }
      });

      driverId = driver.id;
    }

    const user = await prisma.user.create({
      data: {
        email: `${account}@dispatch.local`,
        phone: account,
        name,
        password: passwordHash,
        role,
        driverId
      },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        role: true,
        driverId: true
      }
    });

    return ok(user, { status: 201, traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "注册失败，请稍后重试";

    return fail(message, { status: 500, traceId });
  }
}
