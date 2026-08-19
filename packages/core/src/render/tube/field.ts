export interface Point2 {
  x: number;
  y: number;
}

export interface Field {
  readonly data: Float64Array;
  readonly size: number;
  readonly emPerCell: number;
  readonly originX: number;
  readonly originY: number;
  sample(x: number, y: number): number;
}

export interface FieldOptions {
  /** Grid cells per side. */
  resolution: number;
  /** Margin around the silhouette in em, so exterior levels have room to exist. */
  pad: number;
}

/** Larger than any squared distance on the grid, but finite. Infinity yields NaN below. */
const FAR = 1e20;

/** Felzenszwalb & Huttenlocher exact squared-EDT, one dimension. */
function edt1d(f: Float64Array, n: number): Float64Array {
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = Number.NEGATIVE_INFINITY;
  z[1] = Number.POSITIVE_INFINITY;

  for (let q = 1; q < n; q++) {
    const fq = f[q] as number;
    let s =
      (fq + q * q - ((f[v[k] as number] as number) + (v[k] as number) ** 2)) /
      (2 * q - 2 * (v[k] as number));
    while (s <= (z[k] as number)) {
      k--;
      s =
        (fq + q * q - ((f[v[k] as number] as number) + (v[k] as number) ** 2)) /
        (2 * q - 2 * (v[k] as number));
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Number.POSITIVE_INFINITY;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] as number) < q) k++;
    const vk = v[k] as number;
    d[q] = (q - vk) ** 2 + (f[vk] as number);
  }
  return d;
}

/** Exact squared distance from every cell to the nearest zero cell of `mask`. */
function edt2d(mask: Uint8Array, size: number): Float64Array {
  const f = new Float64Array(size);
  const d = new Float64Array(size * size);
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) f[y] = (mask[y * size + x] as number) ? FAR : 0;
    const col = edt1d(f, size);
    for (let y = 0; y < size; y++) d[y * size + x] = col[y] as number;
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) f[x] = d[y * size + x] as number;
    const row = edt1d(f, size);
    for (let x = 0; x < size; x++) d[y * size + x] = row[x] as number;
  }
  return d;
}

function rasterise(polygons: Point2[][], size: number, toGrid: (p: Point2) => Point2): Uint8Array {
  const mask = new Uint8Array(size * size);
  const grid = polygons.map((poly) => poly.map(toGrid));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = false;
      for (const poly of grid) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[i] as Point2;
          const b = poly[j] as Point2;
          if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
          }
        }
      }
      mask[y * size + x] = inside ? 1 : 0;
    }
  }
  return mask;
}

export function signedDistanceField(polygons: Point2[][], opts: FieldOptions): Field {
  const { resolution: size, pad } = opts;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const poly of polygons) {
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  const span = Math.max(maxX - minX, maxY - minY);
  const scale = (size - 1) / span;
  const toGrid = (p: Point2) => ({ x: (p.x - minX) * scale, y: (p.y - minY) * scale });
  const emPerCell = 1 / scale;

  const mask = rasterise(polygons, size, toGrid);
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = (mask[i] as number) ? 0 : 1;

  // Each transform is only meaningful on the far side of the boundary: edt2d(mask) measures an
  // inside cell's distance to background, edt2d(inv) an outside cell's distance to the solid.
  // Pairing them the other way collapses the whole field to zero.
  const toBackground = edt2d(mask, size);
  const toSolid = edt2d(inv, size);
  const data = new Float64Array(size * size);
  for (let i = 0; i < data.length; i++) {
    data[i] =
      ((mask[i] as number)
        ? -Math.sqrt(toBackground[i] as number)
        : Math.sqrt(toSolid[i] as number)) * emPerCell;
  }

  return {
    data,
    size,
    emPerCell,
    originX: minX,
    originY: minY,
    sample(x, y) {
      const gx = Math.round((x - minX) * scale);
      const gy = Math.round((y - minY) * scale);
      if (gx < 0 || gy < 0 || gx >= size || gy >= size) return Number.POSITIVE_INFINITY;
      return data[gy * size + gx] as number;
    },
  };
}

/**
 * Marching squares at `level`, stitched into closed polylines in em coordinates. Segment
 * orientation is not consistent, so the join indexes both endpoints and walks either way.
 */
export function isoContours(field: Field, level: number): Point2[][] {
  const { data, size, emPerCell, originX, originY } = field;
  const at = (x: number, y: number) => data[y * size + x] as number;
  const segs: [Point2, Point2][] = [];

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = [at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)];
      const c = [
        { x, y },
        { x: x + 1, y },
        { x: x + 1, y: y + 1 },
        { x, y: y + 1 },
      ];
      let idx = 0;
      for (let i = 0; i < 4; i++) if ((v[i] as number) < level) idx |= 1 << i;
      if (idx === 0 || idx === 15) continue;

      const e: Point2[] = [];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        if ((v[i] as number) < level !== (v[j] as number) < level) {
          const a = v[i] as number;
          const b = v[j] as number;
          const t = (level - a) / (b - a || 1e-9);
          const p = c[i] as Point2;
          const q = c[j] as Point2;
          e.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        }
      }
      for (let i = 0; i + 1 < e.length; i += 2) {
        segs.push([e[i] as Point2, e[i + 1] as Point2]);
      }
    }
  }

  const key = (p: Point2) => `${Math.round(p.x * 4096)},${Math.round(p.y * 4096)}`;
  const ends = new Map<string, [Point2, Point2][]>();
  for (const s of segs) {
    for (const p of s) {
      const k = key(p);
      const list = ends.get(k);
      if (list) list.push(s);
      else ends.set(k, [s]);
    }
  }

  const used = new Set<[Point2, Point2]>();
  const lines: Point2[][] = [];
  const walk = (line: Point2[]) => {
    for (;;) {
      const tip = line[line.length - 1] as Point2;
      const next = (ends.get(key(tip)) ?? []).find((t) => !used.has(t));
      if (!next) return;
      used.add(next);
      line.push(key(next[0]) === key(tip) ? next[1] : next[0]);
    }
  };

  for (const s of segs) {
    if (used.has(s)) continue;
    used.add(s);
    const line = [s[0], s[1]];
    walk(line);
    line.reverse();
    walk(line);
    if (line.length > 3) lines.push(line);
  }

  return lines.map((line) =>
    line.map((p) => ({ x: originX + p.x * emPerCell, y: originY + p.y * emPerCell })),
  );
}
