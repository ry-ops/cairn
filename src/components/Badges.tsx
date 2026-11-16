// The sash (every merit badge, earned or still to earn) and the award that
// stitches a newly earned one in. Awards are the one place Cairn moves for
// its own sake: motion is for rewards (ADR-001 §6).
import { useEffect, useId, useMemo } from "react";
import { BADGES, type VaultStats, patchSvg } from "../badges";
import { svgDataUrl } from "./Cover";

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function BadgeSash({ earned, stats, onClose }: {
  earned: Record<string, string>;
  stats: VaultStats | null;
  onClose: () => void;
}) {
  const urls = useMemo(() => new Map(BADGES.map((b) => [b.id, svgDataUrl(patchSvg(b.patch))])), []);
  const count = BADGES.filter((b) => earned[b.id]).length;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet sash" role="dialog" aria-label="Merit badges">
        <header className="sash-head">
          <h3>Merit badges</h3>
          <span className="hint">{count} of {BADGES.length}</span>
          <button className="link-btn" onClick={onClose}>close</button>
        </header>
        <ul className="sash-grid">
          {BADGES.map((b) => {
            const on = earned[b.id];
            const p = !on && stats && b.progress ? b.progress(stats) : null;
            return (
              <li key={b.id} className={on ? "earned" : "locked"}>
                <img src={urls.get(b.id)} alt="" draggable={false} />
                <b>{b.name}</b>
                <span className="hint">{on ? `Earned ${fmtDate(on)}` : b.how}</span>
                {p && p[1] > 1 && (
                  <span className="progress" aria-label={`${p[0]} of ${p[1]}`}>
                    <span style={{ width: `${(100 * p[0]) / p[1]}%` }} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="hint">Earned from what's in this vault, and kept in <code>badges.yml</code> there.</p>
      </div>
    </div>
  );
}

/** A newly earned badge (or a few), stitched in at the bottom of the window. */
export function BadgeAward({ ids, onOpen, onDone }: { ids: string[]; onOpen: () => void; onDone: () => void }) {
  const first = BADGES.find((b) => b.id === ids[0]);
  const mask = `stitch-${useId().replace(/:/g, "")}`;
  useEffect(() => {
    const t = window.setTimeout(onDone, 6000);
    return () => window.clearTimeout(t);
  }, [ids, onDone]);
  const url = useMemo(() => (first ? svgDataUrl(patchSvg(first.patch)) : ""), [first]);
  if (!first) return null;
  const more = ids.length - 1;
  return (
    <button className="award" onClick={onOpen} title="See all merit badges" aria-live="polite">
      <span className="award-patch">
        <svg className="award-stitch" viewBox="0 0 120 120" aria-hidden="true">
          <defs>
            <mask id={mask}>
              <circle className="reveal" cx="60" cy="60" r="57" pathLength="1" />
            </mask>
          </defs>
          <circle className="thread" cx="60" cy="60" r="57" pathLength="1" mask={`url(#${mask})`} />
        </svg>
        <img src={url} alt="" />
      </span>
      <span className="award-text">
        <span className="eyebrow">Merit badge earned</span>
        <b>{first.name}</b>
        <span className="hint">{more ? `and ${more} more. See them all.` : first.how}</span>
      </span>
    </button>
  );
}
