// 울라 웹 버전: 화면과 버튼을 카메라·렌더러·저장에 잇는다.
import { Camera } from "./camera.js";
import { canRecord, encodePhoto, Recorder, release } from "./media.js";
import { saveRotation, startMotion } from "./motion.js";
import { createRenderer } from "./renderer.js";

const $ = (id) => document.getElementById(id);
const view = $("view");
const camera = new Camera();
const renderer = createRenderer(view);
let recorder = null;
let last = null; // 마지막으로 찍은 {file, url, info}

// ---- 설정 (이 기기에만 기억) ----
const settings = { look: false, mirror: true, small: false, ev: 0.3 };
try { Object.assign(settings, JSON.parse(localStorage.getItem("ulla") || "{}")); } catch {}
delete settings.glow; delete settings.tint;
const saveSettings = () => { try { localStorage.setItem("ulla", JSON.stringify(settings)); } catch {} };

for (const [id, key] of [["t-look", "look"], ["t-mirror", "mirror"], ["t-small", "small"]]) {
  const el = $(id);
  const sync = () => el.setAttribute("aria-pressed", String(settings[key]));
  el.addEventListener("click", () => { settings[key] = !settings[key]; saveSettings(); sync(); updateControls(); });
  sync();
}
{
  const slider = $("ev");
  const sync = () => {
    slider.value = settings.ev;
    $("ev-val").textContent = (settings.ev >= 0 ? "+" : "") + Number(settings.ev).toFixed(1);
  };
  slider.addEventListener("input", () => { settings.ev = Number(slider.value); saveSettings(); sync(); });
  sync();
}

/// 카메라 방향·설정에 따라 버튼과 안내를 맞춘다. 안내 문구는 없고 실패했을 때만 알린다.
function updateControls() {
  $("t-mirror").disabled = camera.facing !== "user";
  $("ev-row").hidden = !settings.look;
  $("info").textContent = " ";
}
function showError(text) { $("info").textContent = text; }

// ---- 확대 ----
const zoomLabel = (z) => z < 1 || Math.abs(z - Math.round(z)) > 0.05 ? z.toFixed(1) : String(Math.round(z));

function updateZoom() {
  const presets = camera.presets, z = camera.zoom;
  // 지금 배율 이하인 가장 큰 버튼에 현재 배율을 띄운다 (기본 카메라 앱처럼).
  const active = [...presets].reverse().find((p) => p <= z + 0.01) ?? presets[0];
  $("zoom").replaceChildren(...presets.map((p) => {
    const b = document.createElement("button");
    b.setAttribute("aria-pressed", String(p === active));
    b.textContent = p === active ? zoomLabel(z) + "×" : zoomLabel(p);
    b.addEventListener("click", async () => { await camera.setZoom(p, !recorder); updateZoom(); });
    return b;
  }));
  $("zoom").hidden = false;
}
{
  let startDist = 0;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  view.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) { startDist = dist(e.touches); camera.pinchStart(); }
  }, { passive: true });
  view.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 2 || !startDist) return;
    e.preventDefault();
    camera.pinch(dist(e.touches) / startDist);
    updateZoom();
  }, { passive: false });
  view.addEventListener("touchend", () => { startDist = 0; });
}

// ---- 카메라 ----
async function openCamera() {
  await camera.open();
  updateControls();
  updateZoom();
}

function draw() {
  return renderer.draw(camera.video, {
    mirror: camera.facing === "user" && settings.mirror,
    zoom: camera.digitalZoom,
    look: settings.look,
    ev: settings.ev,
  });
}

function loop() {
  if (draw() && recorder) recorder.frame();
  if (camera.video.requestVideoFrameCallback) camera.video.requestVideoFrameCallback(loop);
  else requestAnimationFrame(loop);
}

function showGate(text, button) {
  $("gate").hidden = false;
  $("gate-text").textContent = text;
  $("start").hidden = !button;
}

$("start").addEventListener("click", async () => {
  startMotion();
  try {
    await openCamera();
    $("gate").hidden = true;
    $("shutter").disabled = false; $("flip").disabled = false;
    $("modes").hidden = !canRecord;
    loop();
  } catch (e) {
    showGate(e && e.name === "NotAllowedError"
      ? "카메라 권한이 꺼져 있어요. 설정 › Safari › 카메라에서 '허용'으로 바꾼 뒤 다시 눌러 주세요."
      : "카메라를 열지 못했어요. 다른 앱이 카메라를 쓰고 있지 않은지 확인해 주세요.", true);
  }
});

$("flip").addEventListener("click", async () => {
  $("flip").disabled = true;
  await camera.flip();
  updateControls();
  updateZoom();
  $("flip").disabled = false;
});

// ---- 사진·동영상 모드 ----
function setMode(next) {
  if (next === camera.mode || recorder) return;
  camera.mode = next;
  $("m-photo").setAttribute("aria-pressed", String(next === "photo"));
  $("m-video").setAttribute("aria-pressed", String(next === "video"));
  $("shutter").classList.toggle("video", next === "video");
  $("shutter").setAttribute("aria-label", next === "video" ? "녹화 시작" : "찍기");
  openCamera().catch(() => {});
}
$("m-photo").addEventListener("click", () => setMode("photo"));
$("m-video").addEventListener("click", () => setMode("video"));

$("shutter").addEventListener("click", () => camera.mode === "video" ? toggleRecording() : takePhoto());

// ---- 사진 ----
async function takePhoto() {
  if (!draw()) return;
  const flash = $("flash");
  flash.classList.add("on"); requestAnimationFrame(() => requestAnimationFrame(() => flash.classList.remove("on")));
  const shot = renderer.snapshot();
  if (!shot) return showError("사진을 만들지 못했어요. 페이지를 새로고침한 뒤 다시 찍어 주세요.");
  $("shutter").disabled = true;
  const photo = await encodePhoto(shot, saveRotation(), settings.small);
  release(shot);
  $("shutter").disabled = false;
  if (!photo) return showError("사진을 만들지 못했어요. '용량 줄이기'를 켜고 다시 찍어 주세요.");
  showResult(photo);
}

// ---- 동영상 ----
let recTimer = 0;

async function toggleRecording() {
  if (recorder) return finishRecording();
  try { recorder = new Recorder(view, camera.stream.getAudioTracks(), saveRotation()); }
  catch { return showError("이 브라우저에서는 동영상을 찍을 수 없어요."); }
  $("rec").hidden = false; $("rec").textContent = "● 0:00";
  recTimer = setInterval(() => {
    const s = Math.floor(recorder.seconds);
    $("rec").textContent = `● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 500);
  $("shutter").classList.add("recording");
  $("flip").disabled = true;
}

async function finishRecording() {
  const done = recorder;
  const clip = await done.stop();
  recorder = null;
  clearInterval(recTimer);
  $("rec").hidden = true;
  $("shutter").classList.remove("recording");
  $("flip").disabled = false;
  if (!clip) return showError("동영상을 만들지 못했어요. 다시 찍어 주세요.");
  showResult(clip);
}

// ---- 결과 화면 ----
function showResult({ file, info }) {
  if (last) URL.revokeObjectURL(last.url);
  last = { file, info, url: URL.createObjectURL(file) };
  if (file.type.startsWith("image/")) $("thumb").style.backgroundImage = `url(${last.url})`;
  $("thumb").disabled = false;
  openSheet();
}

function openSheet() {
  const isVideo = last.file.type.startsWith("video/");
  $("shot").hidden = isVideo;
  $("clip").hidden = !isVideo;
  if (isVideo) { $("clip").src = last.url; $("shot").removeAttribute("src"); }
  else { $("shot").src = last.url; $("clip").pause(); $("clip").removeAttribute("src"); }
  $("shot-info").textContent = last.info;
  const canShare = navigator.canShare && navigator.canShare({ files: [last.file] });
  $("save").hidden = !canShare;
  $("save").textContent = isVideo ? "동영상 저장" : "사진에 저장";
  $("sheet-hint").textContent = canShare
    ? (isVideo ? "'동영상 저장'을 누르고 공유 창에서 '동영상 저장'을 고르세요." : "'사진에 저장'을 누르고 공유 창에서 '이미지 저장'을 고르세요.")
    : (isVideo ? "이 브라우저에서는 바로 저장할 수 없어요." : "사진을 길게 눌러 '사진 앱에 저장'을 고르세요.");
  $("sheet").hidden = false;
}
$("thumb").addEventListener("click", () => last && openSheet());
$("close").addEventListener("click", () => { $("sheet").hidden = true; $("clip").pause(); });
$("save").addEventListener("click", async () => {
  try { await navigator.share({ files: [last.file] }); $("sheet").hidden = true; } catch {}
});

// ---- 시작 전 확인 ----
updateControls();
if (!renderer) {
  showGate("이 브라우저는 지원하지 않아요. 아이폰 Safari 최신 버전에서 열어 주세요.", false);
} else if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
  showGate("카메라를 쓰려면 https 주소로 열어야 해요. 받은 파일 말고 링크로 열어 주세요.", false);
}
