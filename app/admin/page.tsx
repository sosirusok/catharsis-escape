import { getAdmin } from "@/lib/admin";
import AdminPortal from "./AdminPortal";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await getAdmin();
  return <AdminPortal initialAuthenticated={Boolean(admin)} />;
}
