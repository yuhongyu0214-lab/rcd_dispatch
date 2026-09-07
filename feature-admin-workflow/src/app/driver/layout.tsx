import { requireDriverPage } from "@/lib/auth/current-user";

export default async function DriverLayout({
  children
}: {
  children: React.ReactNode;
}) {
  await requireDriverPage();
  return children;
}
