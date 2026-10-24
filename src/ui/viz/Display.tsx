import { useEffect, useRef } from 'react';
import { FB_HEIGHT as H, FB_WIDTH as W } from '../../../spec/vm_api.ts';

/** The 64×32 framebuffer at 0x20000 (pixel = 0x00RRGGBB). */
export function Display({ fb }: { fb: Uint32Array | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const v = fb?.[i] ?? 0;
      img.data[i * 4] = (v >>> 16) & 255;
      img.data[i * 4 + 1] = (v >>> 8) & 255;
      img.data[i * 4 + 2] = v & 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });

  let lit = 0;
  if (fb) for (const v of fb) if (v) lit++;

  return (
    <div className="display">
      <div className="display-head">
        <span className="legend-title">Display</span>
        <span className="unit-sub">64×32 · {lit} px lit</span>
      </div>
      <canvas ref={canvas} width={W} height={H} className="display-canvas" aria-label={`Framebuffer, ${lit} pixels lit`} />
    </div>
  );
}
