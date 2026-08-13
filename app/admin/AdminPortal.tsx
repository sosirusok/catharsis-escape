"use client";

import { useEffect, useState } from "react";
import { readAdminSessionToken, usesRemoteApi } from "@/lib/client-runtime";
import AdminAccessGate from "./AdminAccessGate";
import AdminApp from "./AdminApp";

export default function AdminPortal({ initialAuthenticated }: { initialAuthenticated: boolean }) {
  const [authenticated, setAuthenticated] = useState(
    initialAuthenticated || (usesRemoteApi() && Boolean(readAdminSessionToken())),
  );

  useEffect(() => {
    const expire = () => setAuthenticated(false);
    window.addEventListener("catharsis-admin-session-expired", expire);
    return () => window.removeEventListener("catharsis-admin-session-expired", expire);
  }, []);

  return authenticated
    ? <AdminApp />
    : <AdminAccessGate onAuthenticated={() => setAuthenticated(true)} />;
}
