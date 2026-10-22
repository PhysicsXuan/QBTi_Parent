(function(){
  'use strict';
  const canvas = document.getElementById('quantumBg');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  if(!ctx) return;

  let W = 0, H = 0, DPR = 1;
  let raf = 0, t0 = performance.now();
  let bg = null;
  let reduced = false;
  try { reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e){}

  let seed = 20261022;
  function rnd(){ seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

  const stars = [];
  for(let i = 0; i < 150; i++){
    stars.push({ x: rnd(), y: rnd(), r: .35 + rnd() * 1.45, a: .12 + rnd() * .5, p: rnd() * 6.28, s: .35 + rnd() * 1.2 });
  }
  const dust = [];
  for(let i = 0; i < 46; i++){
    dust.push({ x: rnd(), y: rnd(), r: .5 + rnd() * 1.7, p: rnd() * 6.28, s: .08 + rnd() * .18, c: rnd() > .55 ? '255,175,110' : '120,165,255' });
  }

  function resize(){
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * DPR));
    canvas.height = Math.max(1, Math.round(H * DPR));
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#050714');
    bg.addColorStop(.42, '#080b1d');
    bg.addColorStop(.74, '#0b0a18');
    bg.addColorStop(1, '#03040b');
  }

  function orb(x, y, r, color, alpha, t){
    const pulse = 1 + Math.sin(t * .55 + x * .01) * .035;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * pulse);
    g.addColorStop(0, 'rgba(' + color + ',' + alpha + ')');
    g.addColorStop(.32, 'rgba(' + color + ',' + (alpha * .34) + ')');
    g.addColorStop(.67, 'rgba(' + color + ',' + (alpha * .08) + ')');
    g.addColorStop(1, 'rgba(' + color + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  function ring(cx, cy, rx, ry, rot, color, alpha, t, phase){
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot + Math.sin(t * .12 + phase) * .04);
    ctx.strokeStyle = 'rgba(' + color + ',' + alpha + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(' + color + ',' + (alpha * .45) + ')';
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * .72, ry * .72, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function frame(now){
    if(!W || !H) return;
    const t = (now - t0) / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    /* stars */
    for(const s of stars){
      const a = s.a * (.55 + .45 * Math.sin(t * s.s + s.p));
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = s.r > 1.2 ? '#E7F4FF' : '#B4C8EE';
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* big slow quantum clouds */
    ctx.globalCompositeOperation = 'lighter';
    const ox1 = W * (.76 + Math.sin(t * .07) * .025);
    const oy1 = H * (.22 + Math.cos(t * .06) * .03);
    orb(ox1, oy1, Math.max(W, H) * .34, '255,150,90', .17, t);
    orb(ox1, oy1, Math.max(W, H) * .12, '255,190,130', .12, t);
    const ox2 = W * (.18 + Math.cos(t * .055) * .03);
    const oy2 = H * (.78 + Math.sin(t * .05) * .025);
    orb(ox2, oy2, Math.max(W, H) * .30, '110,145,255', .14, t);
    const ox3 = W * (.56 + Math.sin(t * .04 + 2) * .03);
    const oy3 = H * (.50 + Math.cos(t * .045) * .03);
    orb(ox3, oy3, Math.max(W, H) * .24, '175,90,255', .09, t);
    ctx.globalCompositeOperation = 'source-over';

    /* large orbits */
    ring(ox1, oy1, Math.min(W, H) * .34, Math.min(W, H) * .12, -.42, '255,180,120', .14, t, 0);
    ring(ox2, oy2, Math.min(W, H) * .31, Math.min(W, H) * .10, .55, '130,175,255', .12, t, 1.7);
    ring(ox3, oy3, Math.min(W, H) * .24, Math.min(W, H) * .08, -.15, '200,130,255', .09, t, 3.4);

    /* central faint quantum sphere */
    ctx.globalCompositeOperation = 'lighter';
    const cx = W * .52, cy = H * .44;
    const cr = Math.min(W, H) * .18;
    orb(cx, cy, cr * 1.7, '255,175,110', .055, t * .7);
    ctx.strokeStyle = 'rgba(255,205,160,.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, cr * .74, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    /* drifting quantum dust */
    ctx.globalCompositeOperation = 'lighter';
    for(const d of dust){
      const x = (d.x * W + Math.sin(t * d.s + d.p) * 34 + W) % W;
      const y = (d.y * H + Math.cos(t * d.s * .7 + d.p) * 22 + H) % H;
      const a = .15 + .28 * Math.abs(Math.sin(t * .7 + d.p));
      ctx.fillStyle = 'rgba(' + d.c + ',' + a + ')';
      ctx.beginPath();
      ctx.arc(x, y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    /* soft wave function at bottom */
    ctx.save();
    ctx.globalAlpha = .16;
    for(let k = 0; k < 3; k++){
      ctx.strokeStyle = k === 0 ? 'rgba(255,165,100,.5)' : k === 1 ? 'rgba(120,165,255,.45)' : 'rgba(185,120,255,.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for(let x = 0; x <= W; x += 8){
        const y = H * .82 + k * 18 + Math.sin(x * .008 + t * (.25 + k * .07) + k * 2) * (16 + k * 4) + Math.sin(x * .002 - t * .12) * 12;
        if(x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    if(!reduced) raf = requestAnimationFrame(frame);
  }

  function start(){
    resize();
    if(reduced){ frame(performance.now()); return; }
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => {
    resize();
    if(reduced) frame(performance.now());
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if(document.hidden){
      cancelAnimationFrame(raf); raf = 0;
    } else if(!reduced && !raf){
      t0 = performance.now() - 5000;
      raf = requestAnimationFrame(frame);
    }
  });

  start();
})();
