/**
 * PromptsView — prompt library with categories, favorites, variables.
 *
 * Features:
 *  - Sidebar with categories + favorites filter
 *  - Grid of prompt cards
 *  - "Use" button opens a modal that fills variables and inserts into chat
 *  - Create / edit / delete prompts
 */
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Sparkles,
  Plus,
  Search,
  Star,
  Trash2,
  Pencil,
  Play,
  Variable,
  Folder,
  Users,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { usePromptsStore, PROMPT_CATEGORIES } from "@/store/prompts";
import { useChatStore } from "@/store/chat";
import { useUIStore } from "@/store/ui";
import { Select } from "@/components/ui/Select";
import type { PromptTemplate } from "@/types";

export function PromptsView() {
  const prompts = usePromptsStore((s) => s.prompts);
  const add = usePromptsStore((s) => s.add);
  const update = usePromptsStore((s) => s.update);
  const remove = usePromptsStore((s) => s.remove);
  const toggleFavorite = usePromptsStore((s) => s.toggleFavorite);
  const incrementUse = usePromptsStore((s) => s.incrementUse);
  const createThread = useChatStore((s) => s.createThread);
  const setActiveThread = useUIStore((s) => s.setActiveThread);
  const setRoute = useUIStore((s) => s.setRoute);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const pushToast = useUIStore((s) => s.pushToast);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [showFavorites, setShowFavorites] = useState(false);
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [using, setUsing] = useState<PromptTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    let list = [...prompts];
    if (showFavorites) list = list.filter((p) => p.favorite);
    if (category !== "all") list = list.filter((p) => p.category === category);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    }
    return list;
  }, [prompts, showFavorites, category, query]);

  const handleUse = (prompt: PromptTemplate, vars: Record<string, string>) => {
    let body = prompt.body;
    for (const [key, value] of Object.entries(vars)) {
      body = body.replaceAll(`{{${key}}}`, value);
    }
    const threadId = createThread({ title: prompt.title });
    setActiveThread(threadId);
    appendMessage(threadId, {
      id: `msg_${Date.now()}`,
      role: "user",
      content: body,
      createdAt: new Date().toISOString(),
    });
    incrementUse(prompt.id);
    setRoute("chat");
    setUsing(null);
    pushToast({ title: "Prompt used", description: prompt.title, variant: "success" });
  };

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="hidden lg:flex w-56 flex-col border-r border-line-subtle p-3 gap-1">
        <button
          type="button"
          onClick={() => { setShowFavorites(false); setCategory("all"); }}
          className={cn(
            "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
            !showFavorites && category === "all" ? "bg-overlay/8 text-ink-primary" : "text-ink-tertiary hover:text-ink-secondary hover:bg-overlay/4",
          )}
        >
          <Sparkles className="h-3.5 w-3.5" /> All prompts
        </button>
        <button
          type="button"
          onClick={() => { setShowFavorites(true); setCategory("all"); }}
          className={cn(
            "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
            showFavorites ? "bg-overlay/8 text-ink-primary" : "text-ink-tertiary hover:text-ink-secondary hover:bg-overlay/4",
          )}
        >
          <span className="flex items-center gap-2"><Star className="h-3.5 w-3.5" /> Favorites</span>
          <span className="text-2xs text-ink-faint">{prompts.filter((p) => p.favorite).length}</span>
        </button>

        <div className="my-2 h-px bg-line-subtle" />

        <p className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-ink-muted flex items-center gap-1">
          <Folder className="h-3 w-3" /> Categories
        </p>
        {PROMPT_CATEGORIES.map((c) => {
          const count = prompts.filter((p) => p.category === c).length;
          return (
            <button
              key={c}
              type="button"
              onClick={() => { setShowFavorites(false); setCategory(c); }}
              className={cn(
                "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                category === c && !showFavorites ? "bg-overlay/8 text-ink-primary" : "text-ink-tertiary hover:text-ink-secondary hover:bg-overlay/4",
              )}
            >
              <span>{c}</span>
              <span className="text-2xs text-ink-faint">{count}</span>
            </button>
          );
        })}

        <div className="my-2 h-px bg-line-subtle" />

        <p className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-ink-muted flex items-center gap-1">
          <Users className="h-3 w-3" /> Sources
        </p>
        <div className="px-2.5 py-1 text-xs text-ink-tertiary space-y-1">
          <p className="flex items-center justify-between"><span>Built-in</span><span className="text-2xs text-ink-faint">{prompts.filter((p) => p.origin === "builtin").length}</span></p>
          <p className="flex items-center justify-between"><span>Custom</span><span className="text-2xs text-ink-faint">{prompts.filter((p) => p.origin === "custom").length}</span></p>
          <p className="flex items-center justify-between"><span>Community</span><span className="text-2xs text-ink-faint">{prompts.filter((p) => p.origin === "community").length}</span></p>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-line-subtle px-6 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold font-display text-ink-primary">Prompt Library</h1>
                <Badge variant="brand">{prompts.length}</Badge>
              </div>
              <p className="mt-1 text-sm text-ink-tertiary">Reusable prompt templates with variables. Build your own, or start from the built-in collection.</p>
            </div>
            <Button variant="primary" iconLeft={<Plus />} onClick={() => setCreating(true)}>New prompt</Button>
          </div>
          <div className="w-full max-w-md">
            <Input iconLeft={<Search />} placeholder="Search prompts…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="h-7 w-7" />}
              title="No prompts here"
              description="Create your first prompt template, or browse the built-in collection by clearing your filters."
              action={<Button variant="primary" iconLeft={<Plus />} onClick={() => setCreating(true)}>New prompt</Button>}
              size="lg"
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
              <AnimatePresence>
                {filtered.map((prompt) => (
                  <PromptCard
                    key={prompt.id}
                    prompt={prompt}
                    onUse={() => setUsing(prompt)}
                    onEdit={() => setEditing(prompt)}
                    onDelete={() => remove(prompt.id)}
                    onFavorite={() => toggleFavorite(prompt.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Use modal */}
      <UsePromptModal prompt={using} onClose={() => setUsing(null)} onUse={handleUse} />

      {/* Edit modal */}
      <PromptEditorModal prompt={editing} open={!!editing || creating} onClose={() => { setEditing(null); setCreating(false); }} onSave={(data) => {
        if (editing) {
          update(editing.id, data);
          pushToast({ title: "Prompt updated", variant: "success" });
        } else {
          add({ ...data, origin: "custom" });
          pushToast({ title: "Prompt created", variant: "success" });
        }
        setEditing(null);
        setCreating(false);
      }} />
    </div>
  );
}

function PromptCard({ prompt, onUse, onEdit, onDelete, onFavorite }: {
  prompt: PromptTemplate;
  onUse: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onFavorite: () => void;
}) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <Card hover padded={false} className="overflow-hidden flex flex-col h-full">
        <div className="p-4 flex-1">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5">
              <Badge variant="default">{prompt.category}</Badge>
              {prompt.origin === "builtin" && <Badge variant="teal">Built-in</Badge>}
              {prompt.origin === "community" && <Badge variant="fuchsia">Community</Badge>}
            </div>
            <IconButton label={prompt.favorite ? "Unfavorite" : "Favorite"} size="xs" variant="ghost" onClick={onFavorite} active={prompt.favorite}>
              <Star className={cn(prompt.favorite && "fill-current text-brand-amber-400")} />
            </IconButton>
          </div>
          <h3 className="text-sm font-semibold text-ink-primary mb-1">{prompt.title}</h3>
          <p className="text-xs text-ink-tertiary line-clamp-3 mb-3">{prompt.description ?? prompt.body.slice(0, 140)}</p>

          {prompt.variables.length > 0 && (
            <div className="mb-3 flex items-center gap-1 flex-wrap">
              <Variable className="h-3 w-3 text-ink-faint" />
              {prompt.variables.map((v) => (
                <span key={v.name} className="rounded-md bg-brand-indigo-500/[0.08] border border-brand-indigo-400/20 px-1.5 py-0.5 text-2xs font-medium text-brand-indigo-300 font-mono">
                  {`{{${v.name}}}`}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 text-2xs text-ink-faint">
            <span className="flex items-center gap-1"><Play className="h-2.5 w-2.5" />{prompt.uses ?? 0} uses</span>
            <span>·</span>
            <span>{formatRelativeTime(prompt.updatedAt)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 border-t border-line-subtle px-3 py-2">
          <Button variant="primary" size="sm" iconLeft={<Play />} onClick={onUse} className="flex-1">Use</Button>
          <IconButton label="Edit" size="sm" variant="ghost" onClick={onEdit}><Pencil /></IconButton>
          <IconButton label="Delete" size="sm" variant="ghost" onClick={onDelete} className="hover:text-status-danger"><Trash2 /></IconButton>
        </div>
      </Card>
    </motion.div>
  );
}

function UsePromptModal({ prompt, onClose, onUse }: {
  prompt: PromptTemplate | null;
  onClose: () => void;
  onUse: (prompt: PromptTemplate, vars: Record<string, string>) => void;
}) {
  const [vars, setVars] = useState<Record<string, string>>({});

  // Reset vars when prompt changes
  useMemo(() => {
    setVars({});
  }, []);

  if (!prompt) return null;

  return (
    <Modal
      open={!!prompt}
      onClose={onClose}
      title={prompt.title}
      description={prompt.description}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" iconLeft={<Play />} onClick={() => onUse(prompt, vars)}>Insert into chat</Button>
        </>
      }
    >
      <div className="space-y-3">
        {prompt.variables.length === 0 ? (
          <p className="text-sm text-ink-tertiary">This prompt has no variables. Click <strong>Insert into chat</strong> to use it as-is.</p>
        ) : (
          prompt.variables.map((v) => (
            <div key={v.name}>
              <label className="block text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
                {v.label}
                <span className="ml-1.5 font-mono text-brand-indigo-300 normal-case">{`{{${v.name}}}`}</span>
                {v.required && <span className="ml-1 text-status-danger">*</span>}
              </label>
              {v.defaultValue !== undefined || (prompt.body.length > 100 && v.name === "code") ? (
                <Textarea
                  value={vars[v.name] ?? v.defaultValue ?? ""}
                  onChange={(e) => setVars((prev) => ({ ...prev, [v.name]: e.target.value }))}
                  placeholder={v.placeholder}
                  minHeight={80}
                />
              ) : (
                <Input
                  value={vars[v.name] ?? v.defaultValue ?? ""}
                  onChange={(e) => setVars((prev) => ({ ...prev, [v.name]: e.target.value }))}
                  placeholder={v.placeholder}
                />
              )}
            </div>
          ))
        )}
        <div className="rounded-lg border border-line-subtle bg-surface-deep/40 p-2.5">
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-1">Preview</p>
          <pre className="text-xs text-ink-secondary whitespace-pre-wrap font-mono">{prompt.body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`)}</pre>
        </div>
      </div>
    </Modal>
  );
}

function PromptEditorModal({ prompt, open, onClose, onSave }: {
  prompt: PromptTemplate | null;
  open: boolean;
  onClose: () => void;
  onSave: (data: Omit<PromptTemplate, "id" | "createdAt" | "updatedAt">) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(PROMPT_CATEGORIES[0]!);

  // Sync state with prompt when opening
  useMemo(() => {
    if (open) {
      setTitle(prompt?.title ?? "");
      setBody(prompt?.body ?? "");
      setDescription(prompt?.description ?? "");
      setCategory(prompt?.category ?? PROMPT_CATEGORIES[0]!);
    }
  }, [open, prompt]);

  const variables = useMemo(() => {
    const matches = body.matchAll(/\{\{(\w+)\}\}/g);
    const seen = new Set<string>();
    const result: { name: string; label: string }[] = [];
    for (const m of matches) {
      const name = m[1]!;
      if (!seen.has(name)) {
        seen.add(name);
        result.push({ name, label: name.replace(/_/g, " ") });
      }
    }
    return result;
  }, [body]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={prompt ? "Edit prompt" : "New prompt"}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave({ title, body, description, category, variables, origin: prompt?.origin ?? "custom", favorite: prompt?.favorite })}>
            {prompt ? "Save changes" : "Create prompt"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="block text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Summarize document" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">Category</label>
            <Select value={category} onChange={setCategory} options={PROMPT_CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </div>
          <div>
            <label className="block text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short summary" />
          </div>
        </div>
        <div>
          <label className="block text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
            Body
            <span className="ml-1.5 normal-case text-ink-faint">Use <code className="text-brand-indigo-300">{`{{variable}}`}</code> for placeholders</span>
          </label>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your prompt…" minHeight={160} maxHeight={400} />
        </div>
        {variables.length > 0 && (
          <div>
            <label className="block text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">Detected variables</label>
            <div className="flex flex-wrap gap-1">
              {variables.map((v) => (
                <Badge key={v.name} variant="brand">{`{{${v.name}}}`}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
