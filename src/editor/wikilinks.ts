// [[Wikilinks]] in the editor: styled in place (dashed when the note doesn't
// exist yet), ⌘-click or ⌘↩ to follow, and `[[` suggests note titles.
import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { type Extension, RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, keymap } from "@codemirror/view";
import { parseLinks, type WikiLink } from "../links";

export interface LinkHost {
  /** Does this link reach a note? */
  exists(link: WikiLink): boolean;
  /** Open the note (creating it if it doesn't exist). */
  follow(link: WikiLink): void;
  /** Suggestions after `[[`: what to insert, and where the note lives. */
  suggestions(): { insert: string; title: string; detail: string }[];
}

/** Dispatch to restyle links after the vault's notes change. */
export const linksChanged = StateEffect.define<null>();

const bracket = Decoration.mark({ class: "cm-wikilink-bracket" });

function build(view: EditorView, host: () => LinkHost | null): DecorationSet {
  const h = host();
  const b = new RangeSetBuilder<Decoration>();
  if (!h) return b.finish();
  for (const l of parseLinks(view.state.doc.toString())) {
    const missing = !h.exists(l);
    const mark = Decoration.mark({
      class: missing ? "cm-wikilink cm-wikilink-missing" : "cm-wikilink",
      attributes: { title: missing ? "⌘-click to start this note" : "⌘-click to open" },
    });
    b.add(l.from, l.from + 2, bracket);
    b.add(l.from + 2, l.to - 2, mark);
    b.add(l.to - 2, l.to, bracket);
  }
  return b.finish();
}

function linkAt(view: EditorView, pos: number): WikiLink | undefined {
  // Links never span lines, so parsing the one line is enough.
  const line = view.state.doc.lineAt(pos);
  return parseLinks(line.text)
    .map((l) => ({ ...l, from: l.from + line.from, to: l.to + line.from }))
    .find((l) => l.from <= pos && pos <= l.to);
}

export function wikilinks(host: () => LinkHost | null): Extension {
  const deco = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, host);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(linksChanged)))) {
          this.decorations = build(u.view, host);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  // Holding ⌘ shows links as clickable.
  const modClass = (view: EditorView, on: boolean) => view.dom.classList.toggle("cm-mod-down", on);

  const events = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      const l = pos == null ? undefined : linkAt(view, pos);
      const h = host();
      if (!l || !h) return false;
      e.preventDefault();
      h.follow(l);
      return true;
    },
    mousemove(e, view) {
      modClass(view, e.metaKey || e.ctrlKey);
      return false;
    },
    keydown(e, view) {
      if (e.key === "Meta" || e.key === "Control") modClass(view, true);
      return false;
    },
    keyup(e, view) {
      if (e.key === "Meta" || e.key === "Control") modClass(view, false);
      return false;
    },
    blur(_e, view) {
      modClass(view, false);
      return false;
    },
  });

  const keys = keymap.of([
    {
      key: "Mod-Enter",
      run(view) {
        const l = linkAt(view, view.state.selection.main.head);
        const h = host();
        if (!l || !h) return false;
        h.follow(l);
        return true;
      },
    },
  ]);

  function complete(ctx: CompletionContext) {
    const m = ctx.matchBefore(/\[\[[^[\]\n|#]*$/);
    const h = host();
    if (!m || !h) return null;
    const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2);
    const options: Completion[] = h.suggestions().map((s) => ({
      label: s.insert,
      displayLabel: s.title,
      detail: s.detail,
      apply: after === "]]" ? s.insert : `${s.insert}]]`,
    }));
    return { from: m.from + 2, options, validFor: /^[^[\]\n|#]*$/ };
  }

  return [deco, events, keys, autocompletion({ override: [complete], icons: false })];
}
