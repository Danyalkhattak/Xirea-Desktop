/**
 * ProfileAvatar — renders the user's profile picture, falling back to a
 * gradient circle with the user's initial. NEVER shows the X SVG or the
 * "Xirea" app icon — those are reserved for the app brand, not the user.
 *
 * Used in: Sidebar's UserProfile, Settings → About, and anywhere else the
 * user's identity needs to be shown.
 */
import { User } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProfileAvatarProps {
  /** Profile picture as a data: URL (or any img URL). If empty, falls back to initial/icon. */
  picture?: string;
  /** Display name — used to compute the initial fallback. */
  name: string;
  /** Size in pixels. */
  size?: number;
  /** Extra classes. */
  className?: string;
  /** When true, renders a subtle ring around the avatar (used for the
   *  sidebar profile where the avatar is interactive). */
  ring?: boolean;
}

export function ProfileAvatar({ picture, name, size = 28, className, ring }: ProfileAvatarProps) {
  // Compute the initial — first character of the name, uppercased. If the
  // name is empty or just whitespace, use "U" (for "User") instead of "X".
  const trimmed = (name || "").trim();
  const initial = trimmed.charAt(0).toUpperCase() || "U";

  if (picture) {
    return (
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-lg bg-surface-raised",
          ring && "ring-2 ring-brand-indigo-400/40",
          className,
        )}
        style={{ width: size, height: size }}
      >
        <img
          src={picture}
          alt={trimmed || "Profile"}
          className="h-full w-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  // No picture — render the gradient circle with the initial. We deliberately
  // use the user's initial (or "U" for empty) rather than the Xirea brand
  // mark so the user's identity is distinct from the app's identity.
  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-lg",
        "bg-gradient-to-br from-brand-indigo-400 to-brand-indigo-500 text-white",
        ring && "ring-2 ring-brand-indigo-400/40",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.42) }}
      aria-label={trimmed || "User"}
    >
      {trimmed ? initial : <User className="h-1/2 w-1/2" />}
    </div>
  );
}
