// Test-only preload (see vitest.config.ts). jsdom 31 loads undici 8, which reads
// zlib.createZstdDecompress at import time; that function only exists on Node 22.15 and newer.
// The stub lets older Node 22.x (such as 22.12 on some dev machines) start the jsdom test workers.
// It is never called: no test performs a network request. The real fix is a newer Node.
import zlib from 'node:zlib'

if (typeof zlib.createZstdDecompress !== 'function') {
  zlib.createZstdDecompress = () => {
    throw new Error('zstd is not available on this Node version')
  }
}
