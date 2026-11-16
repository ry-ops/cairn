// Choose a notebook's cover: built-in
// presets in several colorways, your own covers (this notebook's cover.svg
// and the shared library in <vault>/covers), the title-plate color, or ask
// Claude for an original via the cairn-cover skill.
import { useEffect, useMemo, useState } from "react";
import { EDITIONS } from "../covers";
import { PRESETS, parsePreset, presetButton, presetCover, resolveArt } from "../cover-presets";
import type { Notebook, NotebookMeta } from "../store";
import { CoverArt, svgDataUrl } from "./Cover";

const STYLES = ["hand-drawn", "watercolor", "letterpress", "monoprint"] as const;

export interface CoverChoice {
  cover: string;
  color: string;
  ruling: string | null | undefined; // undefined = leave as is, null = remove
}

interface Props {
  notebook: Notebook;
  /** The notebook's own custom art, if any (cover.svg / lib:…). */
  custom: { cover: string | null; button: string | null };
  library: string[];
  readLibrary: (name: string) => Promise<string | null>;
  onApply: (c: CoverChoice) => void;
  onSaveToLibrary: (name: string) => Promise<string>;
  onClose: () => void;
}

export function CoverPicker({ notebook, custom, library, readLibrary, onApply, onSaveToLibrary, onClose }: Props) {
  const { meta } = notebook;
  const [cover, setCover] = useState(meta.cover);
  const [color, setColor] = useState(meta.color);
  const [plateTouched, setPlateTouched] = useState(false);
  const [useRuling, setUseRuling] = useState(!!meta.ruling);
  const [libArt, setLibArt] = useState<Record<string, string | null>>({});
  const [style, setStyle] = useState<string>("watercolor");
  const [idea, setIdea] = useState("");
  const [copied, setCopied] = useState(false);
  const [libName, setLibName] = useState(meta.title);
  // The big preview plays a cover's motion each time you pick one.
  const [take, setTake] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setTake(Date.now());
  }, [cover]);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(library.map(async (n) => [n, await readLibrary(n).catch(() => null)] as const)).then((pairs) =>
      setLibArt(Object.fromEntries(pairs)),
    );
  }, [library, readLibrary]);

  const ownFile = meta.cover.endsWith(".svg") ? meta.cover : null;
  const preset = parsePreset(cover);

  function choose(next: string) {
    setCover(next);
    const p = parsePreset(next);
    if (p && !plateTouched) setColor(p.colorway.plate);
    setUseRuling(!!p?.colorway.ruling);
  }

  // Art for the live preview.
  const previewMeta: NotebookMeta = { ...meta, cover, color };
  const previewCustom =
    cover === meta.cover ? custom
    : cover.startsWith("lib:") ? { cover: libArt[cover.slice(4)] ?? null, button: null }
    : { cover: null, button: null };
  const art = resolveArt(previewMeta, previewCustom);
  const previewBook: Notebook = { ...notebook, meta: previewMeta };

  const prompt = useMemo(() => {
    const s = style === "surprise" ? "a style of your choosing (hand-drawn, watercolor, letterpress or monoprint)" : `the ${style} style`;
    return `Use the cairn-cover skill to make an original cover for my Cairn notebook "${meta.title}" (${notebook.id}) in ${s}.${idea.trim() ? ` Subject or mood: ${idea.trim()}.` : ""} Save it as cover.svg.`;
  }, [style, idea, meta.title, notebook.id]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      (document.getElementById("cover-prompt") as HTMLTextAreaElement | null)?.select();
    }
  }

  function apply() {
    // Presets set or clear the ruling ink; other covers leave it alone.
    const ruling = preset ? (useRuling && preset.colorway.ruling ? preset.colorway.ruling : null) : undefined;
    onApply({ cover, color, ruling });
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet picker" role="dialog" aria-label={`Cover for ${meta.title}`} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="picker-preview">
          <div className="picker-cover"><CoverArt notebook={previewBook} art={art.cover} take={take} /></div>
        </div>

        <div className="picker-options">
          <h3>Cover · {meta.title}</h3>
          {/* Options scroll; the title and the actions stay put. */}
          <div className="picker-scroll">

          <section>
            <div className="picker-label">Built in</div>
            <div className="tiles">
              <Tile label="Kraft" selected={cover === "kraft-classic"} onClick={() => choose("kraft-classic")}>
                <CoverArt notebook={{ ...notebook, meta: { ...meta, cover: "kraft-classic", color } }} art={null} />
              </Tile>
              {PRESETS.map((p) => {
                const cw = preset?.preset.id === p.id ? preset.colorway : p.colorways[0];
                return (
                  <Tile key={p.id} label={p.label} sub={p.style} selected={preset?.preset.id === p.id} onClick={() => choose(`${p.id}/${cw.id}`)}>
                    <img src={svgDataUrl(presetCover(p.id, cw))} alt="" />
                  </Tile>
                );
              })}
            </div>
            {preset && (
              <div className="colorways" role="radiogroup" aria-label="Colorway">
                {preset.preset.colorways.map((cw) => (
                  <button
                    key={cw.id}
                    type="button"
                    role="radio"
                    aria-checked={cw.id === preset.colorway.id}
                    className={`colorway${cw.id === preset.colorway.id ? " on" : ""}`}
                    onClick={() => choose(`${preset.preset.id}/${cw.id}`)}
                  >
                    <img src={svgDataUrl(presetButton(preset.preset.id, cw))} alt="" />
                    {cw.label}
                  </button>
                ))}
              </div>
            )}
            {preset?.colorway.ruling && (
              <label className="check">
                <input type="checkbox" checked={useRuling} onChange={(e) => setUseRuling(e.target.checked)} />
                Rule the pages to match
                <span className="ink" style={{ background: preset.colorway.ruling }} />
              </label>
            )}
          </section>

          {(ownFile || library.length > 0) && (
            <section>
              <div className="picker-label">Yours</div>
              <div className="tiles">
                {ownFile && custom.cover && (
                  <Tile label="This notebook's" sub={ownFile} selected={cover === ownFile} onClick={() => choose(ownFile)}>
                    <img src={svgDataUrl(custom.cover)} alt="" />
                  </Tile>
                )}
                {library.map((n) => (
                  <Tile key={n} label={n} sub="library" selected={cover === `lib:${n}`} onClick={() => choose(`lib:${n}`)}>
                    {libArt[n] ? <img src={svgDataUrl(libArt[n]!)} alt="" /> : <div className="tile-empty" />}
                  </Tile>
                ))}
              </div>
              {ownFile && custom.cover && (
                <form
                  className="save-lib"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setSaved(await onSaveToLibrary(libName));
                  }}
                >
                  <input value={libName} onChange={(e) => setLibName(e.target.value)} aria-label="Library name" />
                  <button className="btn" type="submit">Save this notebook's cover to the library</button>
                  {saved && <span className="hint">Saved as {saved}</span>}
                </form>
              )}
            </section>
          )}

          <section>
            <div className="picker-label">Title plate</div>
            <div className="swatches">
              {EDITIONS.map((e) => (
                <button
                  type="button"
                  key={e.name}
                  className={`swatch${e.name === color ? " on" : ""}`}
                  style={{ background: e.stock }}
                  onClick={() => {
                    setColor(e.name);
                    setPlateTouched(true);
                  }}
                  title={e.label}
                  aria-label={e.label}
                  aria-pressed={e.name === color}
                />
              ))}
            </div>
          </section>

          <section className="original">
            <div className="picker-label">Make an original</div>
            <p className="hint">Ask Claude Code in the <code>cairn</code> repo; the <code>cairn-cover</code> skill draws a new cover just for this notebook.</p>
            <div className="original-row">
              <select value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Style">
                {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                <option value="surprise">surprise me</option>
              </select>
              <input value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Subject or mood (optional): frozen creek, first snow" aria-label="Subject or mood" />
            </div>
            <textarea id="cover-prompt" readOnly value={prompt} rows={3} aria-label="Request for Claude" />
            <button type="button" className="btn" onClick={copyPrompt}>{copied ? "Copied" : "Copy request"}</button>
          </section>

          </div>
          <div className="sheet-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn primary" onClick={apply}>Use this cover</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, sub, selected, onClick, children }: {
  label: string;
  sub?: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={`tile${selected ? " on" : ""}`} onClick={onClick} aria-pressed={selected}>
      <span className="tile-art">{children}</span>
      <span className="tile-label">{label}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </button>
  );
}
