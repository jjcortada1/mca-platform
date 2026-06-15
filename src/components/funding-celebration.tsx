'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * FundingCelebration
 * ───────────────────
 * A premium funded-deal celebration overlay. Rendered globally; subscribes
 * to the custom DOM event `mca:funded-deal` (dispatched by any page that
 * marks a deal funded). On trigger:
 *   1. Canvas full-screen confetti for ~2.5s — no library; pure RAF.
 *   2. Centered toast with the admin-customizable message that fades in,
 *      lingers for ~2s, then fades out.
 *
 * Settings (per company):
 *   - celebrationEnabled       master kill switch
 *   - confettiEnabled          show/hide the particles
 *   - celebrationMessage       the message text ("Fundeddddd!!!!" default)
 *
 * Events:
 *   window.dispatchEvent(new CustomEvent('mca:funded-deal', { detail: { dealName?, previewOverride? } }))
 *
 *   `previewOverride` is used by the Settings preview button to render
 *   immediately with the in-progress draft, regardless of saved settings.
 *
 * Performance: pointer-events: none on the overlay so the user keeps
 * interacting with the page; we don't pause input during the animation.
 * Confetti uses a single fullscreen canvas + ~140 particles, capped to
 * 60fps. Negligible CPU on modern hardware.
 */

type CelebrationSettings = {
  celebrationEnabled: boolean;
  confettiEnabled: boolean;
  celebrationMessage: string;
};

interface PreviewDetail {
  dealName?: string;
  previewOverride?: Partial<CelebrationSettings>;
}

const DEFAULT_SETTINGS: CelebrationSettings = {
  celebrationEnabled: true,
  confettiEnabled: true,
  celebrationMessage: 'Fundeddddd!!!!',
};

export function FundingCelebration() {
  const [settings, setSettings] = useState<CelebrationSettings>(DEFAULT_SETTINGS);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [showConfetti, setShowConfetti] = useState(false);

  // Load settings once on mount. /api/companies/me returns the current
  // company's branding + celebration prefs (admin route, but the public
  // celebration fields are returned to any authenticated user so reps
  // get the same in-app experience).
  useEffect(() => {
    fetch('/api/companies/me', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (!j?.company) return;
        setSettings({
          celebrationEnabled: j.company.celebrationEnabled ?? DEFAULT_SETTINGS.celebrationEnabled,
          confettiEnabled: j.company.confettiEnabled ?? DEFAULT_SETTINGS.confettiEnabled,
          celebrationMessage: j.company.celebrationMessage ?? DEFAULT_SETTINGS.celebrationMessage,
        });
      })
      .catch(() => {});
  }, []);

  // Listen for funded-deal events.
  useEffect(() => {
    function onEvent(e: Event) {
      const detail = (e as CustomEvent<PreviewDetail>).detail ?? {};
      // Apply preview overrides if provided (used by the Settings preview
      // button to test the in-progress message without saving).
      const effective: CelebrationSettings = {
        ...settings,
        ...(detail.previewOverride ?? {}),
      };
      if (!effective.celebrationEnabled) return;
      const msg = effective.celebrationMessage || DEFAULT_SETTINGS.celebrationMessage;
      setMessage(detail.dealName ? `${msg}\n${detail.dealName}` : msg);
      setShowConfetti(effective.confettiEnabled);
      setVisible(true);
      // Auto-dismiss after the animation completes.
      const t = setTimeout(() => setVisible(false), 3200);
      return () => clearTimeout(t);
    }
    window.addEventListener('mca:funded-deal', onEvent as EventListener);
    return () => window.removeEventListener('mca:funded-deal', onEvent as EventListener);
  }, [settings]);

  if (!visible) return null;

  return (
    <div
      // Overlay sits above all app content but doesn't block clicks. Users
      // can keep working while the celebration plays out.
      className="fixed inset-0 z-[100] pointer-events-none"
      aria-hidden
    >
      {showConfetti && <Confetti />}
      <div className="absolute inset-0 flex items-center justify-center px-6">
        <div className="text-center animate-celebration-message">
          <div
            // Big, bold, with a subtle gradient + drop shadow so it pops on
            // any background. Pre-line preserves the optional "Acme Pizza"
            // second line when a deal name is included.
            className="font-extrabold tracking-tight text-5xl sm:text-6xl md:text-7xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 bg-clip-text text-transparent whitespace-pre-line"
            style={{ textShadow: '0 4px 32px rgba(16, 185, 129, 0.25)' }}
          >
            {message}
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes celebrationMessage {
          0%   { opacity: 0; transform: scale(0.6) translateY(20px); }
          15%  { opacity: 1; transform: scale(1.08) translateY(0); }
          25%  { transform: scale(1) translateY(0); }
          80%  { opacity: 1; transform: scale(1) translateY(0); }
          100% { opacity: 0; transform: scale(0.95) translateY(-10px); }
        }
        .animate-celebration-message {
          animation: celebrationMessage 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>
    </div>
  );
}

/**
 * Confetti canvas.
 * 140 colored rectangles spawn at the top, fall with gravity + jitter,
 * spin around their own axis. No external libraries — keeps the bundle
 * lean. Each particle is independent; the animation ends when all are
 * off-screen (~2.5s).
 */
function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    function size() {
      if (!canvas) return;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx?.scale(dpr, dpr);
    }
    size();
    window.addEventListener('resize', size);

    // Tasteful palette — teal/emerald/amber matches the app accent system.
    // Mixing brand greens with warmer celebration colors prevents the
    // effect from feeling sterile.
    const colors = ['#10b981', '#14b8a6', '#06b6d4', '#fbbf24', '#f97316', '#ec4899', '#a78bfa'];

    type Particle = { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; vrot: number; color: string };
    const W = window.innerWidth;
    const particles: Particle[] = Array.from({ length: 140 }, () => ({
      x: Math.random() * W,
      y: -20 - Math.random() * 200,            // staggered start above viewport
      vx: (Math.random() - 0.5) * 6,
      vy: 2 + Math.random() * 4,
      w: 6 + Math.random() * 6,
      h: 10 + Math.random() * 6,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));

    let raf = 0;
    let frame = 0;
    function tick() {
      const H = window.innerHeight;
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of particles) {
        // Gravity + light air resistance.
        p.vy += 0.12;
        p.vx *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        if (p.y < H + 50) {
          alive++;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      }
      frame++;
      // Stop once everything's off-screen OR after 3s as a safety net.
      if (alive > 0 && frame < 200) {
        raf = requestAnimationFrame(tick);
      }
    }
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}

/**
 * Convenience helper for any caller. Use this instead of dispatching
 * the event manually so the contract stays in one place.
 */
export function triggerFundingCelebration(detail?: PreviewDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('mca:funded-deal', { detail: detail ?? {} }));
}
