import { useEffect, useRef } from 'react';
import { cn } from '@/lib/format';
import { useMotionEnabled } from './motionPref';

/*
 * Original GPU background: layered domain-warped value noise shaped into slow "tide" bands in the
 * brand colors (indigo, teal, violet) over deep navy, with a soft glow that leans toward the pointer
 * and a touch of film grain. Renders only while visible, caps DPR, and freezes on one frame when
 * motion is reduced. If WebGL is unavailable, the CSS gradient underneath is what people see.
 */
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPointer;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uBase;
uniform float uIntensity;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes.xy;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes.xy) / uRes.y;
  float t = uTime * 0.045;

  // Domain warping gives the slow, liquid motion.
  vec2 q = vec2(fbm(p * 1.4 + vec2(0.0, t)), fbm(p * 1.4 + vec2(5.2, -t)));
  vec2 r = vec2(fbm(p * 1.8 + 3.0 * q + vec2(1.7, 9.2) + t * 0.8), fbm(p * 1.8 + 3.0 * q + vec2(8.3, 2.8) - t * 0.6));
  float f = fbm(p * 1.2 + 2.6 * r);

  // Horizontal "tide" bands that drift upward.
  float band1 = smoothstep(0.35, 0.0, abs(uv.y - 0.62 - 0.12 * sin(p.x * 2.2 + t * 6.0) - 0.18 * (f - 0.5)));
  float band2 = smoothstep(0.30, 0.0, abs(uv.y - 0.38 - 0.10 * sin(p.x * 1.6 - t * 5.0 + 1.3) - 0.22 * (r.x - 0.5)));

  vec3 col = uBase;
  col = mix(col, uA, band1 * (0.55 + 0.45 * f) * uIntensity);
  col = mix(col, uB, band2 * (0.45 + 0.55 * r.y) * uIntensity);
  col = mix(col, uC, smoothstep(0.55, 0.95, f) * 0.35 * uIntensity);

  // Pointer glow.
  vec2 m = (uPointer - 0.5 * uRes.xy) / uRes.y;
  col += uA * 0.22 * uIntensity * exp(-6.0 * length(p - m));

  // Vignette + grain.
  col *= 1.0 - 0.35 * pow(length(uv - 0.5) * 1.25, 2.0);
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) * 0.03;
  gl_FragColor = vec4(col, 1.0);
}`;

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

const PALETTES: Record<'night' | 'deep', { a: string; b: string; c: string; base: string }> = {
  night: { a: '#6366f1', b: '#14b8a6', c: '#a855f7', base: '#060a17' },
  deep: { a: '#4f46e5', b: '#0d9488', c: '#7c3aed', base: '#070b1a' },
};

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

export function AuroraCanvas({ className, palette = 'night', intensity = 1 }: { className?: string; palette?: keyof typeof PALETTES; intensity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const motion = useMotionEnabled();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return; // CSS fallback stays visible
    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    } catch {
      return;
    }
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (n: string) => gl.getUniformLocation(program, n);
    const pal = PALETTES[palette];
    gl.uniform3fv(u('uA'), hex(pal.a));
    gl.uniform3fv(u('uB'), hex(pal.b));
    gl.uniform3fv(u('uC'), hex(pal.c));
    gl.uniform3fv(u('uBase'), hex(pal.base));
    gl.uniform1f(u('uIntensity'), intensity);
    const uRes = u('uRes');
    const uTime = u('uTime');
    const uPointer = u('uPointer');

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr * 0.75)); // shader is soft; render below native res
      canvas.height = Math.max(1, Math.round(height * dpr * 0.75));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      pointer.x = pointer.tx = canvas.width * 0.7;
      pointer.y = pointer.ty = canvas.height * 0.6;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onPointer = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / r.width) * canvas.width;
      pointer.ty = (1 - (e.clientY - r.top) / r.height) * canvas.height;
    };
    if (motion) window.addEventListener('pointermove', onPointer, { passive: true });

    let raf = 0;
    let visible = true;
    const start = performance.now() - 20_000; // start mid-flow, not from a flat frame
    const draw = (now: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform2f(uPointer, pointer.x, pointer.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (motion && visible) raf = requestAnimationFrame(draw);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(draw);
    });
    io.observe(canvas);
    raf = requestAnimationFrame(draw);
    canvas.dataset.ready = 'true';

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('pointermove', onPointer);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [motion, palette, intensity]);

  return (
    <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_30%,rgba(99,102,241,.45),transparent),radial-gradient(50%_40%_at_20%_70%,rgba(20,184,166,.35),transparent),#060a17]" />
      <canvas ref={ref} className="absolute inset-0 h-full w-full opacity-0 transition-opacity duration-1000 data-[ready=true]:opacity-100" />
    </div>
  );
}
