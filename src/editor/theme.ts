// Editor look: markdown styled inline, syntax marks present but quiet.
// Colors come from CSS custom properties so light/dark live in App.css.
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const cairnHighlight = syntaxHighlighting(
  HighlightStyle.define([
    // H1/H2 occupy exactly two ruled rows so ruled paper stays aligned.
    { tag: t.heading1, fontSize: "1.55em", fontWeight: "700", fontFamily: "var(--font-display)", lineHeight: "var(--row2)" },
    { tag: t.heading2, fontSize: "1.25em", fontWeight: "700", fontFamily: "var(--font-display)", lineHeight: "var(--row2)" },
    { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "700" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: [t.link, t.url], color: "var(--ink-link)" },
    { tag: t.monospace, color: "var(--ink-code)" },
    { tag: t.quote, color: "var(--ink-soft)", fontStyle: "italic" },
    // #, *, _, `, >, list bullets, frontmatter fences: visible, quiet.
    { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--ink-mark)" },
    // YAML frontmatter: small and quiet.
    { tag: [t.definition(t.propertyName), t.propertyName], color: "var(--ink-soft)" },
    { tag: [t.string, t.bool, t.number, t.atom, t.keyword], color: "var(--ink-soft)" },
    { tag: [t.squareBracket, t.brace, t.separator, t.punctuation], color: "var(--ink-mark)" },
  ]),
);

export const cairnTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--editor-size)",
    color: "var(--ink)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-editor)",
    lineHeight: "var(--row)",
    overflowX: "hidden",
  },
  ".cm-content": {
    maxWidth: "68ch",
    margin: "0 auto",
    padding: "var(--pad-top) 1.5rem 40vh",
    caretColor: "var(--caret)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--caret)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-dimmed": { opacity: "0.28", transition: "opacity 160ms ease" },
  ".cm-fm-chip": {
    display: "inline-block",
    margin: "0 0 var(--row)",
    padding: "1px 10px",
    border: "1px dashed var(--ink-mark)",
    borderRadius: "999px",
    fontFamily: "var(--font-ui)",
    fontSize: "11px",
    lineHeight: "calc(var(--row) - 4px)",
    color: "var(--ink-soft)",
    cursor: "pointer",
    userSelect: "none",
  },
});
