const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Generate a refined high-quality PNG icon with rounded corners, WhatsApp Emerald gradient background,
 * and a crisp WhatsApp chat bubble + AI sparkle motif.
 */
function createRefinedPNG(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: RGBA (Truecolor with alpha)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = createChunk('IHDR', ihdr);

  const scanlineSize = size * 4 + 1;
  const rawData = Buffer.alloc(size * scanlineSize);

  const cornerRadius = size * 0.22;
  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * scanlineSize;
    rawData[rowOffset] = 0; // Filter: None

    for (let x = 0; x < size; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Rounded rectangle distance calculation
      let dist = 0;
      const dx = Math.max(0, Math.abs(x - cx) - (cx - cornerRadius));
      const dy = Math.max(0, Math.abs(y - cy) - (cy - cornerRadius));
      dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > cornerRadius) {
        // Outside rounded corners -> transparent
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
        continue;
      }

      // Anti-aliasing edge
      let alpha = 255;
      if (dist > cornerRadius - 1) {
        alpha = Math.floor((1 - (dist - (cornerRadius - 1))) * 255);
      }

      // Emerald gradient (#075E54 to #00A884)
      const gradRatio = (x + y) / (size * 2);
      let r = Math.floor(7 + gradRatio * (0 - 7));
      let g = Math.floor(94 + gradRatio * (168 - 94));
      let b = Math.floor(84 + gradRatio * (132 - 84));

      // Draw Chat Bubble outline (white shape in center)
      const nx = (x - cx) / (size * 0.4);
      const ny = (y - cy) / (size * 0.4);

      // Chat bubble body: circle/ellipse
      const isBubbleBody = (nx * nx + ny * ny < 0.55);
      // Chat bubble tail: bottom left triangle extension
      const isTail = (nx < -0.1 && nx > -0.65 && ny > 0.2 && ny < 0.65 && (nx + ny < 0.1));

      // AI Sparkle star center (+ and x shape inside bubble)
      const sx = (x - cx);
      const sy = (y - cy);
      const isSparkleCenter = (Math.abs(sx) < size * 0.08 && Math.abs(sy) < size * 0.25) ||
                              (Math.abs(sy) < size * 0.08 && Math.abs(sx) < size * 0.25) ||
                              (Math.abs(sx - sy) < size * 0.08 && Math.abs(sx + sy) < size * 0.3) ||
                              (Math.abs(sx + sy) < size * 0.08 && Math.abs(sx - sy) < size * 0.3);

      if ((isBubbleBody || isTail)) {
        if (isSparkleCenter) {
          // Vibrant Gold / Cyan AI Sparkle
          r = 255;
          g = 215;
          b = 0;
        } else {
          // White chat bubble
          r = 255;
          g = 255;
          b = 255;
        }
      }

      // Subtle inner border glow
      if (dist > cornerRadius - 2.5 && dist <= cornerRadius - 1) {
        r = Math.min(255, r + 40);
        g = Math.min(255, g + 40);
        b = Math.min(255, b + 40);
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = alpha;
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(4 + 4 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);

  const crcVal = crc32(buf.slice(4, 8 + len));
  buf.writeUInt32BE(crcVal, 8 + len);
  return buf;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const iconBuffer = createRefinedPNG(size);
  const filePath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, iconBuffer);
  console.log(`Refined icon generated at ${filePath} (${size}x${size})`);
});
