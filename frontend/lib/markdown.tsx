import { Fragment, type ReactNode } from "react";

// A tiny renderer for the subset of Markdown the agent writes: paragraphs,
// "-"/"*"/"1." lists, "#" headings and **bold**. It builds React elements
// (never raw HTML), so a reply can't inject markup.

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; text: string }
  | { kind: "ul" | "ol"; items: string[] };

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const last = blocks.at(-1);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (!line.trim()) {
      blocks.push({ kind: "p", lines: [] }); // paragraph break; empty ones are dropped below
    } else if (heading) {
      blocks.push({ kind: "h", text: heading[1] });
    } else if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? numbered)![1];
      if (last?.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (last?.kind === "p") {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "p", lines: [line] });
    }
  }
  return blocks.filter((b) => b.kind !== "p" || b.lines.length > 0);
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {parseBlocks(text).map((b, i) => {
        if (b.kind === "h") {
          return (
            <p key={i} className="font-display font-semibold">
              {inline(b.text.replace(/\*\*/g, ""))}
            </p>
          );
        }
        if (b.kind === "p") {
          return (
            <p key={i}>
              {b.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(l)}
                </Fragment>
              ))}
            </p>
          );
        }
        const List = b.kind;
        return (
          <List
            key={i}
            className={`space-y-1 pl-5 ${b.kind === "ul" ? "list-disc" : "list-decimal"} marker:text-ink-muted`}
          >
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
