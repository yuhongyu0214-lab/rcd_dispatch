import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { isAdminRole } from "./roles";

export class WorkspaceAccountError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409
  ) {
    super(message);
    this.name = "WorkspaceAccountError";
  }
}

export function isAccountWriteConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

async function resolveDriver(
  tx: Prisma.TransactionClient,
  account: { phone: string; name: string; storeId?: string }
) {
  const existing = await tx.driver.findUnique({
    where: { phone: account.phone },
    select: {
      id: true,
      storeId: true,
      isActive: true,
      user: { select: { id: true } }
    }
  });
  if (existing?.user) {
    throw new WorkspaceAccountError(
      "该手机号的司机档案已关联其他账号，请联系管理员核对",
      409
    );
  }
  if (existing && !existing.isActive) {
    throw new WorkspaceAccountError(
      "司机档案已停用，请联系管理员核对；调度工作台仍可使用",
      409
    );
  }
  if (existing && account.storeId && existing.storeId !== account.storeId) {
    throw new WorkspaceAccountError(
      "所选门店与已有司机档案不一致，请选择原所属门店",
      409
    );
  }
  const storeId = existing?.storeId ?? account.storeId;
  if (!storeId) {
    throw new WorkspaceAccountError("请选择所属门店，完成司机档案", 400);
  }
  const store = await tx.store.findUnique({
    where: { id: storeId },
    select: { isActive: true }
  });
  if (!store?.isActive) {
    throw new WorkspaceAccountError("所选门店不存在或已停用", 400);
  }
  if (existing) return existing.id;

  const driver = await tx.driver.create({
    data: {
      phone: account.phone,
      name: account.name,
      storeId,
      status: "OFFLINE",
      onShift: false,
      isActive: true
    },
    select: { id: true }
  });
  return driver.id;
}

/** 注册账号和司机档案同时成功或同时回滚，禁止留下半注册数据。 */
export async function createWorkspaceAccount(input: {
  phone: string;
  name: string;
  passwordHash: string;
  storeId: string;
}) {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.user.findUnique({
        where: { phone: input.phone },
        select: { id: true }
      });
      if (existing) throw new WorkspaceAccountError("账号已存在", 409);
      const driverId = await resolveDriver(tx, input);
      return tx.user.create({
        data: {
          phone: input.phone,
          email: `${input.phone}@dispatch.local`,
          name: input.name,
          password: input.passwordHash,
          role: "dispatcher",
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
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

/** 只允许已登录用户补全自己的档案，手机号和姓名均从数据库读取。 */
export async function completeWorkspaceDriver(
  userId: string,
  storeId?: string
) {
  return prisma.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          phone: true,
          name: true,
          role: true,
          driverId: true
        }
      });
      if (!user || !isAdminRole(user.role)) {
        throw new WorkspaceAccountError("该账号不可使用工作台", 403);
      }
      // 重试和已有双端账号不重新绑定，不修改历史角色、密码或档案状态。
      if (user.driverId) return { driverId: user.driverId };
      const driverId = await resolveDriver(tx, {
        phone: user.phone,
        name: user.name,
        storeId
      });
      await tx.user.update({
        where: { id: user.id },
        data: { driverId },
        select: { id: true }
      });
      return { driverId };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
