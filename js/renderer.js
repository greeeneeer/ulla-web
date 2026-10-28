// 미리보기와 저장을 같은 WebGL 셰이더로 그린다.
// 아이폰 7 모드는 앱(Ulla/FrameStyle.swift의 IPhone7Look)과 같은 계산 순서다. 한쪽을 바꾸면 다른 쪽도 맞춰야 한다.

const VERT = `#version 300 es
in vec2 p; uniform float mirror; uniform float zoom; out vec2 uv; out vec2 suv;
void main() {
  suv = p * 0.5 + 0.5;
  // 디지털 확대: 가운데를 잘라 키운다.
  vec2 z = 0.5 + (suv - 0.5) / max(zoom, 1.0);
  uv = vec2(mirror > 0.5 ? 1.0 - z.x : z.x, z.y);
  gl_Position = vec4(p, 0.0, 1.0);
}`;
// 밝은 부분만 뽑아 작은 화면에 내려 그린다.
const EXTRACT = `#version 300 es
precision mediump float;
in vec2 uv; in vec2 suv; uniform sampler2D src; uniform vec2 texel; out vec4 o;
void main() {
  // 8×8 칸을 4×4로 훑어 작은 조명도 놓치지 않는다. 칸 안에서 가장 밝은 값 쪽으로 기울여 모은다.
  vec3 sum = vec3(0.0);
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    vec3 c = texture(src, uv + texel * vec2(float(x) * 2.0 - 3.0, float(y) * 2.0 - 3.0)).rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    sum += c * smoothstep(0.7, 1.0, l);
  }
  o = vec4(min(sum * 0.25, vec3(1.0)), 1.0);
}`;
const BLUR = `#version 300 es
precision mediump float;
in vec2 suv; uniform sampler2D src; uniform vec2 dir; out vec4 o;
void main() {
  float w[5] = float[](0.204, 0.180, 0.124, 0.066, 0.028);
  vec3 c = texture(src, suv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    c += texture(src, suv + dir * float(i)).rgb * w[i];
    c += texture(src, suv - dir * float(i)).rgb * w[i];
  }
  o = vec4(c, 1.0);
}`;
// 노출·번짐·색 행렬은 선형 빛에서, 톤 커브는 sRGB 값에서 한다 (Core Image와 같게).
const FINAL = `#version 300 es
precision highp float;
in vec2 uv; in vec2 suv; uniform sampler2D src; uniform sampler2D glow; uniform float look; uniform float gain; out vec4 o;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float curve(float x) {
  if (x < 0.25) return mix(0.02, 0.25, x / 0.25);
  if (x < 0.5) return mix(0.25, 0.52, (x - 0.25) / 0.25);
  if (x < 0.75) return mix(0.52, 0.78, (x - 0.5) / 0.25);
  return mix(0.78, 1.0, (x - 0.75) / 0.25);
}
void main() {
  vec3 c = texture(src, uv).rgb;
  if (look > 0.5) {
    vec3 lin = toLin(c) * gain;
    vec3 g = toLin(texture(glow, suv).rgb) * vec3(0.55, 0.42, 0.25);
    lin = 1.0 - (1.0 - clamp(lin, 0.0, 1.0)) * (1.0 - clamp(g, 0.0, 1.0));
    c = toSrgb(lin);
    c = vec3(curve(c.r), curve(c.g), curve(c.b));
    c = toSrgb(toLin(clamp(c, 0.0, 1.0)) * vec3(1.04, 1.01, 0.89));
  }
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

/// canvas에 그리는 렌더러를 만든다. WebGL2가 없으면 null.
export function createRenderer(canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false, alpha: false });
  if (!gl) return null;

  const program = (fs) => {
    const make = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "p");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return { p, u: (n) => gl.getUniformLocation(p, n) };
  };
  const texture = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const target = (w, h) => {
    const tex = texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  };
  const pass = (prog, fb, w, h, setup) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p);
    setup(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const bind = (unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit);
  };

  const progs = { extract: program(EXTRACT), blur: program(BLUR), final: program(FINAL) };
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const videoTex = texture();
  // 번짐은 1/8 크기에서 뽑고 흐린다.
  let glowA, glowB;
  const resizeGlow = (w, h) => {
    const gw = Math.max(1, Math.round(w / 8)), gh = Math.max(1, Math.round(h / 8));
    if (glowA && glowA.w === gw && glowA.h === gh) return;
    glowA = target(gw, gh); glowB = target(gw, gh);
  };

  /// 비디오 한 장면을 그린다. 아직 영상이 없으면 false.
  /// look: 아이폰 7 모드, ev: 찍은 뒤 올리는 밝기, zoom: 가운데를 잘라 키우는 배율.
  function draw(video, { mirror, zoom, look, ev }) {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return false;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    resizeGlow(w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    const m = mirror ? 1 : 0;

    if (look) {
      pass(progs.extract, glowA.fb, glowA.w, glowA.h, (u) => {
        bind(0, videoTex, u("src")); gl.uniform1f(u("mirror"), m); gl.uniform1f(u("zoom"), zoom);
        gl.uniform2f(u("texel"), 1 / w, 1 / h);
      });
      for (const [from, to, dx, dy] of [[glowA, glowB, 1, 0], [glowB, glowA, 0, 1]]) {
        pass(progs.blur, to.fb, to.w, to.h, (u) => {
          bind(0, from.tex, u("src")); gl.uniform1f(u("mirror"), 0); gl.uniform1f(u("zoom"), 1);
          gl.uniform2f(u("dir"), dx * 1.3 / to.w, dy * 1.3 / to.h);
        });
      }
    }
    pass(progs.final, null, w, h, (u) => {
      bind(0, videoTex, u("src")); bind(1, glowA.tex, u("glow"));
      gl.uniform1f(u("mirror"), m); gl.uniform1f(u("zoom"), zoom);
      // 찍은 뒤 빛에 2^노출을 곱한다. 클수록 밝은 곳이 더 넓게 하얗게 날아간다.
      gl.uniform1f(u("look"), look ? 1 : 0); gl.uniform1f(u("gain"), Math.pow(2, ev));
    });
    return true;
  }

  /// 방금 그린 화면을 픽셀로 읽어 일반 캔버스로 옮긴다. 실패하면 null.
  /// WebGL 캔버스를 바로 이미지로 내보내면 일부 iOS에서 검은 사진이 나와서 이렇게 우회한다.
  function snapshot() {
    const w = canvas.width, h = canvas.height;
    const px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (gl.isContextLost() || px[3] === 0) return null;
    // WebGL은 아래 줄부터 읽혀서 위아래를 뒤집는다.
    const row = w * 4, tmp = new Uint8Array(row);
    for (let top = 0, bottom = (h - 1) * row; top < bottom; top += row, bottom -= row) {
      tmp.set(px.subarray(top, top + row));
      px.copyWithin(top, bottom, bottom + row);
      px.set(tmp, bottom);
    }
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(px.buffer), w, h), 0, 0);
    return c;
  }

  return { draw, snapshot };
}
