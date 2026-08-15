import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PolicyPage from "@/app/_components/PolicyPage";
import "@/app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PolicyPage kind="privacy" />
  </StrictMode>,
);
