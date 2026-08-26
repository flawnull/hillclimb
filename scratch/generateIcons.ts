import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

mkdirSync("public", { recursive: true });

function createPNG(width: number, height: number, iconSize: number): Buffer {
  // Create RGBA raw buffer
  const stride = width * 4;
  const rawData = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (stride + 1);
    rawData[rowOffset] = 0; // Filter type: None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      
      // Normalized coordinates -1 to 1
      const nx = (x / width) * 2 - 1;
      const ny = (y / height) * 2 - 1;
      const dist = Math.sqrt(nx * nx + ny * ny);

      // Background: Dark slate gradient with amber ring
      let r = 9, g = 13, b = 22, a = 255; // #090d16

      if (dist < 0.95) {
        // Inner badge
        r = 15; g = 23; b = 42; // #0f172a
        
        // Border ring
        if (dist > 0.88) {
          r = 245; g = 158; b = 11; // Amber #f59e0b
        }

        // Draw Mountain Peaks
        // Peak 1: Center high peak (nx: 0, ny: -0.3)
        // Peak 2: Left peak (nx: -0.45, ny: -0.1)
        // Peak 3: Right peak (nx: 0.45, ny: 0.0)
        const inPeak1 = ny >= -0.45 && Math.abs(nx) <= (ny + 0.45) * 0.9 && ny <= 0.45;
        const inPeak2 = ny >= -0.25 && Math.abs(nx + 0.4) <= (ny + 0.25) * 1.1 && ny <= 0.45;
        const inPeak3 = ny >= -0.15 && Math.abs(nx - 0.38) <= (ny + 0.15) * 1.0 && ny <= 0.45;

        if (inPeak1 || inPeak2 || inPeak3) {
          if (inPeak1) {
            r = 251; g = 191; b = 36; // Amber 400
          } else if (inPeak2) {
            r = 217; g = 119; b = 6;  // Amber 600
          } else {
            r = 180; g = 83; b = 9;   // Amber 700
          }
        }

        // Road cutting through mountain: curves from bottom center upward
        if (ny > 0.05 && ny < 0.65) {
          const roadCenter = Math.sin((ny - 0.05) * 4) * 0.15;
          const roadWidth = (ny - 0.05) * 0.5 + 0.08;
          if (Math.abs(nx - roadCenter) < roadWidth) {
            r = 30; g = 41; b = 59; // Road asphalt #1e293b
            // Center dash
            if (Math.abs(nx - roadCenter) < 0.015 && Math.floor(ny * 25) % 2 === 0) {
              r = 255; g = 255; b = 255;
            }
          }
        }
      } else if (dist > 1.0) {
        a = 0; // Transparent corners
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  // PNG Signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR Chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = createChunk("IHDR", ihdr);

  // IDAT Chunk
  const compressed = deflateSync(rawData);
  const idatChunk = createChunk("IDAT", compressed);

  // IEND Chunk
  const iendChunk = createChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type: string, data: Buffer): Buffer {
  const len = data.length;
  const chunk = Buffer.alloc(len + 12);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  const crc = crc32(chunk.subarray(4, len + 8));
  chunk.writeUInt32BE(crc >>> 0, len + 8);
  return chunk;
}

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc ^ 0xffffffff;
}

// Write icons
writeFileSync("public/icon-192.png", createPNG(192, 192, 192));
writeFileSync("public/icon-512.png", createPNG(512, 512, 512));
writeFileSync("public/favicon.ico", createPNG(48, 48, 48));

// Write SVG icon
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
    <linearGradient id="peak1" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
    <linearGradient id="peak2" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="128" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="230" fill="none" stroke="#f59e0b" stroke-width="8" stroke-dasharray="16 8"/>
  <polygon points="120,380 256,150 392,380" fill="url(#peak1)"/>
  <polygon points="60,380 170,220 280,380" fill="url(#peak2)" opacity="0.85"/>
  <polygon points="260,380 360,250 460,380" fill="url(#peak2)" opacity="0.85"/>
  <path d="M 230,380 Q 256,290 256,220 Q 256,290 282,380 Z" fill="#1e293b"/>
  <path d="M 256,230 L 256,380" stroke="#ffffff" stroke-width="4" stroke-dasharray="12 12"/>
</svg>`;

writeFileSync("public/icon.svg", svg);
console.log("Icons generated successfully!");
