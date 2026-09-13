import { redirect } from "next/navigation";

import { ADMIN_MAP_V2_PATH } from "@/lib/navigation/admin-route-policy";

export default function AdminPage() {
  redirect(ADMIN_MAP_V2_PATH);
}
