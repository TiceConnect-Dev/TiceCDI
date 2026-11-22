// Générateur de QR code minimal (mode octet, correction M, versions 1 à 15), sans dépendance.
// Utilisé pour l’enrôlement de la double authentification : le secret ne quitte jamais le navigateur.
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10];
const FORMAT_M = 0;

const bit = (value, index) => ((value >>> index) & 1) !== 0;
function rawModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}
const dataCodewords = (version) => Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];

function multiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function divisor(degree) {
  const result = Array(degree - 1).fill(0).concat([1]);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = multiply(root, 0x02);
  }
  return result;
}
function remainder(data, div) {
  const result = div.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    div.forEach((coef, i) => { result[i] ^= multiply(coef, factor); });
  }
  return result;
}

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  for (; version < ECC_PER_BLOCK.length; version++) {
    const countBits = version < 10 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(version) * 8) break;
  }
  if (version >= ECC_PER_BLOCK.length) throw new Error("Texte trop long pour le QR code.");
  const capacity = dataCodewords(version) * 8;
  const bits = [];
  const push = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((byte) => push(byte, 8));
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, b) => acc << 1 | b, 0));

  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => Array(size).fill(false));
  const set = (x, y, dark) => { modules[y][x] = dark; fixed[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
    }
  }
  if (version > 1) {
    const count = Math.floor(version / 7) + 2;
    const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    const positions = [6];
    for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
    positions.forEach((px, i) => positions.forEach((py, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === count - 1) || (i === count - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
  }
  const drawFormat = (mask) => {
    const value = FORMAT_M << 3 | mask;
    let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const format = ((value << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(format, i));
    set(8, 7, bit(format, 6)); set(8, 8, bit(format, 7)); set(7, 8, bit(format, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(format, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(format, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(format, i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const value = version << 12 | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + i % 3, b = Math.floor(i / 3);
      set(a, b, bit(value, i)); set(b, a, bit(value, i));
    }
  }

  const blockCount = BLOCKS[version], eccLength = ECC_PER_BLOCK[version];
  const raw = Math.floor(rawModules(version) / 8);
  const shortBlocks = blockCount - raw % blockCount;
  const shortLength = Math.floor(raw / blockCount);
  const div = divisor(eccLength);
  const blocks = [];
  for (let i = 0, k = 0; i < blockCount; i++) {
    const chunk = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    k += chunk.length;
    const ecc = remainder(chunk, div);
    if (i < shortBlocks) chunk.push(0);
    blocks.push(chunk.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((block, j) => {
    if (i !== shortLength - eccLength || j >= shortBlocks) codewords.push(block[i]);
  });

  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (!fixed[y][x] && index < codewords.length * 8) {
        modules[y][x] = bit(codewords[index >>> 3], 7 - (index & 7));
        index++;
      }
    }
  }

  const masks = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
  ];
  const applyMask = (mask) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && masks[mask](x, y)) modules[y][x] = !modules[y][x];
  };
  // Pénalité simplifiée (suites, blocs 2×2, équilibre) : toute valeur de masque reste valide pour la lecture.
  const penalty = () => {
    let score = 0, dark = 0;
    for (let a = 0; a < size; a++) {
      for (const line of [(i) => modules[a][i], (i) => modules[i][a]]) {
        let run = 1;
        for (let i = 1; i < size; i++) {
          if (line(i) === line(i - 1)) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
          else run = 1;
        }
      }
      for (let b = 0; b < size; b++) {
        if (modules[a][b]) dark++;
        if (a < size - 1 && b < size - 1) {
          const c = modules[a][b];
          if (c === modules[a][b + 1] && c === modules[a + 1][b] && c === modules[a + 1][b + 1]) score += 3;
        }
      }
    }
    return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  };
  let best = 0, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask); drawFormat(mask);
    const score = penalty();
    if (score < bestScore) { best = mask; bestScore = score; }
    applyMask(mask);
  }
  applyMask(best); drawFormat(best);
  return modules;
}

export function qrSvg(text, label = "QR code") {
  const modules = qrMatrix(text);
  const size = modules.length + 8;
  let path = "";
  modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x + 4} ${y + 4}h1v1h-1z`; }));
  return `<svg class="qr-code" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label.replace(/[&<>"]/g, "")}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
