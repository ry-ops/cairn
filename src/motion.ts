// Cover motion. A cover or button SVG may carry one-shot SMIL animation
// (<animate>, <animateTransform>, <animateMotion>, <set>) whose final frame
// is the still image: base attribute values are the end state. Cairn plays
// it as covers arrive in All Notebooks and as a notebook arrives on the
// desktop, and in the cover picker's big preview each time you pick a
// cover. Everywhere else (the shelf, the picker's thumbnails) gets the still image, made by
// dropping those elements, so nothing moves while you work.
const ANIM = /<(animate|animateTransform|animateMotion|set)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/g;

export function stillArt(svg: string): string {
  return svg.replace(ANIM, "");
}

export function isAnimated(svg: string): boolean {
  ANIM.lastIndex = 0;
  return ANIM.test(svg);
}

/** A copy that plays from the start: WebKit caches an SVG image (and its
 *  timeline) per URL, so each showing needs a URL of its own. */
export function replay(svg: string, take: number): string {
  return svg.replace(/<svg\b/, `<!-- take ${take} --><svg`);
}
