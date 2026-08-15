import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminPortal from "@/app/admin/AdminPortal";
import "@/app/globals.css";
import "@/app/admin/admin.css";

const root = createRoot(document.getElementById("root")!);

if (window.top !== window.self) {
  root.render(
    <main className="admin-frame-blocked">
      <h1>페이지를 직접 열어 주세요.</h1>
      <p>예약 관리 화면은 다른 사이트 안에서 열 수 없습니다.</p>
    </main>,
  );
} else {
  root.render(
    <StrictMode>
      <AdminPortal initialAuthenticated={false} />
    </StrictMode>,
  );
}
