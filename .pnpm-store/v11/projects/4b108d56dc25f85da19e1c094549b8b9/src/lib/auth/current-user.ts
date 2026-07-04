import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";

import { isAdminRole } from "./roles";
import {
  AUTH_SESSION_COOKIE_NAME,
  type AuthSession,
  verifySessionToken
} from "./session";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  driverId: string | null;
};

export async function findUserForLogin(account: string) {
  const normalizedAccount = account.trim().toLowerCase();
  const where = normalizedAccount.includes("@")
    ? { email: normalizedAccount }
    : { phone: normalizedAccount };

  return prisma.user.findUnique({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      password: true,
      role: true,
      driverId: true
    }
  });
}

async function readSessionPayload(): Promise<AuthSession | null> {
  try {
    const token = cookies().get(AUTH_SESSION_COOKIE_NAME)?.value;

    if (!token) {
      return null;
    }

    return verifySessionToken(token);
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await readSessionPayload();

  if (!session) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      driverId: true
    }
  });

  if (!user) {
    return null;
  }

  return user;
}

export async function requireAdminPage(nextPath: string) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (!isAdminRole(currentUser.role)) {
    redirect("/");
  }

  return currentUser;
}
