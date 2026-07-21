/**
 * Xirea is a single-window app; the active route is owned by the UI store
 * (see `WorkspaceRouter.tsx`). This file is kept as a thin re-export of
 * the root shell so `main.tsx` reads naturally.
 *
 * In the future, if we add deep-linking or multi-window support, we can
 * swap this for a real router (react-router-dom is already in deps).
 */
export { AppShell } from "@/components/layout/AppShell";
