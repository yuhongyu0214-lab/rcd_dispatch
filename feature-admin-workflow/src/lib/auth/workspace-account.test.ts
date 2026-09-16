import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: vi.fn() } }));

import { prisma } from "@/lib/prisma";
import {
  completeWorkspaceDriver,
  createWorkspaceAccount,
  isAccountWriteConflict
} from "./workspace-account";

const tx = {
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  driver: { findUnique: vi.fn(), create: vi.fn() },
  store: { findUnique: vi.fn() }
};
const input = {
  phone: "19900000011",
  name: "测试用户",
  passwordHash: "test-hash",
  storeId: "store-1"
};
const account = {
  id: "user-1",
  phone: input.phone,
  name: input.name,
  role: "admin",
  driverId: null
};
const existingDriver = {
  id: "driver-old",
  isActive: true,
  storeId: "store-1",
  user: null
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
    if (typeof callback !== "function")
      throw new Error("Interactive transaction required");
    return callback(tx as unknown as Prisma.TransactionClient);
  });
  tx.user.findUnique.mockResolvedValue(null);
  tx.driver.findUnique.mockResolvedValue(null);
  tx.store.findUnique.mockResolvedValue({ isActive: true });
  tx.driver.create.mockResolvedValue({ id: "driver-new" });
  tx.user.create.mockResolvedValue({
    id: "user-1",
    role: "dispatcher",
    driverId: "driver-new"
  });
  tx.user.update.mockResolvedValue({ id: "user-1" });
});

describe("unified workspace registration", () => {
  it("creates both identities in a serializable transaction, initially off shift", async () => {
    await expect(createWorkspaceAccount(input)).resolves.toMatchObject({
      role: "dispatcher",
      driverId: "driver-new"
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable"
    });
    expect(tx.driver.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          phone: input.phone,
          name: input.name,
          storeId: "store-1",
          status: "OFFLINE",
          onShift: false,
          isActive: true
        }
      })
    );
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "dispatcher",
          driverId: "driver-new",
          password: "test-hash"
        })
      })
    );
  });
  it("reuses an unowned active driver by phone without recreating or changing it", async () => {
    tx.driver.findUnique.mockResolvedValue(existingDriver);
    await createWorkspaceAccount(input);
    expect(tx.driver.create).not.toHaveBeenCalled();
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ driverId: "driver-old" })
      })
    );
  });
  it.each([
    { ...existingDriver, user: { id: "someone-else" } },
    { ...existingDriver, isActive: false },
    { ...existingDriver, storeId: "other-store" }
  ])(
    "rejects an occupied, inactive or different-store driver: %j",
    async (driver) => {
      tx.driver.findUnique.mockResolvedValue(driver);
      await expect(createWorkspaceAccount(input)).rejects.toMatchObject({
        status: 409
      });
      expect(tx.user.create).not.toHaveBeenCalled();
      expect(tx.driver.create).not.toHaveBeenCalled();
    }
  );
  it("rejects duplicate users before any write", async () => {
    tx.user.findUnique.mockResolvedValue(account);
    await expect(createWorkspaceAccount(input)).rejects.toMatchObject({
      status: 409
    });
    expect(tx.driver.create).not.toHaveBeenCalled();
  });
  it.each([null, { isActive: false }])(
    "rejects missing or disabled stores: %j",
    async (store) => {
      tx.store.findUnique.mockResolvedValue(store);
      await expect(createWorkspaceAccount(input)).rejects.toMatchObject({
        status: 400
      });
      expect(tx.driver.create).not.toHaveBeenCalled();
    }
  );
  it("propagates User insert failure out of the transaction so Prisma rolls back Driver creation", async () => {
    tx.user.create.mockRejectedValue(new Error("permission denied"));
    await expect(createWorkspaceAccount(input)).rejects.toThrow(
      "permission denied"
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("historical account profile completion", () => {
  it.each(["admin", "dispatcher", "driver"])(
    "uses DB identity for %s and only updates its driver link",
    async (role) => {
      tx.user.findUnique.mockResolvedValue({ ...account, role });
      await expect(
        completeWorkspaceDriver("user-1", "store-1")
      ).resolves.toEqual({ driverId: "driver-new" });
      expect(tx.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "user-1" } })
      );
      expect(tx.driver.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { phone: input.phone } })
      );
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { driverId: "driver-new" },
        select: { id: true }
      });
    }
  );
  it("is idempotent for an already linked account", async () => {
    tx.user.findUnique.mockResolvedValue({
      ...account,
      driverId: "driver-linked"
    });
    await expect(
      completeWorkspaceDriver("user-1", "other-store")
    ).resolves.toEqual({ driverId: "driver-linked" });
    expect(tx.driver.findUnique).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });
  it("keeps an existing same-phone profile's store when no store is submitted", async () => {
    tx.user.findUnique.mockResolvedValue(account);
    tx.driver.findUnique.mockResolvedValue(existingDriver);
    await expect(completeWorkspaceDriver("user-1")).resolves.toEqual({
      driverId: "driver-old"
    });
    expect(tx.store.findUnique).toHaveBeenCalledWith({
      where: { id: "store-1" },
      select: { isActive: true }
    });
  });
  it("does not invent a store for an unlinked account", async () => {
    tx.user.findUnique.mockResolvedValue(account);
    await expect(completeWorkspaceDriver("user-1")).rejects.toMatchObject({
      status: 400
    });
    expect(tx.driver.create).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...account, role: "system" },
    { ...account, role: "unknown" }
  ])("fails closed after user deletion or role change: %j", async (user) => {
    tx.user.findUnique.mockResolvedValue(user);
    await expect(
      completeWorkspaceDriver("user-1", "store-1")
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.driver.create).not.toHaveBeenCalled();
  });
  it.each(["P2002", "P2034"])(
    "recognizes concurrent write conflict %s",
    (code) => {
      expect(
        isAccountWriteConflict(
          new Prisma.PrismaClientKnownRequestError("conflict", {
            code,
            clientVersion: "test"
          })
        )
      ).toBe(true);
      expect(isAccountWriteConflict(new Error("secret database error"))).toBe(
        false
      );
    }
  );
});
