// Cairn companion: read, search and jot notes from any browser. Plain
// modules, no dependencies: the page holds private notes, so no third-party
// code runs on it. Markdown is rendered by a small, escape-first renderer.

const $ = (s) => document.querySelector(s);
const view = $("#view");
let vault = null; // { head, notebooks, notes }

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const norm = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const noteHref = (n) => `#/n/${encodeURIComponent(n.notebook)}/${encodeURIComponent(n.file)}`;
const bookTitle = (id) => vault.notebooks.find((b) => b.id === id)?.title ?? id;
const dateOf = (file) => {
  const m = file.match(/^(\d{4})-(\d{2})-(\d{2})-/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
};

// ---- links: the app's rules (same notebook first, then the vault) ----
function resolve(link, here) {
  let book = null;
  let title = link.split("|")[0].split("#")[0];
  const slash = title.lastIndexOf("/");
  if (slash >= 0) {
    book = title.slice(0, slash);
    title = title.slice(slash + 1);
  }
  const k = norm(title);
  const names = (n) => {
    const stem = n.file.replace(/\.md$/, "");
    return [n.title, stem, stem.replace(/^\d{4}-\d{2}-\d{2}-/, "")].map(norm);
  };
  let pool = vault.notes;
  if (book) {
    const b = vault.notebooks.find((x) => norm(x.title) === norm(book) || norm(x.id) === norm(book) || norm(x.id.replace(/^\d+-/, "")) === norm(book));
    if (!b) return null;
    pool = pool.filter((n) => n.notebook === b.id);
  } else if (here) {
    const local = pool.find((n) => n.notebook === here && names(n).includes(k));
    if (local) return local;
  }
  return pool.find((n) => names(n).includes(k)) ?? null;
}

// ---- markdown: escape first, then a small set of rules ----
function inline(s, here) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[\[([^\[\]\n]+?)\]\]/g, (_, inner) => {
      const raw = inner.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      const shown = esc(raw.includes("|") ? raw.split("|").slice(1).join("|") : raw.split("#")[0].split("/").pop());
      const hit = resolve(raw, here);
      return hit ? `<a class="wikilink" href="${noteHref(hit)}">${shown}</a>` : `<span class="wikilink missing" title="No note by that title yet">${shown}</span>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>');
}

function render(md, here) {
  const body = md.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const out = [];
  let list = null;
  let para = [];
  let fence = null;
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "), here)}</p>`);
    para = [];
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of body.split("\n")) {
    if (fence !== null) {
      if (/^\s*(```|~~~)/.test(line)) {
        out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`);
        fence = null;
      } else fence.push(line);
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      fence = [];
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^\s*(?:[-*+]|(\d+)\.)\s+(.*)$/);
    if (h) {
      flush();
      out.push(`<h${h[1].length + 1}>${inline(h[2], here)}</h${h[1].length + 1}>`);
    } else if (li) {
      if (para.length) flush();
      const kind = li[1] ? "ol" : "ul";
      if (list !== kind) {
        if (list) out.push(`</${list}>`);
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline(li[2].replace(/^\[( |x)\]\s+/, (_, x) => (x === "x" ? "☑ " : "☐ ")), here)}</li>`);
    } else if (/^>\s?/.test(line)) {
      flush();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""), here)}</blockquote>`);
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      flush();
      out.push("<hr>");
    } else if (!line.trim()) {
      flush();
    } else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  if (fence !== null) out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`);
  flush();
  return out.join("\n");
}

// ---- search: every word, last one a prefix, titles first ----
function search(q) {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return [];
  const tests = words.map((w, i) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${i === words.length - 1 ? "" : "(?![\\p{L}\\p{N}])"}`, "u"));
  return vault.notes
    .map((n) => {
      const body = norm(n.text.replace(/^---\n[\s\S]*?\n---\n?/, ""));
      const title = norm(n.title);
      if (!tests.every((t) => t.test(`${title} ${body}`))) return null;
      const at = Math.max(0, Math.min(...tests.map((t) => body.search(t)).filter((i) => i >= 0)));
      return { n, score: tests.filter((t) => t.test(title)).length, snippet: body.slice(Math.max(0, at - 50), at + 110) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);
}

// ---- views ----
function home() {
  const counts = new Map();
  for (const n of vault.notes) counts.set(n.notebook, (counts.get(n.notebook) ?? 0) + 1);
  const recent = [...vault.notes].sort((a, b) => b.file.localeCompare(a.file)).slice(0, 8);
  view.innerHTML = `
    <section><h1 class="eyebrow">Notebooks</h1>
      <ul class="books">${vault.notebooks.map((b) => `
        <li><a class="book c-${esc(b.color)}" href="#/b/${encodeURIComponent(b.id)}">
          <span class="no">No. ${String(b.edition).padStart(4, "0")}</span>
          <span class="plate">${esc(b.title)}</span>
          <span class="count">${counts.get(b.id) ?? 0} notes</span>
        </a></li>`).join("")}</ul>
    </section>
    <section><h1 class="eyebrow">Recent</h1>${list(recent, true)}</section>`;
}

function list(notes, showBook) {
  if (!notes.length) return `<p class="hint">Blank pages.</p>`;
  return `<ul class="notes">${notes.map((n) => `
    <li><a href="${noteHref(n)}"><b>${esc(n.title)}</b><span class="hint">${dateOf(n.file)}${showBook ? ` · ${esc(bookTitle(n.notebook))}` : ""}</span></a></li>`).join("")}</ul>`;
}

function notebook(id) {
  const b = vault.notebooks.find((x) => x.id === id);
  if (!b) return notFound();
  const notes = vault.notes.filter((n) => n.notebook === id);
  view.innerHTML = `<h1 class="title">${esc(b.title)}</h1>
    <p class="hint">No. ${String(b.edition).padStart(4, "0")} · ${notes.length} notes · <a href="#/capture/${encodeURIComponent(id)}">add one</a></p>${list(notes, false)}`;
}

function note(id, file) {
  const n = vault.notes.find((x) => x.notebook === id && x.file === file);
  if (!n) return notFound();
  const linking = vault.notes.filter((o) => o !== n && [...o.text.matchAll(/\[\[([^\[\]\n]+?)\]\]/g)].some((m) => resolve(m[1], o.notebook) === n));
  view.innerHTML = `
    <p class="crumbs"><a href="#/b/${encodeURIComponent(id)}">${esc(bookTitle(id))}</a> · ${dateOf(file)}</p>
    <article class="page">${render(n.text, id)}</article>
    ${linking.length ? `<section class="backlinks"><h2 class="eyebrow">Linked from</h2>${list(linking, true)}</section>` : ""}`;
}

function results(q) {
  const hits = search(q);
  view.innerHTML = `<h1 class="eyebrow">Search</h1>${
    hits.length
      ? `<ul class="notes">${hits.map(({ n, snippet }) => `
          <li><a href="${noteHref(n)}"><b>${esc(n.title)}</b><span class="hint">${esc(bookTitle(n.notebook))}</span><span class="snip">…${esc(snippet)}…</span></a></li>`).join("")}</ul>`
      : `<p class="hint">Nothing found.</p>`
  }`;
}

function captureView(pre) {
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  view.innerHTML = `
    <h1 class="title">New note</h1>
    <form id="cap" class="capture">
      <label>Notebook <select name="notebook">${vault.notebooks.map((b) => `<option value="${esc(b.id)}"${b.id === pre ? " selected" : ""}>${esc(b.title)}</option>`).join("")}</select></label>
      <label>Title <input name="title" required maxlength="200" autocomplete="off"></label>
      <label>Note <textarea name="body" rows="10" placeholder="Markdown. [[Link]] other notes by title."></textarea></label>
      <p class="hint">Saved to the vault on GitHub; Cairn picks it up on its next sync.</p>
      <button class="btn primary" type="submit">Save note</button>
      <p class="status" role="status"></p>
    </form>`;
  const form = $("#cap");
  form.title.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = form.querySelector(".status");
    const btn = form.querySelector("button");
    btn.disabled = true;
    status.textContent = "Saving…";
    const r = await fetch("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notebook: form.notebook.value, title: form.title.value, body: form.body.value, today: ymd }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      status.textContent = out.error ?? `Couldn't save (${r.status}).`;
      btn.disabled = false;
      return;
    }
    await load(true);
    const [, nb, file] = out.path.split("/");
    location.hash = `#/n/${encodeURIComponent(nb)}/${encodeURIComponent(file)}`;
  });
}

function notFound() {
  view.innerHTML = `<p class="hint">That note isn't here. <a href="#/">All notebooks</a></p>`;
}

function route() {
  if (!vault) return;
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const q = $("#q").value.trim();
  if (q && parts[0] !== "capture") return results(q);
  if (parts[0] === "b") notebook(parts[1]);
  else if (parts[0] === "n") note(parts[1], parts[2]);
  else if (parts[0] === "capture") captureView(parts[1]);
  else home();
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function load(force) {
  const r = await fetch("/api/vault", { cache: force ? "reload" : "default" });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    view.innerHTML = `<p class="error">${esc(out.error ?? `Couldn't load the vault (${r.status}).`)}</p>`;
    return;
  }
  vault = out;
}

let typing;
$("#q").addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(route, 120);
});
window.addEventListener("hashchange", () => {
  if (!location.hash.startsWith("#/capture")) $("#q").value = "";
  route();
});
load().then(route);
