// Focus mode (iA Writer-style): dim everything outside the current sentence
// or paragraph. Implemented as two mark decorations around the focus range.
import { Compartment, EditorState, Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

export type FocusMode = "off" | "paragraph" | "sentence";

const dim = Decoration.mark({ class: "cm-dimmed" });

/** Blank-line-delimited paragraph around `pos`. */
export function paragraphRange(state: EditorState, pos: number): [number, number] {
  const doc = state.doc;
  let first = doc.lineAt(pos);
  let last = first;
  if (first.text.trim() === "") return [first.from, first.to];
  while (first.number > 1) {
    const prev = doc.line(first.number - 1);
    if (prev.text.trim() === "") break;
    first = prev;
  }
  while (last.number < doc.lines) {
    const next = doc.line(last.number + 1);
    if (next.text.trim() === "") break;
    last = next;
  }
  return [first.from, last.to];
}

/** Sentence around `pos` inside its paragraph. Ends at . ! ? (plus closing quotes) + space. */
export function sentenceRange(state: EditorState, pos: number): [number, number] {
  const [pFrom, pTo] = paragraphRange(state, pos);
  const text = state.doc.sliceString(pFrom, pTo);
  const rel = pos - pFrom;
  const re = /[.!?]+["')\]]*(?=\s|$)/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (end >= rel) return [pFrom + start, pFrom + end];
    start = end;
    while (start < text.length && /\s/.test(text[start])) start++;
  }
  return [pFrom + start, pTo];
}

function build(view: EditorView, mode: FocusMode): DecorationSet {
  const { state } = view;
  const head = state.selection.main.head;
  const [from, to] = mode === "sentence" ? sentenceRange(state, head) : paragraphRange(state, head);
  const b = new RangeSetBuilder<Decoration>();
  if (from > 0) b.add(0, from, dim);
  if (to < state.doc.length) b.add(to, state.doc.length, dim);
  return b.finish();
}

function focusPlugin(mode: FocusMode): Extension {
  if (mode === "off") return [];
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, mode);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet) this.decorations = build(u.view, mode);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export const focusCompartment = new Compartment();
export const focusMode = (mode: FocusMode) => focusCompartment.of(focusPlugin(mode));
export const setFocusMode = (view: EditorView, mode: FocusMode) =>
  view.dispatch({ effects: focusCompartment.reconfigure(focusPlugin(mode)) });
