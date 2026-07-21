/**
 * Global hotkeys.
 *
 * - Cmd/Ctrl+K — toggle command palette
 * - Cmd/Ctrl+N — new chat
 * - Cmd/Ctrl+B — toggle sidebar
 * - Cmd/Ctrl+. — toggle activity panel
 * - Cmd/Ctrl+, — go to settings
 * - Cmd/Ctrl+/ — show shortcuts help (future)
 */
import { useEffect } from "react";
import { useUIStore } from "@/store/ui";
import { useChatStore } from "@/store/chat";
import { isMac } from "@/lib/utils";

export function useHotkeys() {
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleActivityPanel = useUIStore((s) => s.toggleActivityPanel);
  const setRoute = useUIStore((s) => s.setRoute);
  const setActiveThread = useUIStore((s) => s.setActiveThread);
  const createThread = useChatStore((s) => s.createThread);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      switch (e.key.toLowerCase()) {
        case "k":
          e.preventDefault();
          toggleCommandPalette();
          break;
        case "n":
          e.preventDefault();
          {
            const id = createThread();
            setActiveThread(id);
            setRoute("chat");
          }
          break;
        case "b":
          e.preventDefault();
          toggleSidebar();
          break;
        case ".":
          e.preventDefault();
          toggleActivityPanel();
          break;
        case ",":
          e.preventDefault();
          setRoute("settings");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCommandPalette, toggleSidebar, toggleActivityPanel, setRoute, setActiveThread, createThread]);
}
