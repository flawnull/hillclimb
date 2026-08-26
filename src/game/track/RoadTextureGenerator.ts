/**
 * VAL BORBERA HILLCLIMB — Procedural Road Texture Generator
 * Generates photorealistic high-frequency tarmac textures with aggregate flecks,
 * dual-lane tire wear paths, gravel shoulders, and road markings.
 */

import * as THREE from "three";

export function createTwoLaneRoadTexture(): THREE.CanvasTexture {
  if (typeof document === "undefined") {
    return new THREE.CanvasTexture(null as unknown as HTMLCanvasElement);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // 1. Base Mountain Asphalt with fine aggregate texture & rich micro-contrast
  ctx.fillStyle = "#1e2229";
  ctx.fillRect(0, 0, 1024, 1024);

  // High-fidelity aggregate grain, stone flecks and bitumen micro-texture
  const imgData = ctx.getImageData(0, 0, 1024, 1024);
  const data = imgData.data;
  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      const i = (y * 1024 + x) * 4;
      
      // Fast, non-periodic pseudo-random noise
      const r = Math.random();
      
      // High frequency asphalt grain
      const grain = (r - 0.5) * 20.0;
      
      // Bright aggregate flecks (stones embedded in bitumen)
      const fleck = Math.random() > 0.98 ? (15 + Math.random() * 25) : 0;
      
      const noise = grain;
      
      data[i] = Math.max(0, Math.min(255, data[i] + noise + fleck));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise + fleck + 1));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise + fleck + 2));
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // 2. Lateral Shoulders / Gravel Verges (Left: 0..90px, Right: 934..1024px)
  const leftGravel = ctx.createLinearGradient(0, 0, 90, 0);
  leftGravel.addColorStop(0, "#736b5e");
  leftGravel.addColorStop(0.4, "#5c554a");
  leftGravel.addColorStop(0.85, "#3e3931");
  leftGravel.addColorStop(1, "rgba(40,44,52,0.1)");
  ctx.fillStyle = leftGravel;
  ctx.fillRect(0, 0, 90, 1024);

  const rightGravel = ctx.createLinearGradient(934, 0, 1024, 0);
  rightGravel.addColorStop(0, "rgba(40,44,52,0.1)");
  rightGravel.addColorStop(0.15, "#3e3931");
  rightGravel.addColorStop(0.6, "#5c554a");
  rightGravel.addColorStop(1, "#736b5e");
  ctx.fillStyle = rightGravel;
  ctx.fillRect(934, 0, 90, 1024);

  // 3. Realistic Soft Feathered Tire Wear Tracks
  const drawTireTrack = (centerX: number, width: number) => {
    const trackGrad = ctx.createLinearGradient(centerX - width / 2, 0, centerX + width / 2, 0);
    trackGrad.addColorStop(0, "rgba(14, 16, 20, 0)");
    trackGrad.addColorStop(0.25, "rgba(12, 14, 18, 0.28)");
    trackGrad.addColorStop(0.5, "rgba(10, 12, 16, 0.42)");
    trackGrad.addColorStop(0.75, "rgba(12, 14, 18, 0.28)");
    trackGrad.addColorStop(1, "rgba(14, 16, 20, 0)");
    ctx.fillStyle = trackGrad;
    ctx.fillRect(centerX - width / 2, 0, width, 1024);
  };

  // Left Lane tracks (~225px and ~375px)
  drawTireTrack(225, 100);
  drawTireTrack(375, 100);
  // Right Lane tracks (~645px and ~795px)
  drawTireTrack(645, 100);
  drawTireTrack(795, 100);

  // 4. Crisp Solid White Edge Lines with subtle weathering
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(90, 0, 18, 1024);
  ctx.fillRect(916, 0, 18, 1024);

  // 5. Centerline: Dashed White Divider (Center at 512px, 16px wide, 560px dash / 464px gap)
  ctx.fillStyle = "#f8fafc";
  const dashLength = 560;
  ctx.fillRect(504, 0, 16, dashLength);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 16;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
