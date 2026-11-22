// Lecture des cartes CDI (Code 128) par la caméra de la borne.
// Utilise le détecteur intégré du navigateur quand il existe, sinon un décodeur Code 128 sans dépendance.
const patterns = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232".split(" ").map((p) => [...p].map(Number));
const STOP = [2, 3, 3, 1, 1, 1, 2];

function symbol(runs, at) {
  const slice = runs.slice(at, at + 6);
  if (slice.length < 6) return { value:-1, error:Infinity };
  const module = slice.reduce((a, b) => a + b, 0) / 11;
  let best = -1, error = Infinity;
  patterns.forEach((pattern, value) => {
    let worst = 0;
    for (let i = 0; i < 6; i++) worst = Math.max(worst, Math.abs(slice[i] / module - pattern[i]));
    if (worst < error) { error = worst; best = value; }
  });
  return { value:best, error };
}

function runsOf(line, threshold) {
  const runs = [], dark = [];
  let current = line[0] < threshold[0], length = 0;
  for (let i = 0; i < line.length; i++) {
    const isDark = line[i] < threshold[i];
    if (isDark === current) length++;
    else { runs.push(length); dark.push(current); current = isDark; length = 1; }
  }
  runs.push(length); dark.push(current);
  return { runs, dark };
}
function decodeRuns(runs, dark) {
  for (let start = 0; start < runs.length - 30; start++) {
    if (!dark[start]) continue;
    const head = symbol(runs, start);
    if (head.value !== 104 || head.error > 0.65) continue;
    const values = [104];
    let at = start + 6, ok = false;
    while (at + 6 <= runs.length && values.length < 60) {
      const stopModule = runs.slice(at, at + 7).reduce((a, b) => a + b, 0) / 13;
      if (at + 7 <= runs.length && STOP.every((width, i) => Math.abs(runs[at + i] / stopModule - width) < 0.65)) { ok = true; break; }
      const next = symbol(runs, at);
      if (next.error > 0.65 || next.value > 102) break;
      values.push(next.value);
      at += 6;
    }
    if (!ok || values.length < 3) continue;
    const check = values.pop();
    const sum = values.reduce((total, value, i) => total + value * (i || 1), 0) % 103;
    if (sum !== check) continue;
    return values.slice(1).map((value) => String.fromCharCode(value + 32)).join("");
  }
  return null;
}
// Seuil local : milieu entre le minimum et le maximum d’une fenêtre glissante (résiste à l’éclairage inégal).
function localThreshold(line, radius) {
  const out = new Float32Array(line.length);
  for (let i = 0; i < line.length; i++) {
    let low = 255, high = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(line.length - 1, i + radius); j++) { if (line[j] < low) low = line[j]; if (line[j] > high) high = line[j]; }
    out[i] = high - low < 30 ? -1 : (low + high) / 2;
  }
  return out;
}
const smooth = (line) => line.map((value, i) => (line[Math.max(0, i - 1)] + value * 2 + line[Math.min(line.length - 1, i + 1)]) / 4);

// Décode une ligne de luminance (0–255). Retourne le texte (jeu B) ou null.
export function decodeLine(line) {
  let min = 255, max = 0;
  for (const value of line) { if (value < min) min = value; if (value > max) max = value; }
  if (max - min < 40) return null;
  for (const source of [Float32Array.from(line), smooth(Float32Array.from(line))]) {
    for (const threshold of [new Float32Array(line.length).fill((min + max) / 2), localThreshold(source, 12), localThreshold(source, 24)]) {
      const { runs, dark } = runsOf(source, threshold);
      const found = decodeRuns(runs, dark);
      if (found) return found;
    }
  }
  return null;
}

// Cherche un code dans une image en niveaux de gris (lignes, puis colonnes pour une carte tenue verticalement).
// Chaque ligne analysée est la moyenne de 5 lignes voisines : les barres étant verticales, le bruit du capteur s’atténue.
export function decodeImage(gray, width, height) {
  const band = (y) => {
    const line = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      let total = 0, count = 0;
      for (let dy = -2; dy <= 2; dy++) { const row = y + dy; if (row >= 0 && row < height) { total += gray[row * width + x]; count++; } }
      line[x] = total / count;
    }
    return line;
  };
  const stripe = (x) => {
    const line = new Uint8Array(height);
    for (let y = 0; y < height; y++) {
      let total = 0, count = 0;
      for (let dx = -2; dx <= 2; dx++) { const col = x + dx; if (col >= 0 && col < width) { total += gray[y * width + col]; count++; } }
      line[y] = total / count;
    }
    return line;
  };
  for (let k = 0; k < 15; k++) {
    const line = band(Math.round(height * (0.2 + k * 0.6 / 14)));
    const found = decodeLine(line) ?? decodeLine(line.reverse());
    if (found) return found;
  }
  for (let k = 0; k < 9; k++) {
    const line = stripe(Math.round(width * (0.25 + k * 0.5 / 8)));
    const found = decodeLine(line) ?? decodeLine(line.reverse());
    if (found) return found;
  }
  return null;
}

const valid = (text) => /^CDI[0-9A-F]{10}$/.test(text);

// Ouvre la caméra dans `container` et appelle `onCode` avec le premier code CDI valide. Retourne une fonction d’arrêt.
export async function startScanner(container, onCode) {
  const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment", width:{ ideal:1280 }, height:{ ideal:720 } }, audio:false });
  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.muted = true;
  video.srcObject = stream;
  container.replaceChildren(video);
  await video.play();
  let detector = null;
  try {
    if ("BarcodeDetector" in globalThis && (await BarcodeDetector.getSupportedFormats()).includes("code_128")) detector = new BarcodeDetector({ formats:["code_128"] });
  } catch { detector = null; }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently:true });
  let stopped = false, timer;
  const stop = () => { stopped = true; clearTimeout(timer); stream.getTracks().forEach((track) => track.stop()); };
  const tick = async () => {
    if (stopped) return;
    try {
      let found = null;
      if (detector) found = (await detector.detect(video)).map((item) => item.rawValue).find(valid) ?? null;
      if (!found && video.videoWidth) {
        // Pleine résolution (plafonnée) : les barres fines d’une carte lointaine restent lisibles.
        const scale = Math.min(1, 1600 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        const gray = new Uint8Array(canvas.width * canvas.height);
        for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
        const text = decodeImage(gray, canvas.width, canvas.height);
        if (text && valid(text)) found = text;
      }
      if (found) { stop(); onCode(found); return; }
    } catch { /* image suivante */ }
    timer = setTimeout(tick, 120);
  };
  tick();
  return stop;
}
