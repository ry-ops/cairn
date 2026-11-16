// Minimal frontmatter helpers for flat `key: value` lines. Notes stay plain
// markdown; Cairn only ever reads/writes a few top-level scalar keys.

const FM = /^---\n([\s\S]*?)\n---(\n|$)/;

/** [from, to) of the frontmatter block including both fences, or null. */
export function frontmatterRange(text: string): [number, number] | null {
  const m = text.match(FM);
  return m ? [0, m[0].length - (m[2] ? 1 : 0)] : null;
}

export function getKey(text: string, key: string): string | null {
  const body = text.match(FM)?.[1];
  if (!body) return null;
  const m = body.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, "") || null;
}

/** Set (or with `null`, remove) a top-level key. Adds frontmatter if missing. */
export function setKey(text: string, key: string, value: string | null): string {
  const m = text.match(FM);
  const line = value === null ? null : `${key}: ${value}`;
  if (!m) {
    return line === null ? text : `---\n${line}\n---\n\n${text}`;
  }
  const lines = m[1].split("\n");
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i >= 0) {
    if (line === null) lines.splice(i, 1);
    else lines[i] = line;
  } else if (line !== null) {
    lines.push(line);
  }
  return `---\n${lines.join("\n")}\n---${m[2]}${text.slice(m[0].length)}`;
}

/** Single-change diff (common prefix/suffix) so editor history and cursor survive. */
export function minimalChange(a: string, b: string): { from: number; to: number; insert: string } | null {
  if (a === b) return null;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}
