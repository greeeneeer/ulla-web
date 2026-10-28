// 카메라 열기와 확대.
// 후면 0.5는 초광각까지 묶인 카메라(트리플·듀얼 광각)의 렌즈 확대로 한다.
// Safari가 렌즈 확대를 주지 않으면 초광각 카메라를 따로 연다.

export class Camera {
  video = Object.assign(document.createElement("video"), { playsInline: true, muted: true });
  stream = null;
  facing = "user";        // "user" 전면 | "environment" 후면
  mode = "photo";         // "photo" | "video" (동영상은 소리도 받는다)
  lens = "wide";          // 렌즈 확대를 못 쓸 때 "ultra"면 초광각 카메라
  digitalZoom = 1;        // 1~5, 가운데를 잘라 키운다
  hwZoom = null;          // 렌즈 확대 범위 {min, max}. 0.5까지 되면 렌즈가 알아서 바뀐다
  hwValue = 1;            // 지금 렌즈 확대 값 (화면 배율과 같음)
  ultraWideId = null;     // Safari가 알려 주는 후면 초광각 카메라
  multiCamId = null;      // 초광각까지 묶인 후면 카메라

  constructor() { this.video.setAttribute("playsinline", ""); }

  get back() { return this.facing === "environment"; }

  async open() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    // 동영상은 긴 변 1920으로 가볍게, 사진은 가장 크게 받는다.
    const size = this.mode === "photo"
      ? { width: { ideal: 4032 }, height: { ideal: 3024 } }
      : { width: { ideal: 1920 }, height: { ideal: 1440 } };
    const pick = this.back && this.lens === "ultra" && this.ultraWideId ? { deviceId: { exact: this.ultraWideId } }
      : this.back && this.multiCamId ? { deviceId: { exact: this.multiCamId } }
      : { facingMode: this.facing };
    const audio = this.mode === "video";
    const request = (withAudio, which) => navigator.mediaDevices.getUserMedia({
      audio: withAudio, video: { ...which, ...size, aspectRatio: { ideal: 4 / 3 } },
    });
    this.stream = await request(audio, pick)
      // 고른 카메라가 안 열리거나 마이크를 거절했으면 기본 카메라로, 그래도 안 되면 소리 없이 다시 연다.
      .catch(() => request(audio, { facingMode: this.facing }))
      .catch((e) => { if (!audio) throw e; return request(false, { facingMode: this.facing }); });
    this.video.srcObject = new MediaStream(this.stream.getVideoTracks());
    await this.video.play();

    const knewMultiCam = !!this.multiCamId;
    await this.findCameras();
    // 처음 후면을 열 때는 묶인 카메라를 아직 몰랐으니, 찾았으면 그걸로 다시 연다.
    if (this.back && !knewMultiCam && this.multiCamId && this.lens !== "ultra") return this.open();
    this.setupHwZoom();
  }

  async flip() {
    const before = this.facing;
    this.facing = before === "user" ? "environment" : "user";
    this.lens = "wide"; this.digitalZoom = 1;
    try { await this.open(); } catch { this.facing = before; await this.open().catch(() => {}); }
  }

  /// 후면 카메라 목록에서 초광각과, 초광각까지 묶인 카메라를 찾는다 (권한을 받은 뒤에야 이름이 보인다).
  async findCameras() {
    try {
      const cams = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === "videoinput" && !/front|전면/i.test(d.label));
      const find = (re) => (cams.find((d) => re.test(d.label)) || {}).deviceId || null;
      this.ultraWideId = find(/ultra|울트라|초광각/i);
      this.multiCamId = find(/triple|트리플/i) || find(/dual wide|듀얼 광각|듀얼 와이드/i);
    } catch {}
  }

  /// 카메라가 렌즈 확대를 지원하면 그걸 쓴다.
  setupHwZoom() {
    this.hwZoom = null; this.hwValue = 1;
    const track = this.stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    if (!this.back || this.lens === "ultra" || !caps.zoom || !(caps.zoom.max > caps.zoom.min)) return;
    // 렌즈 확대가 0.5까지 안 내려가면 초광각 카메라를 따로 여는 쪽을 쓴다.
    if (caps.zoom.min > 0.55 && this.ultraWideId) return;
    this.hwZoom = { min: caps.zoom.min, max: Math.min(caps.zoom.max, 10) };
    this.applyHwZoom(1);
  }

  applyHwZoom(v) {
    this.hwValue = Math.min(this.hwZoom.max, Math.max(this.hwZoom.min, v));
    this.stream.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: this.hwValue }] }).catch(() => {});
  }

  /// 확대 버튼에 띄울 배율들.
  get presets() {
    if (this.hwZoom) return [0.5, 1, 2, 3].filter((p) => p >= this.hwZoom.min - 0.01 && p <= Math.max(2, this.hwZoom.max) + 0.01);
    return this.back && this.ultraWideId ? [0.5, 1, 2] : [1, 2];
  }

  /// 화면에 보이는 배율.
  get zoom() {
    return (this.hwZoom ? this.hwValue : this.lens === "ultra" ? 0.5 : 1) * this.digitalZoom;
  }

  /// 화면 배율 z로 확대한다. 렌즈를 바꾸려면 카메라를 다시 열어야 해서 canReopen이 false면 렌즈는 그대로 둔다.
  async setZoom(z, canReopen) {
    if (this.hwZoom) {
      // 렌즈로 되는 만큼 확대하고, 그 위는 가운데를 잘라 키운다.
      this.applyHwZoom(z);
      this.digitalZoom = Math.min(5, Math.max(1, z / this.hwValue));
      return;
    }
    const wantUltra = z < 1 && this.ultraWideId && this.back;
    const nextLens = wantUltra ? "ultra" : "wide";
    this.digitalZoom = Math.min(5, Math.max(1, wantUltra ? z / 0.5 : z));
    if (nextLens !== this.lens) {
      this.lens = nextLens;
      if (canReopen) await this.open().catch(() => {});
    }
  }

  /// 두 손가락 확대: 시작할 때의 배율에 손가락 사이 거리 비율을 곱한다.
  pinchStart() { this.pinchBase = this.hwZoom ? this.zoom : this.digitalZoom; }
  pinch(ratio) {
    const z = this.pinchBase * ratio;
    if (this.hwZoom) return this.setZoom(Math.min(this.hwZoom.max * 5, Math.max(this.hwZoom.min, z)), false);
    this.digitalZoom = Math.min(5, Math.max(1, z));
  }
}
