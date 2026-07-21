/**
 * Markdown renderer — wraps react-markdown with Xirea styling.
 *
 * - GitHub-flavored markdown (tables, task lists, strikethrough)
 * - Syntax-highlighted code blocks via rehype-highlight
 * - Raw HTML pass-through (sanitised upstream)
 * - KaTeX math via remark-math + rehype-katex
 *
 * Code blocks get a custom wrapper with a language chip + copy button.
 *
 * Note: the `components` map is hoisted to module scope so its identity is
 * stable across renders — react-markdown diffs `components` by reference and
 * rebuilds its renderer tree when the prop changes, which would otherwise
 * cause wasteful re-renders while streaming.
 */
import { memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { clipboardWriteText } from "@/lib/tauri";

interface MarkdownProps {
  children: string;
  className?: string;
}

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  // Keep a ref to the actual <code> DOM node so the copy button can read
  // `textContent` directly. This is bulletproof — no matter how rehype-highlight
  // wraps tokens in nested <span>s, `textContent` always returns the raw text.
  // The previous approach walked the React element tree which produced
  // "[object Object]" in some edge cases (e.g. when children was an array
  // of React elements whose toString() is "[object Object]").
  const codeRef = useRef<HTMLElement | null>(null);
  const match = /language-(\w+)/.exec(className || "");

  // Best-effort inline-vs-block detection: react-markdown passes a `language-*`
  // className for fenced blocks, AND the children of an inline `code` are
  // always a single string. If we have neither, treat as inline.
  const isInline = !match && (typeof children === "string" || typeof children === "number") && !String(children).includes("\n");

  if (isInline) {
    return <code className={className}>{children}</code>;
  }

  const lang = match?.[1] ?? "text";

  const copy = async () => {
    // Prefer DOM textContent — always correct regardless of how the
    // highlighter wrapped the tokens. Falls back to extracting from the
    // React tree if the ref isn't attached yet (shouldn't happen, but
    // defensive never hurts).
    let text = codeRef.current?.textContent ?? "";
    if (!text) {
      text = extractText(children);
    }
    // Strip a single trailing newline (react-markdown adds one).
    text = text.replace(/\n$/, "");
    if (!text) return;
    await clipboardWriteText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-line-soft xirea-codeblock">
      <div className="flex items-center justify-between border-b border-overlay/4 bg-overlay/2 px-3 py-1.5">
        <span className="text-2xs font-medium uppercase tracking-wider text-ink-muted">{lang}</span>
        <button
          type="button"
          onClick={copy}
          className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-2xs text-ink-tertiary hover:bg-overlay/6 hover:text-ink-secondary transition-colors"
        >
          {copied ? <Check className="h-3 w-3 text-status-success" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 text-xs leading-relaxed">
        <code ref={codeRef as React.RefObject<HTMLElement>} className={className}>{children}</code>
      </pre>
    </div>
  );
}

/**
 * Walk a React node tree and extract plain text. Used as a defensive
 * fallback when the DOM ref isn't available.
 */
function extractText(node: ReactNode): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return extractText((node as any).props?.children);
  }
  return "";
}

const MARKDOWN_COMPONENTS: Components = {
  code({ className, children }) {
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  a({ children, href, ...props }) {
    return (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="cursor-pointer"
      >
        {children}
      </a>
    );
  },
  table({ children, ...props }) {
    return (
      <div className="overflow-x-auto">
        <table {...props}>{children}</table>
      </div>
    );
  },
  input({ children, ...props }) {
    return <input {...props} disabled={false} />;
  },
};

export const Markdown = memo(function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn("prose-xirea selectable", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeHighlight, { detect: true, ignoreMissing: true }], rehypeKatex]}
        components={MARKDOWN_COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

/* Skeleton used while streaming — three shimmer lines. */
export function MarkdownSkeleton({ className }: { className?: string }): ReactNode {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="animate-shimmer-bg h-3 rounded-md" style={{ width: "82%" }} />
      <div className="animate-shimmer-bg h-3 rounded-md" style={{ width: "64%" }} />
      <div className="animate-shimmer-bg h-3 rounded-md" style={{ width: "94%" }} />
    </div>
  );
}
