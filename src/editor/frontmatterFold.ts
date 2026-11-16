// Collapse YAML frontmatter into a small chip unless the cursor is inside it,
// so the page reads like a page. Click the chip (or arrow into it) to edit.
import { EditorState, Extension, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { frontmatterRange, getKey } from "../frontmatter";

class Chip extends WidgetType {
  constructor(readonly label: string, readonly end: number) {
    super();
  }
  eq(o: Chip) {
    return o.label === this.label && o.end === this.end;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-fm-chip";
    el.textContent = this.label;
    el.title = "Edit frontmatter";
    el.onmousedown = (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: 4 } });
      view.focus();
    };
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

function build(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const r = frontmatterRange(text);
  if (!r) return Decoration.none;
  const [from, to] = r;
  const { head } = state.selection.main;
  if (head >= from && head <= to) return Decoration.none;
  const tags = getKey(text, "tags");
  const parts = ["⚑ frontmatter", tags && tags !== "[]" ? tags : "", getKey(text, "paper") ? `paper: ${getKey(text, "paper")}` : ""];
  const widget = new Chip(parts.filter(Boolean).join("  ·  "), to);
  return Decoration.set([Decoration.replace({ widget, block: true }).range(from, to)]);
}

export const frontmatterFold: Extension = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    return tr.docChanged || tr.selection ? build(tr.state) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
