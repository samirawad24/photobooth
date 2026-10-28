// One WebGL shader draws both the live viewfinder and the final photos, so
// what guests see on screen is exactly what ends up on the print.

const VERT = `
attribute vec2 p;
uniform vec4 crop;
uniform float mirror;
varying vec2 v;
varying vec2 q;
void main() {
  vec2 uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  q = uv;
  float x = mirror > 0.5 ? 1.0 - uv.x : uv.x;
  v = crop.xy + vec2(x, uv.y) * crop.zw;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 v;
varying vec2 q;
uniform sampler2D tex;
uniform vec2 outSize;
uniform vec2 glowStep;
uniform float exposure, contrast, sat, warmth, tint, fade, mono, vignette, grain, glow, seed;
uniform vec3 tone, shadows, highlights;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 c = texture2D(tex, v).rgb;

  if (glow > 0.0) {
    vec3 b = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5236;
      vec2 d = vec2(cos(a), sin(a));
      b += texture2D(tex, v + d * glowStep).rgb;
      b += texture2D(tex, v + d * glowStep * 2.2).rgb;
    }
    b /= 24.0;
    b = b * b;
    c = 1.0 - (1.0 - c) * (1.0 - b * glow);
  }

  c *= exp2(exposure);
  c *= vec3(1.0 + warmth, 1.0 + warmth * 0.25 + tint, 1.0 - warmth);

  float l = dot(c, LUMA);
  c = mix(vec3(l), c, sat);
  c = mix(c, vec3(l) * tone, mono);

  c = (c - 0.5) * contrast + 0.5;

  l = clamp(dot(c, LUMA), 0.0, 1.0);
  c += shadows * (1.0 - l) + highlights * l;

  c = fade + c * (1.0 - fade * 1.25);

  float d = length((q - 0.5) * vec2(1.0, outSize.y / outSize.x)) * 1.35;
  c *= 1.0 - vignette * smoothstep(0.3, 1.0, d);

  if (grain > 0.0) {
    float n = hash(q * outSize + seed) + hash(q * outSize * 0.5 + seed * 1.7) - 1.0;
    c += n * grain * (1.0 - abs(l - 0.5));
  }

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const UNIFORMS = ['crop', 'mirror', 'tex', 'outSize', 'glowStep', 'exposure', 'contrast', 'sat', 'warmth',
  'tint', 'fade', 'mono', 'vignette', 'grain', 'glow', 'seed', 'tone', 'shadows', 'highlights'];

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// Crop window (in 0..1 texture space) that center-fills a target aspect.
export function cropFor(srcW, srcH, aspect) {
  const src = srcW / srcH;
  if (src > aspect) {
    const w = aspect / src;
    return [(1 - w) / 2, 0, w, 1];
  }
  const h = src / aspect;
  return [0, (1 - h) / 2, 1, h];
}

export function createRenderer(canvas) {
  let gl = null;
  let loc = {};
  let texture = null;

  function init() {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) return false;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);

    loc = {};
    for (const u of UNIFORMS) loc[u] = gl.getUniformLocation(prog, u);

    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(loc.tex, 0);
    return true;
  }

  // A long night can lose the GPU context (memory pressure, app switching).
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); gl = null; });
  canvas.addEventListener('webglcontextrestored', () => { try { init(); } catch {} });

  const ok = init();

  // Draws `source` (video, canvas or image) filtered into the canvas at w x h.
  function draw(source, srcW, srcH, { w, h, filter, crop = [0, 0, 1, 1], mirror = false, seed = 0 }) {
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (!gl) {
      // No WebGL: still produce an unfiltered picture rather than nothing.
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.save();
      if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
      ctx.drawImage(source, crop[0] * srcW, crop[1] * srcH, crop[2] * srcW, crop[3] * srcH, 0, 0, w, h);
      ctx.restore();
      return true;
    }
    const f = filter || {};
    gl.viewport(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    gl.uniform4fv(loc.crop, crop);
    gl.uniform1f(loc.mirror, mirror ? 1 : 0);
    gl.uniform2f(loc.outSize, w, h);
    // Glow radius scales with the output so it looks the same at any size.
    const r = 0.012 * Math.max(w, h);
    gl.uniform2f(loc.glowStep, (r / w) * crop[2], (r / h) * crop[3]);
    gl.uniform1f(loc.exposure, f.exposure ?? 0);
    gl.uniform1f(loc.contrast, f.contrast ?? 1);
    gl.uniform1f(loc.sat, f.sat ?? 1);
    gl.uniform1f(loc.warmth, f.warmth ?? 0);
    gl.uniform1f(loc.tint, f.tint ?? 0);
    gl.uniform1f(loc.fade, f.fade ?? 0);
    gl.uniform1f(loc.mono, f.mono ?? 0);
    gl.uniform1f(loc.vignette, f.vignette ?? 0);
    gl.uniform1f(loc.grain, f.grain ?? 0);
    gl.uniform1f(loc.glow, f.glow ?? 0);
    gl.uniform1f(loc.seed, seed);
    gl.uniform3fv(loc.tone, f.tone ?? [1, 1, 1]);
    gl.uniform3fv(loc.shadows, f.shadows ?? [0, 0, 0]);
    gl.uniform3fv(loc.highlights, f.highlights ?? [0, 0, 0]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  return { canvas, draw, ok };
}
