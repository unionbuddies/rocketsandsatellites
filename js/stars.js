// Lightweight twinkling / drifting starfield drawn on a full-screen canvas.
(function () {
  const canvas = document.getElementById("stars");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let stars = [];
  let w, h, dpr;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = Math.floor(innerWidth * dpr);
    h = canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    const count = Math.min(260, Math.floor((innerWidth * innerHeight) / 6000));
    stars = new Array(count).fill(0).map(() => ({
      x: Math.random() * w,
      y: Math.random() * h,
      z: Math.random() * 1.4 + 0.2,        // depth → size & speed
      tw: Math.random() * Math.PI * 2,     // twinkle phase
      tws: Math.random() * 0.02 + 0.005,   // twinkle speed
    }));
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.tw += s.tws;
      s.y += s.z * 0.12 * dpr;             // gentle downward drift
      if (s.y > h) { s.y = 0; s.x = Math.random() * w; }
      const a = 0.4 + Math.abs(Math.sin(s.tw)) * 0.6;
      const r = s.z * dpr;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,232,255,${a})`;
      ctx.fill();
    }
    requestAnimationFrame(frame);
  }

  addEventListener("resize", resize);
  resize();
  frame();
})();
