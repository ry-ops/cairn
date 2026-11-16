// Typewriter scrolling: keep the caret line vertically centered while typing
// or moving. Large top/bottom padding lets the first and last lines center too.
import { Compartment, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

function typewriterPlugin(on: boolean): Extension {
  if (!on) return [];
  return [
    // --pad-top also offsets ruled paper (App.css), so lines stay aligned.
    EditorView.theme({ "&": { "--pad-top": "45vh" }, ".cm-content": { paddingBottom: "45vh" } }),
    ViewPlugin.fromClass(
      class {
        update(u: ViewUpdate) {
          if (!(u.docChanged || u.selectionSet)) return;
          const view = u.view;
          // Can't dispatch inside an update; defer to the next frame.
          requestAnimationFrame(() => {
            const head = view.state.selection.main.head;
            view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
          });
        }
      },
    ),
  ];
}

export const typewriterCompartment = new Compartment();
export const typewriter = (on: boolean) => typewriterCompartment.of(typewriterPlugin(on));
export const setTypewriter = (view: EditorView, on: boolean) =>
  view.dispatch({ effects: typewriterCompartment.reconfigure(typewriterPlugin(on)) });
