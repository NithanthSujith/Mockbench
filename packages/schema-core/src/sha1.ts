// Synchronous SHA-1 and UUID v5. Written by hand because crypto.subtle does not exist on
// http://<LAN-IP> (insecure context) and the node "crypto" module must never reach the browser.

const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0

/** SHA-1 of `bytes` (20-byte digest). */
export function sha1(bytes: Uint8Array): Uint8Array {
  const length = bytes.length
  const total = ((length + 9 + 63) >> 6) << 6
  const buf = new Uint8Array(total)
  buf.set(bytes)
  buf[length] = 0x80
  const view = new DataView(buf.buffer)
  const bits = length * 8
  view.setUint32(total - 8, Math.floor(bits / 0x100000000))
  view.setUint32(total - 4, bits >>> 0)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)

  for (let off = 0; off < total; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(off + t * 4)
    for (let t = 16; t < 80; t++) {
      w[t] = rotl((w[t - 3] ?? 0) ^ (w[t - 8] ?? 0) ^ (w[t - 14] ?? 0) ^ (w[t - 16] ?? 0), 1)
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let t = 0; t < 80; t++) {
      let f: number
      let k: number
      if (t < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (t < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + (w[t] ?? 0)) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = temp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const out = new Uint8Array(20)
  const ov = new DataView(out.buffer)
  ;[h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h))
  return out
}

const HEX = '0123456789abcdef'

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`Invalid UUID "${uuid}"`)
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Formats 16 bytes as a lowercase hyphenated UUID string. */
export function formatUuid(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < 16; i++) {
    const b = bytes[i] ?? 0
    s += HEX[b >> 4]! + HEX[b & 15]!
    if (i === 3 || i === 5 || i === 7 || i === 9) s += '-'
  }
  return s
}

/** RFC 4122 UUID v5 (name-based, SHA-1). `namespace` is a UUID string, `name` is UTF-8 encoded. */
export function uuidv5(namespace: string, name: string): string {
  const ns = uuidToBytes(namespace)
  const nm = new TextEncoder().encode(name)
  const data = new Uint8Array(ns.length + nm.length)
  data.set(ns)
  data.set(nm, ns.length)
  const digest = sha1(data).slice(0, 16)
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80
  return formatUuid(digest)
}
