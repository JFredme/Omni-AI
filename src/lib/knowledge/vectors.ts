/** Vectors are stored as unit-length little-endian float32 bytes, so cosine similarity is a plain dot product. */

export function normalize(vector: number[]): Float32Array {
  const out = new Float32Array(vector.length);
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum);
  if (length === 0) return out;
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / length;
  return out;
}

export function toBytes(vector: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(vector.byteLength);
  bytes.set(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength));
  return bytes;
}

export function fromBytes(bytes: Uint8Array): Float32Array {
  // Copy first: a pooled Buffer can start at an offset that isn't a multiple of 4.
  const copy = new Uint8Array(bytes);
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}

export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function topK<T>(items: T[], score: (item: T) => number, k: number, minScore = -Infinity): { item: T; score: number }[] {
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const value = score(item);
    if (value >= minScore) scored.push({ item, score: value });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}
