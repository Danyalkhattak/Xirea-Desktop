import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Xirea brand palette (mirrors Android app).
        // The 300/400/500 shades are bound to CSS variables so the user's
        // chosen accent color (Settings → Appearance → Accent) can override
        // them at runtime. See src/store/settings.ts::applyTheme.
        brand: {
          // Indigo — primary
          indigo: {
            50: "#eef2ff",
            100: "#e0e7ff",
            200: "#c7d2fe",
            300: "var(--brand-indigo-300, #a5b4fc)",
            400: "var(--brand-indigo-400, #818cf8)", // dark-mode primary (overridable by accent)
            500: "var(--brand-indigo-500, #6366f1)",
            600: "var(--brand-indigo-600, #4f46e5)", // light-mode primary
            700: "#4338ca",
            800: "#3730a3",
            900: "#312e81",
            950: "#1e1b4b",
          },
          // Teal — secondary
          teal: {
            50: "#f0fdfa",
            100: "#ccfbf1",
            200: "#99f6e4",
            300: "var(--brand-teal-300, #5eead4)",
            400: "var(--brand-teal-400, #2dd4bf)", // dark-mode secondary
            500: "var(--brand-teal-500, #14b8a6)",
            600: "var(--brand-teal-600, #0d9488)", // light-mode secondary
            700: "#0f766e",
            800: "#115e59",
            900: "#134e4a",
            950: "#042f2e",
          },
          // Fuchsia — tertiary accent
          fuchsia: {
            50: "#fdf4ff",
            100: "#fae8ff",
            200: "#f5d0fe",
            300: "var(--brand-fuchsia-300, #f0abfc)",
            400: "var(--brand-fuchsia-400, #e879f9)", // dark-mode tertiary
            500: "var(--brand-fuchsia-500, #d946ef)", // light-mode tertiary
            600: "#c026d3",
            700: "#a21caf",
            800: "#86198f",
            900: "#701a75",
            950: "#4a044e",
          },
        },
        // Surfaces — CSS variables that swap with .light/.dark class on <html>.
        // See src/index.css for the actual hex values per theme.
        surface: {
          midnight: "var(--surface-midnight)",
          deep: "var(--surface-deep)",
          base: "var(--surface-base)",
          raised: "var(--surface-raised)",
          overlay: "var(--surface-overlay)",
          subtle: "var(--surface-subtle)",
          hover: "var(--surface-hover)",
          cloud: "var(--surface-cloud)",
          paper: "var(--surface-paper)",
          mist: "var(--surface-mist)",
          haze: "var(--surface-haze)",
        },
        ink: {
          primary: "var(--ink-primary)",
          secondary: "var(--ink-secondary)",
          tertiary: "var(--ink-tertiary)",
          muted: "var(--ink-muted)",
          faint: "var(--ink-faint)",
          "primary-l": "var(--ink-primary)",
          "secondary-l": "var(--ink-secondary)",
          "tertiary-l": "var(--ink-tertiary)",
          "muted-l": "var(--ink-muted)",
        },
        line: {
          subtle: "var(--line-subtle)",
          soft: "var(--line-soft)",
          medium: "var(--line-medium)",
          strong: "var(--line-strong)",
        },
        // Overlay color used in `bg-overlay/6` style classes — replaces
        // the old `bg-white/[0.06]` which broke in light theme.
        // In dark theme it's white-tinted; in light theme it's black-tinted.
        overlay: "rgb(var(--overlay-rgb) / <alpha-value>)",
        status: {
          success: "#10B981",
          warning: "#F59E0B",
          danger: "#EF4444",
          info: "#3B82F6",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "Inter Variable",
          "SF Pro Text",
          "-apple-system",
          "system-ui",
          "Segoe UI",
          "Noto Sans",
          "sans-serif",
        ],
        display: [
          "Sora",
          "Inter Display",
          "SF Pro Display",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SF Mono",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
        xs: ["0.75rem", { lineHeight: "1.125rem", letterSpacing: "0.01em" }],
        sm: ["0.875rem", { lineHeight: "1.25rem" }],
        base: ["0.9375rem", { lineHeight: "1.4375rem" }],
        lg: ["1.0625rem", { lineHeight: "1.625rem" }],
        xl: ["1.25rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem", { lineHeight: "2rem" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem" }],
        "4xl": ["2.25rem", { lineHeight: "2.625rem" }],
      },
      spacing: {
        "4.5": "1.125rem",
        "13": "3.25rem",
        "15": "3.75rem",
        "18": "4.5rem",
        "22": "5.5rem",
        "30": "7.5rem",
        "38": "9.5rem",
      },
      borderRadius: {
        "4xl": "2rem",
        "5xl": "2.5rem",
      },
      boxShadow: {
        "elev-1": "0 1px 2px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.04)",
        "elev-2": "0 4px 12px rgba(15, 23, 42, 0.10), 0 2px 4px rgba(15, 23, 42, 0.06)",
        "elev-3": "0 12px 32px rgba(15, 23, 42, 0.14), 0 4px 12px rgba(15, 23, 42, 0.08)",
        "elev-4": "0 24px 64px rgba(15, 23, 42, 0.20), 0 8px 24px rgba(15, 23, 42, 0.12)",
        glow: "0 0 0 1px rgba(129, 140, 248, 0.20), 0 8px 32px rgba(99, 102, 241, 0.24)",
        "glow-teal": "0 0 0 1px rgba(45, 212, 191, 0.22), 0 8px 32px rgba(13, 148, 136, 0.24)",
        "inner-line": "inset 0 0 0 1px var(--line-subtle)",
      },
      backgroundImage: {
        // Single-accent gradient — keeps the brand identity without screaming
        // "rainbow" on every primary button. The previous 3-color gradient
        // (indigo→teal→fuchsia) was visually noisy and made the dark theme
        // feel cluttered; this indigo-only gradient is more refined.
        "brand-gradient": "linear-gradient(135deg, #818cf8 0%, #6366f1 100%)",
        "brand-gradient-soft": "linear-gradient(135deg, var(--brand-indigo-soft) 0%, rgba(99, 102, 241, 0.08) 100%)",
        // Aurora — subtle ambient glow. Used to be indigo+teal+fuchsia; now
        // it's just a soft indigo wash so it doesn't compete with content.
        "aurora": "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(129, 140, 248, 0.10), transparent 60%)",
        "noise": "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E\")",
      },
      animation: {
        "fade-in": "fade-in 0.24s ease-out both",
        "fade-up": "fade-up 0.32s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-down": "fade-down 0.32s cubic-bezier(0.22, 1, 0.36, 1) both",
        "scale-in": "scale-in 0.22s cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-in-right": "slide-in-right 0.32s cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-in-left": "slide-in-left 0.32s cubic-bezier(0.22, 1, 0.36, 1) both",
        "shimmer": "shimmer 1.6s linear infinite",
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        "blink": "blink 1.1s steps(2, end) infinite",
        "spin-slow": "spin 1.2s linear infinite",
        "gradient-pan": "gradient-pan 8s ease infinite",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-down": {
          "0%": { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(12px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "slide-in-left": {
          "0%": { opacity: "0", transform: "translateX(-12px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        "gradient-pan": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        "spring-soft": "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
