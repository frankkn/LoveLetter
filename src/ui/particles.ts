/* ── Particle System ─────────────────────────────────────────────────── */
// 主選單背景飄浮的金色塵粒（♥ ✦ ✉ ❧ 與小圓點），純裝飾、無外部相依。
export function initParticles() {
  const canvas = document.getElementById('particle-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let W = 0, H = 0;

  function resize() {
    W = canvas!.width  = window.innerWidth;
    H = canvas!.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const COLORS  = ['#c9a227', '#f5d07a', '#e8c07a', '#b08820'];
  const SYMBOLS = ['♥', '✦', '✉', '❧', '·', '·', '·']; // weighted toward plain dots

  interface Mote {
    x: number; y: number; vx: number; vy: number;
    sym: string; size: number; col: string;
    peak: number; life: number; span: number;
    wobF: number; wobS: number; alpha: number;
  }

  function resetMote(m: Mote, scatter = false) {
    m.x    = Math.random() * W;
    m.y    = scatter ? Math.random() * H : H + 15;
    m.vx   = (Math.random() - 0.5) * 0.30;
    m.vy   = -(Math.random() * 0.40 + 0.12);
    m.sym  = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    m.size = m.sym === '·' ? (Math.random() * 2 + 1.2) : (Math.random() * 6 + 4);
    m.col  = COLORS[Math.floor(Math.random() * COLORS.length)];
    m.peak = Math.random() * 0.25 + 0.05;
    m.life = scatter ? Math.random() * 300 : 0;
    m.span = Math.random() * 260 + 180;
    m.wobF = Math.random() * Math.PI * 2;
    m.wobS = (Math.random() - 0.5) * 0.022;
    m.alpha = 0;
  }

  function makeMote(scatter = false): Mote {
    const m = {} as Mote;
    resetMote(m, scatter);
    return m;
  }

  const COUNT = Math.min(50, Math.floor((window.innerWidth * window.innerHeight) / 18000));
  const motes: Mote[] = Array.from({ length: COUNT }, (_, i) => makeMote(i < COUNT * 0.7));

  function loop() {
    ctx!.clearRect(0, 0, W, H);
    for (const m of motes) {
      m.life++;
      m.wobF += m.wobS;
      m.x    += m.vx + Math.sin(m.wobF) * 0.28;
      m.y    += m.vy;

      const t = m.life / m.span;
      if      (t < 0.12) m.alpha = (t / 0.12) * m.peak;
      else if (t > 0.78) m.alpha = ((1 - t) / 0.22) * m.peak;
      else               m.alpha = m.peak;

      if (m.life >= m.span || m.y < -20) resetMote(m, false);

      ctx!.globalAlpha = m.alpha;
      if (m.sym === '·') {
        ctx!.beginPath();
        ctx!.arc(m.x, m.y, m.size / 2, 0, Math.PI * 2);
        ctx!.fillStyle = m.col;
        ctx!.fill();
      } else {
        ctx!.font = `${m.size}px serif`;
        ctx!.fillStyle = m.col;
        ctx!.textAlign    = 'center';
        ctx!.textBaseline = 'middle';
        ctx!.fillText(m.sym, m.x, m.y);
      }
    }
    ctx!.globalAlpha = 1;
    requestAnimationFrame(loop);
  }
  loop();
}
