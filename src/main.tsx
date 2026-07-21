import React from "react";
import ReactDOM from "react-dom/client";
import { AppShell } from "@/components/layout/AppShell";
import { useHotkeys } from "@/hooks/useHotkeys";
import "@/index.css";

function Root() {
  useHotkeys();
  return <AppShell />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
