import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminPortal from "@/app/admin/AdminPortal";
import "@/app/globals.css";
import "@/app/admin/admin.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AdminPortal initialAuthenticated={false} />
  </StrictMode>,
);
