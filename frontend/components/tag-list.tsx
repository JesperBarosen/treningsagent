import { TAG_LABELS, type Tag } from "@/lib/api";
import { SENSITIVE } from "@/lib/discreet";

/** A session's context tags (N6), read-only. Personal, so blurred in discreet mode. */
export function TagList({ tags, className = "" }: { tags?: Tag[]; className?: string }) {
  if (!tags?.length) return null;
  return (
    <ul {...SENSITIVE} aria-label="How it felt" className={`flex flex-wrap gap-1.5 ${className}`}>
      {tags.map((t) => (
        <li key={t} className="rounded-full bg-sunken px-2.5 py-0.5 text-xs text-ink">
          {TAG_LABELS[t]}
        </li>
      ))}
    </ul>
  );
}
