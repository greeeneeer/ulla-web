// 폰을 얼마나 돌려 들었는지 알아낸다 (화면 회전 잠금 중에도 가로 사진·동영상을 가로로 저장하려고).
// 중력 방향으로 판단한다. 센서 부호가 기기마다 반대일 수 있어서, 세로로 들었을 때의 y 부호로 맞춘다.

let upSign = /iPhone|iPad|iPod/.test(navigator.userAgent) ? -1 : 1;
let upCalibrated = false;
let deviceAngle = 0; // 0 세로, 90 위쪽이 왼쪽, 270 위쪽이 오른쪽, 180 거꾸로

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null) return;
  const g = 9.81, x = a.x, y = a.y;
  // 처음 세로로 똑바로 든 순간에 한 번만 맞춘다 (거꾸로 든 걸 기준으로 착각하지 않게).
  if (!upCalibrated && Math.abs(y) > 0.75 * g && Math.abs(x) < 0.35 * g && screenAngle() === 0) {
    upSign = Math.sign(y); upCalibrated = true;
  }
  if (Math.abs(x) > 0.6 * g && Math.abs(x) > Math.abs(y)) deviceAngle = Math.sign(x) === upSign ? 90 : 270;
  else if (Math.abs(y) > 0.6 * g) deviceAngle = Math.sign(y) === upSign ? 0 : 180;
}

function screenAngle() {
  const a = screen.orientation?.angle ?? window.orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

/// 센서 듣기를 시작한다. iOS는 센서 권한을 버튼 누를 때 바로 물어야 해서 클릭 안에서 부른다.
export function startMotion() {
  const listen = () => window.addEventListener("devicemotion", onMotion);
  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    DeviceMotionEvent.requestPermission().then((s) => s === "granted" && listen()).catch(() => {});
  } else {
    listen();
  }
}

/// 화면에 보이는 그림을 시계 반대 방향으로 몇 도 돌려 저장해야 하는지 (0, 90, 180, 270).
export function saveRotation() {
  return (deviceAngle - screenAngle() + 360) % 360;
}
