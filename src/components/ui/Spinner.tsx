/**
 * Spinner — branded loading indicator.
 */
import { cn } from "@/lib/utils";

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      className={cn("inline-block animate-spin-slow rounded-full", "border-2 border-overlay/1500 border-t-brand-indigo-400", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function SpinnerGlow({ size = 28 }: { size?: number }) {
  return (
    <span
      role="status"
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0 rounded-full opacity-60 blur-[6px] animate-pulse-soft"
        style={{ background: "radial-gradient(circle, rgba(129,140,248,0.5), transparent 70%)" }}
      />
      <span
        className="relative inline-block animate-spin-slow rounded-full border-2 border-overlay/1500 border-t-brand-indigo-400"
        style={{ width: size, height: size }}
      />
    </span>
  );
}
