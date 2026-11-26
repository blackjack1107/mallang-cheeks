// 샘플 그림: 코드로 직접 그린 통통한 물범 (외부 이미지 없음)
window.drawSample = function drawSample() {
  const S = 800;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');

  // 바닥 그림자
  c.fillStyle = 'rgba(35,32,43,.14)';
  c.beginPath(); c.ellipse(400, 715, 250, 26, 0, 0, Math.PI * 2); c.fill();

  // 지느러미
  const flipper = (x, rot) => {
    c.save(); c.translate(x, 600); c.rotate(rot);
    c.fillStyle = '#aab6c8';
    c.beginPath(); c.ellipse(0, 0, 78, 36, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  };
  flipper(120, -0.55); flipper(680, 0.55);

  // 몸통
  const body = c.createRadialGradient(340, 300, 40, 400, 430, 360);
  body.addColorStop(0, '#f7f9fc');
  body.addColorStop(0.6, '#dfe6ef');
  body.addColorStop(1, '#bcc8d8');
  c.fillStyle = body;
  c.beginPath();
  c.moveTo(400, 150);
  c.bezierCurveTo(610, 150, 705, 300, 705, 460);
  c.bezierCurveTo(705, 640, 570, 705, 400, 705);
  c.bezierCurveTo(230, 705, 95, 640, 95, 460);
  c.bezierCurveTo(95, 300, 190, 150, 400, 150);
  c.fill();

  // 이마 얼룩
  c.fillStyle = 'rgba(120,135,160,.38)';
  [[330, 215, 34, 20, -0.3], [420, 195, 26, 15, 0.2], [485, 232, 30, 17, 0.4], [385, 250, 16, 10, 0]].forEach(([x, y, rx, ry, r]) => {
    c.beginPath(); c.ellipse(x, y, rx, ry, r, 0, Math.PI * 2); c.fill();
  });

  // 볼 홍조
  const blush = (x) => {
    const g = c.createRadialGradient(x, 500, 4, x, 500, 78);
    g.addColorStop(0, 'rgba(255,170,130,.6)');
    g.addColorStop(1, 'rgba(255,170,130,0)');
    c.fillStyle = g;
    c.beginPath(); c.ellipse(x, 500, 80, 62, 0, 0, Math.PI * 2); c.fill();
  };
  blush(205); blush(595);

  // 눈
  const eye = (x) => {
    c.fillStyle = '#23202b';
    c.beginPath(); c.arc(x, 395, 30, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(x - 10, 384, 10, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + 9, 405, 4.5, 0, Math.PI * 2); c.fill();
  };
  eye(292); eye(508);

  // 눈썹 점
  c.fillStyle = '#7d8aa0';
  c.beginPath(); c.ellipse(280, 335, 13, 8, -0.3, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(520, 335, 13, 8, 0.3, 0, Math.PI * 2); c.fill();

  // 주둥이
  c.fillStyle = '#fbfcfe';
  c.beginPath(); c.ellipse(358, 488, 52, 44, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(442, 488, 52, 44, 0, 0, Math.PI * 2); c.fill();

  // 코
  c.fillStyle = '#23202b';
  c.beginPath();
  c.moveTo(376, 445); c.quadraticCurveTo(400, 436, 424, 445);
  c.quadraticCurveTo(418, 470, 400, 474); c.quadraticCurveTo(382, 470, 376, 445);
  c.fill();

  // 입
  c.strokeStyle = '#23202b'; c.lineWidth = 6; c.lineCap = 'round';
  c.beginPath(); c.moveTo(400, 474); c.lineTo(400, 496); c.stroke();
  c.beginPath(); c.moveTo(372, 500); c.quadraticCurveTo(400, 524, 428, 500); c.stroke();

  // 수염 점과 수염
  c.fillStyle = '#8a95a8';
  [[335, 478], [350, 496], [330, 500], [465, 478], [450, 496], [470, 500]].forEach(([x, y]) => {
    c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill();
  });
  c.strokeStyle = 'rgba(90,100,120,.55)'; c.lineWidth = 3;
  [[-1, 480, -18], [-1, 498, 6], [1, 480, -18], [1, 498, 6]].forEach(([dir, y, dy]) => {
    const x0 = 400 + dir * 90;
    c.beginPath(); c.moveTo(x0, y); c.quadraticCurveTo(x0 + dir * 60, y + dy * 0.4, x0 + dir * 120, y + dy); c.stroke();
  });

  return {
    canvas: cv,
    circles: [{ x: 215, y: 505, r: 150 }, { x: 585, y: 505, r: 150 }],
  };
};
