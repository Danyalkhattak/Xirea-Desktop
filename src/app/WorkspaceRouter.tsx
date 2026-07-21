/**
 * WorkspaceRouter — decides which feature view to render based on the active route.
 *
 * Uses React.lazy + Suspense so each feature ships in its own chunk.
 */
import { lazy } from "react";
import { useUIStore } from "@/store/ui";

const ChatView = lazy(() => import("@/features/chat/ChatView").then((m) => ({ default: m.ChatView })));
const ModelsView = lazy(() => import("@/features/models/ModelsView").then((m) => ({ default: m.ModelsView })));
const ProvidersView = lazy(() => import("@/features/providers/ProvidersView").then((m) => ({ default: m.ProvidersView })));
const HuggingFaceView = lazy(() => import("@/features/huggingface/HuggingFaceView").then((m) => ({ default: m.HuggingFaceView })));
const FilesView = lazy(() => import("@/features/files/FilesView").then((m) => ({ default: m.FilesView })));
const DownloadsView = lazy(() => import("@/features/downloads/DownloadsView").then((m) => ({ default: m.DownloadsView })));
const PromptsView = lazy(() => import("@/features/prompts/PromptsView").then((m) => ({ default: m.PromptsView })));
const SettingsView = lazy(() => import("@/features/settings/SettingsView").then((m) => ({ default: m.SettingsView })));
const ArchivedChatsView = lazy(() => import("@/features/archived/ArchivedChatsView").then((m) => ({ default: m.ArchivedChatsView })));

export function WorkspaceRouter() {
  const route = useUIStore((s) => s.route);

  switch (route) {
    case "chat":
      return <ChatView />;
    case "models":
      return <ModelsView />;
    case "providers":
      return <ProvidersView />;
    case "huggingface":
      return <HuggingFaceView />;
    case "files":
      return <FilesView />;
    case "downloads":
      return <DownloadsView />;
    case "prompts":
      return <PromptsView />;
    case "settings":
      return <SettingsView />;
    case "archived":
      return <ArchivedChatsView />;
    default:
      return <ChatView />;
  }
}
