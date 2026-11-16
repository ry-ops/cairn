import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { minimalChange } from "../frontmatter";
import { FocusMode, focusMode, setFocusMode } from "./focus";
import { frontmatterFold } from "./frontmatterFold";
import { setTypewriter, typewriter } from "./typewriter";
import { cairnHighlight, cairnTheme } from "./theme";
import { type LinkHost, linksChanged, wikilinks } from "./wikilinks";

interface Props {
  /** Changes when a different note is opened; resets the document. */
  docKey: string;
  initial: string;
  focus: FocusMode;
  typewriterOn: boolean;
  onChange: (text: string) => void;
  /** A note created just now: start at the end, ready to write. */
  startAtEnd?: boolean;
  /** Reading a page in the notebook: always start at the top. */
  startAtTop?: boolean;
  /** [[Wikilinks]]: resolving, following, suggesting. */
  links?: LinkHost;
  /** Bump when the vault's notes change, to restyle links. */
  linksVersion?: number;
}

// Where you left off in each note, so reopening one returns you there.
const CARET_KEY = "cairn.caret";
const CARET_MAX = 500;
function loadCarets(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(CARET_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function saveCaret(key: string, pos: number) {
  try {
    const all = loadCarets();
    delete all[key]; // re-insert so the newest is last
    all[key] = pos;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - CARET_MAX))) delete all[k];
    localStorage.setItem(CARET_KEY, JSON.stringify(all));
  } catch {
    /* a convenience only */
  }
}

/** First position after frontmatter and the blank lines that follow it. */
function bodyStart(doc: string): number {
  const m = doc.match(/^---\n[\s\S]*?\n---\n\s*/);
  return m ? m[0].length : 0;
}

export interface EditorHandle {
  /** Replace the document with `next` as one minimal, undoable change. */
  apply(next: string): void;
  focus(): void;
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { docKey, initial, focus, typewriterOn, onChange, startAtEnd, startAtTop, links, linksVersion },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const caretTimer = useRef<number | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const linksRef = useRef<LinkHost | null>(links ?? null);
  linksRef.current = links ?? null;
  // Latest mode values, read when a new doc is mounted.
  const modes = useRef({ focus, typewriterOn });
  modes.current = { focus, typewriterOn };

  useImperativeHandle(ref, () => ({
    apply(next) {
      const v = view.current;
      if (!v) return;
      const change = minimalChange(v.state.doc.toString(), next);
      if (change) v.dispatch({ changes: change });
    },
    focus() {
      view.current?.focus();
    },
  }));

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          drawSelection(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          yamlFrontmatter({ content: markdown({ base: markdownLanguage, codeLanguages: languages }) }),
          EditorView.lineWrapping,
          cairnTheme,
          cairnHighlight,
          frontmatterFold,
          focusMode(modes.current.focus),
          typewriter(modes.current.typewriterOn),
          wikilinks(() => linksRef.current),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              window.clearTimeout(caretTimer.current);
              const head = u.state.selection.main.head;
              caretTimer.current = window.setTimeout(() => saveCaret(docKey, head), 400);
            }
          }),
        ],
      }),
    });
    // Where to start: where you left off; a brand-new note's end; else the top.
    const len = v.state.doc.length;
    const saved = loadCarets()[docKey];
    const top = bodyStart(v.state.doc.toString());
    const anchor = startAtEnd ? len : startAtTop ? top : typeof saved === "number" && saved <= len ? saved : top;
    v.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: anchor ? "center" : "start" }) });
    v.focus();
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // Remount only when the note changes; `initial` is read once per note.
  }, [docKey]);

  useEffect(() => {
    if (view.current) setFocusMode(view.current, focus);
  }, [focus]);

  useEffect(() => {
    if (view.current) setTypewriter(view.current, typewriterOn);
  }, [typewriterOn]);

  useEffect(() => {
    view.current?.dispatch({ effects: linksChanged.of(null) });
  }, [linksVersion]);

  return <div className="editor" ref={host} />;
});
