const shapes = {
  book: '<path d="M12 6C9 3 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 2Zm0 0v15"/>',
  scan: '<path d="M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4M7 9v6m3-6v6m4-6v6m3-6v6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  login: '<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M4 12h11m-4-4 4 4-4 4"/>',
  logout: '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5m0-8h10m-4-4 4 4-4 4"/>',
  users: '<path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m19 0v-2a4 4 0 0 0-3-3.8M16 4a4 4 0 0 1 0 8"/><circle cx="9.5" cy="8" r="4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  wide: '<path d="M3 5h18v14H3zM9 22h6m-3-3v3M8 10h8m-8 4h8"/>',
  fullscreen: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
  settings: '<path d="M4 7h4m4 0h8M4 17h9m4 0h3"/><circle cx="10" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download: '<path d="M12 4v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  print: '<path d="M7 8V4h10v4M7 17H3v-7h18v7h-4M7 14h10v6H7zm10-3h1"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="m13 6 5 5M5 19l4-1 11-11-4-4L5 14z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2 7M20 4v7h-7"/>',
  chart: '<path d="M4 19h16M6 15v-3m4 3V8m4 7V5m4 10V9"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1"/>',
  previous: '<path d="m15 6-6 6 6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  warning: '<path d="M12 3 2 20h20L12 3zm0 6v5m0 3h.01"/>',
};
export const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]}</svg>`;
const escapes = { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" };
export const e = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => escapes[char]);
export const fullName = (row) => `${e(row.first_name)} ${e(row.last_name)}`;
const timeFormat = new Intl.DateTimeFormat("fr-FR", { hour:"2-digit", minute:"2-digit", timeZone:"Europe/Paris" });
const dayFormat = new Intl.DateTimeFormat("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric", timeZone:"Europe/Paris" });
const isoFormat = new Intl.DateTimeFormat("en-CA", { year:"numeric", month:"2-digit", day:"2-digit", timeZone:"Europe/Paris" });
export const time = (value) => timeFormat.format(value);
export const day = (value) => dayFormat.format(new Date(typeof value === "string" ? value + "T12:00:00Z" : value));
export const today = () => isoFormat.format(new Date());
export const notice = (message, tone = "", symbol) => `<div class="notice ${tone}">${icon(symbol ?? (tone === "error" ? "warning" : tone === "success" ? "check" : "info"))}<div>${e(message)}</div></div>`;
const wordmark = new URL("./ticecdi-logo.webp", import.meta.url);
const mark = new URL("./ticecdi-icon.webp", import.meta.url);
export function brand(square=false,hero=false) {
  if(square) return `<img class="tice-brand-icon" src="${mark}" width="256" height="256" alt="TiceCDI">`;
  return `<picture class="${hero?"tice-hero-logo":"tice-wordmark"}">
    ${hero?"":`<source media="(max-width: 560px)" srcset="${mark}">`}
    <img src="${wordmark}" width="1200" height="376" alt="${hero?"TiceCDI — Une application de TiceConnect":"TiceCDI"}"></picture>`;
}

const phpEntry = globalThis.document?.querySelector('meta[name="cdi-entry"]')?.content;

export function urlFor(path) {
  if (!phpEntry) return path;
  const url = new URL(path, location.origin);
  url.searchParams.set("route", url.pathname);
  return phpEntry + "?" + url.searchParams.toString() + url.hash;
}

export function routePath() {
  return phpEntry ? new URLSearchParams(location.search).get("route") || "/" : location.pathname;
}

export async function api(path, method = "GET", data) {
  const sendsBody = data !== undefined;
  const response = await fetch(urlFor("/api" + path), {
    method,
    credentials: "same-origin",
    ...(sendsBody ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}),
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error("Le serveur a renvoyé une réponse inattendue."); }
  if (!response.ok) {
    const error = new Error(result.error || "L’action a échoué.");
    error.status = response.status;
    throw error;
  }
  return result;
}

export function csvRows(text) {
  const source = text.replace(/^\uFEFF/, "");
  let inQuote = false;
  let firstLine = "";
  for (const char of source) {
    if (char === '"') inQuote = !inQuote;
    if (!inQuote && (char === "\n" || char === "\r")) break;
    if (!inQuote) firstLine += char;
  }
  const separator = [";", ",", "\t"].sort((a,b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const grid = [];
  let row = [], cell = "";
  inQuote = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"' && inQuote && source[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"' && (inQuote || !cell.trim())) inQuote = !inQuote;
    else if (!inQuote && char === separator) { row.push(cell.trim()); cell = ""; }
    else if (!inQuote && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell.trim());
      grid.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (inQuote) throw new Error("Un champ entre guillemets est incomplet dans le fichier.");
  row.push(cell.trim());
  grid.push(row);
  const headers = (grid.shift() ?? []).map((col) => col.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, ""));
  const index = (...names) => headers.findIndex((name) => names.includes(name));
  const last = index("nom", "nomdefamille", "last", "lastname");
  const first = index("prenom", "prenoms", "first", "firstname");
  const group = index("classe", "fullclass", "classname", "division");
  const reference = index("id", "identifiantinterne", "identifiant", "identifiantexterne", "numeroeleve", "externalid");
  if (last < 0 || first < 0 || group < 0) throw new Error("Le fichier doit contenir les colonnes Nom, Prénom et Classe sur la première ligne.");
  if (grid.some((fields) => fields.some(Boolean) && fields.length !== headers.length)) throw new Error("Certaines lignes n’ont pas le même nombre de colonnes que l’en-tête.");
  return grid.filter((fields) => fields.some(Boolean)).map((fields) => ({
    last_name:fields[last] ?? "", first_name:fields[first] ?? "", class_name:fields[group] ?? "", external_id:fields[reference] ?? "",
  }));
}

const codePatterns = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");
export function renderBarcode(value) {
  const values = [...value].map((char) => char.charCodeAt(0) - 32);
  const checksum = values.reduce((total, code, i) => total + code * (i + 1), 104) % 103;
  let x = 10;
  let bars = "";
  for (const symbol of [104, ...values, checksum, 106]) {
    [...codePatterns[symbol]].forEach((digit, i) => {
      const width = Number(digit);
      if (i % 2 === 0) bars += `<rect x="${x}" width="${width}" height="39"/>`;
      x += width;
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 10} 39" preserveAspectRatio="none" fill="#000" shape-rendering="crispEdges" aria-hidden="true">${bars}</svg>`;
}
