import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";

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
};

export async function findUserForLogin(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      password: true,
      role: true
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
      role: true
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

  if (currentUser.role !== "admin") {
    redirect("/");
  }

  return currentUser;
}
