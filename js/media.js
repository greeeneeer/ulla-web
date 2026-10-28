// 찍은 화면을 사진 파일·동영상 파일로 만든다.

/// 다 쓴 캔버스의 메모리를 바로 돌려준다 (iOS는 캔버스 메모리 한도가 작다).
export function release(canvas) { canvas.width = 0; canvas.height = 0; }

export function sizeText(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.round(bytes / 1024) + " KB";
}

function stamp() { return new Date().toISOString().replace(/\D/g, "").slice(0, 14); }

/// target 가운데에 source를 rotation도(시계 반대) 돌려 w×h 크기로 그린다.
function drawRotated(target, source, rotation, w = source.width, h = source.height) {
  const ctx = target.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.setTransform(1, 0, 0, 1, target.width / 2, target.height / 2);
  ctx.rotate(-rotation * Math.PI / 180);
  ctx.drawImage(source, -w / 2, -h / 2, w, h);
}

/// 돌렸을 때 크기에 맞춘 빈 캔버스.
function rotatedCanvas(w, h, rotation) {
  const sideways = rotation === 90 || rotation === 270;
  return Object.assign(document.createElement("canvas"), { width: sideways ? h : w, height: sideways ? w : h });
}

/// 캔버스를 JPEG 파일로 만든다. small이면 긴 변 2048, 압축 0.5. 실패하면 null.
export function encodePhoto(canvas, rotation, small) {
  const long = Math.max(canvas.width, canvas.height);
  const s = small && long > 2048 ? 2048 / long : 1;
  let src = canvas;
  if (s !== 1 || rotation) {
    const w = Math.round(canvas.width * s), h = Math.round(canvas.height * s);
    src = rotatedCanvas(w, h, rotation);
    drawRotated(src, canvas, rotation, w, h);
  }
  return new Promise((resolve) => src.toBlob((blob) => {
    const result = blob && {
      file: new File([blob], `ulla-${stamp()}.jpg`, { type: "image/jpeg" }),
      info: `${src.width}×${src.height} · ${sizeText(blob.size)}`,
    };
    if (src !== canvas) release(src);
    resolve(result);
  }, "image/jpeg", small ? 0.5 : 0.92));
}

export const canRecord = typeof HTMLCanvasElement.prototype.captureStream === "function" && typeof MediaRecorder !== "undefined";

function pickMime() {
  return ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

/// 필터가 걸린 화면(캔버스)을 그대로 녹화한다.
/// 폰을 가로로 들고 시작하면 화면을 돌려 그린 캔버스를 녹화해서 가로 동영상으로 만든다.
export class Recorder {
  constructor(view, audioTracks, rotation) {
    this.view = view;
    this.rotation = rotation;
    if (rotation) {
      this.canvas = rotatedCanvas(view.width, view.height, rotation);
      this.frame();
    }
    const source = this.canvas || view;
    this.size = `${source.width}×${source.height}`;
    const out = source.captureStream(30);
    audioTracks.forEach((t) => out.addTrack(t));
    this.mime = pickMime();
    try {
      this.media = new MediaRecorder(out, this.mime ? { mimeType: this.mime } : undefined);
    } catch (e) {
      this.dispose();
      throw e;
    }
    this.chunks = [];
    this.media.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.media.start(1000);
    this.startedAt = performance.now();
  }

  get seconds() { return (performance.now() - this.startedAt) / 1000; }

  /// 화면을 새로 그릴 때마다 부른다.
  frame() {
    if (this.canvas) drawRotated(this.canvas, this.view, this.rotation);
  }

  /// 녹화를 끝내고 {file, info}를 돌려준다. 비어 있으면 null.
  stop() {
    return new Promise((resolve) => {
      this.media.onstop = () => {
        const seconds = Math.round(this.seconds);
        const type = this.media.mimeType || this.mime || "video/mp4";
        this.dispose();
        const blob = new Blob(this.chunks, { type });
        if (!blob.size) return resolve(null);
        const ext = type.includes("webm") ? "webm" : "mp4";
        resolve({
          file: new File([blob], `ulla-${stamp()}.${ext}`, { type: type.split(";")[0] }),
          info: `${this.size} · ${seconds}초 · ${sizeText(blob.size)}`,
        });
      };
      this.media.stop();
    });
  }

  dispose() {
    if (this.canvas) { release(this.canvas); this.canvas = null; }
  }
}
