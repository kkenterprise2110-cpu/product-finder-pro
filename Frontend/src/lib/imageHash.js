// 64-bit difference hash (Normal + Horizontally Flipped) synced with Backend/sync.py

async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hashFromBitmap(bmp, flipX = false) {
  const w0 = bmp.width, h0 = bmp.height;
  const scale = Math.min(1, 288 / Math.max(w0, h0));
  const W = Math.max(9, Math.round(w0 * scale));
  const H = Math.max(8, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  if (flipX) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(bmp, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  const grey = new Float64Array(9 * 8);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 9; c++) {
      const x0 = Math.floor((c * W) / 9), x1 = Math.max(x0 + 1, Math.floor(((c + 1) * W) / 9));
      const y0 = Math.floor((r * H) / 8), y1 = Math.max(y0 + 1, Math.floor(((r + 1) * H) / 8));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          n++;
        }
      }
      grey[r * 9 + c] = sum / n;
    }
  }
  let bits = 0n;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      bits = (bits << 1n) | (grey[r * 9 + c] > grey[r * 9 + c + 1] ? 1n : 0n);
    }
  }
  return BigInt.asIntN(64, bits).toString();
}

export async function dhashFromFile(file) {
  if (!file.type.startsWith('image/')) throw new Error('Fakt image file select karo.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Image 15MB thi nani joye.');
  const bmp = await loadBitmap(file);
  const h = hashFromBitmap(bmp, false);
  if (bmp.close) bmp.close();
  return h;
}

export async function dualDhashFromFile(file) {
  if (!file.type.startsWith('image/')) throw new Error('Fakt image file select karo.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Image 15MB thi nani joye.');
  const bmp = await loadBitmap(file);
  const normal = hashFromBitmap(bmp, false);
  const flipped = hashFromBitmap(bmp, true);
  if (bmp.close) bmp.close();
  return { normal, flipped };
}