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
  celebrationSoundEnabled: boolean;
  celebrationMessage: string;
};

interface PreviewDetail {
  dealName?: string;
  previewOverride?: Partial<CelebrationSettings>;
}

const DEFAULT_SETTINGS: CelebrationSettings = {
  celebrationEnabled: true,
  confettiEnabled: true,
  celebrationSoundEnabled: false,
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
          celebrationSoundEnabled: j.company.celebrationSoundEnabled ?? DEFAULT_SETTINGS.celebrationSoundEnabled,
          celebrationMessage: j.company.celebrationMessage ?? DEFAULT_SETTINGS.celebrationMessage,
        });
      })
      .catch(() => {});
  }, []);

  // Listen for funded-deal events.
  useEffect(() => {
    function onEvent(e: Event) {
      const detail = (e as CustomEvent<PreviewDetail>).detail ?? {};
      const effective: CelebrationSettings = {
        ...settings,
        ...(detail.previewOverride ?? {}),
      };
      if (!effective.celebrationEnabled) return;
      // Intentionally ignore detail.dealName + any rep name — per spec the
      // celebration should NOT show the deal or rep name. The "Funded!"
      // moment is the same for every deal, every time.
      const msg = effective.celebrationMessage || DEFAULT_SETTINGS.celebrationMessage;
      setMessage(msg);
      setShowConfetti(effective.confettiEnabled);
      setVisible(true);
      // Optional gong sound — synthesized inline using Web Audio so there's
      // no asset to ship. ~2s decay with detuned partials for the
      // characteristic shimmer. Skip entirely if the user hasn't opted in.
      if (effective.celebrationSoundEnabled) {
        playFundedChime();
      }
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
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 gap-4">
        {/* Gong animation — hammer swings in from the side, strikes the
            disc, the disc shakes / ripples, then both settle. Pure
            inline SVG + CSS keyframes so there are no asset shipments
            and the animation stays at a stable 60fps. */}
        <div className="relative h-56 w-56 sm:h-72 sm:w-72 animate-gong-fade-in">
          <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full">
            {/* Gong disc — concentric circles with a brushed-metal radial
                gradient so it reads as bronze without needing an image. */}
            <defs>
              <radialGradient id="gongMetal" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#fcd34d" />
                <stop offset="45%" stopColor="#d97706" />
                <stop offset="85%" stopColor="#92400e" />
                <stop offset="100%" stopColor="#451a03" />
              </radialGradient>
              <radialGradient id="gongInner" cx="50%" cy="50%" r="35%">
                <stop offset="0%" stopColor="#fde68a" />
                <stop offset="100%" stopColor="#b45309" />
              </radialGradient>
            </defs>
            {/* Hanging rope */}
            <line x1="100" y1="0" x2="100" y2="20" stroke="#78350f" strokeWidth="2" />
            <line x1="70" y1="20" x2="130" y2="20" stroke="#78350f" strokeWidth="2" />
            {/* The disc — wrapped in a group so we can shake it on impact */}
            <g className="gong-disc">
              <circle cx="100" cy="105" r="85" fill="url(#gongMetal)" stroke="#451a03" strokeWidth="3" />
              <circle cx="100" cy="105" r="65" fill="none" stroke="#78350f" strokeWidth="1.5" opacity="0.6" />
              <circle cx="100" cy="105" r="45" fill="none" stroke="#78350f" strokeWidth="1.5" opacity="0.5" />
              <circle cx="100" cy="105" r="25" fill="url(#gongInner)" stroke="#451a03" strokeWidth="2" />
            </g>
            {/* Hammer — swings in from the right, strikes the disc center,
                bounces back. Pivots around its handle end. */}
            <g className="gong-hammer">
              <line x1="0" y1="0" x2="60" y2="0" stroke="#451a03" strokeWidth="5" strokeLinecap="round" />
              <ellipse cx="62" cy="0" rx="14" ry="10" fill="#451a03" stroke="#1c1917" strokeWidth="1.5" />
              <ellipse cx="62" cy="-3" rx="11" ry="6" fill="#78716c" opacity="0.4" />
            </g>
            {/* Impact ripples — three expanding rings that fade out as
                they grow, suggesting the gong's resonance. */}
            <g className="gong-ripples">
              <circle cx="100" cy="105" r="85" fill="none" stroke="#fbbf24" strokeWidth="2" className="gong-ripple gong-ripple-1" />
              <circle cx="100" cy="105" r="85" fill="none" stroke="#fbbf24" strokeWidth="2" className="gong-ripple gong-ripple-2" />
              <circle cx="100" cy="105" r="85" fill="none" stroke="#fbbf24" strokeWidth="2" className="gong-ripple gong-ripple-3" />
            </g>
          </svg>
        </div>
        <div className="text-center animate-celebration-message">
          <div
            // Big, bold, with a subtle gradient + drop shadow so it pops on
            // any background. NO names — message is the only text.
            className="font-extrabold tracking-tight text-5xl sm:text-6xl md:text-7xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 bg-clip-text text-transparent"
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
        /* Whole gong fades in from a slight drop. */
        @keyframes gongFadeIn {
          0%   { opacity: 0; transform: translateY(-20px); }
          15%  { opacity: 1; transform: translateY(0); }
          85%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(0); }
        }
        :global(.animate-gong-fade-in) {
          animation: gongFadeIn 3.2s ease-out forwards;
        }
        /* Hammer swing — comes from the right at a high arc, strikes the
            center of the disc, bounces back. Pivot is the handle end at
            the right edge. */
        @keyframes gongHammerSwing {
          0%   { transform: translate(165px, 50px) rotate(60deg); }
          22%  { transform: translate(165px, 50px) rotate(60deg); }
          32%  { transform: translate(165px, 50px) rotate(-30deg); }  /* impact */
          40%  { transform: translate(165px, 50px) rotate(-10deg); }  /* bounce */
          48%  { transform: translate(165px, 50px) rotate(-20deg); }
          100% { transform: translate(165px, 50px) rotate(-15deg); }
        }
        :global(.gong-hammer) {
          transform-origin: 0 0;
          transform-box: fill-box;
          animation: gongHammerSwing 3.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        /* Disc shake on impact — only the disc, not the rope. Sharp
            initial jolt, dampens quickly. Timed to coincide with the
            hammer's strike at 32% of the timeline. */
        @keyframes gongShake {
          0%, 32% { transform: translate(0, 0); }
          34%     { transform: translate(-4px, 0); }
          36%     { transform: translate(4px, 0); }
          38%     { transform: translate(-3px, 0); }
          40%     { transform: translate(3px, 0); }
          42%     { transform: translate(-2px, 0); }
          44%     { transform: translate(2px, 0); }
          46%     { transform: translate(-1px, 0); }
          48%     { transform: translate(1px, 0); }
          50%, 100% { transform: translate(0, 0); }
        }
        :global(.gong-disc) {
          transform-origin: 100px 105px;
          transform-box: fill-box;
          animation: gongShake 3.2s ease-out forwards;
        }
        /* Resonance ripples — three rings expanding outward at staggered
            delays, fading as they grow. Hidden until the strike at 32%. */
        @keyframes gongRipple {
          0%, 32% { opacity: 0; transform: scale(1); }
          34%     { opacity: 0.7; transform: scale(1); }
          100%    { opacity: 0; transform: scale(1.6); }
        }
        :global(.gong-ripple) {
          transform-origin: 100px 105px;
          transform-box: fill-box;
          animation: gongRipple 3.2s ease-out forwards;
        }
        :global(.gong-ripple-2) { animation-delay: 0.1s; }
        :global(.gong-ripple-3) { animation-delay: 0.2s; }
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

/**
 * Synthesized "funded" chime using the Web Audio API.
 *
 * Plays a bright two-note chord (C5 + G5) with a quick attack and a tail
 * that decays over ~600ms. We don't ship an audio asset — building it
 * inline keeps the bundle small and means the sound is consistent across
 * every browser without worrying about codec support.
 *
 * Web Audio context is created lazily inside the function: browsers
 * require a user gesture (click) before allowing audio, and this is
 * always called from a click-triggered code path (mark as funded), so
 * we're inside the permitted window.
 */
function playFundedChime() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const now = ctx.currentTime;

    // Gong: low fundamental + several inharmonic partials with slight
    // detuning to produce the characteristic shimmering, slowly-decaying
    // bronze resonance. Pure-sine sums avoid the harshness of square or
    // sawtooth waves at this kind of volume. Total runtime ~2s with a
    // gentle exponential fade.
    //
    // Why these ratios? Real gongs have a strong fundamental and many
    // non-harmonic overtones (true harmonics give bell tones; gongs are
    // intentionally "noisy" between partials). 1, 2.4, 4.1, 5.9 is a
    // reasonable simulation that reads as gong-like to most ears.
    const fundamental = 110; // A2 — low and resonant
    const partials = [
      { mult: 1.0,  gain: 0.30 },
      { mult: 2.41, gain: 0.18 },
      { mult: 4.12, gain: 0.12 },
      { mult: 5.93, gain: 0.08 },
      { mult: 7.65, gain: 0.05 },
    ];
    for (const p of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = fundamental * p.mult;
      // Very fast attack (sharp strike), slow exponential decay (~2.4s
      // for the lowest partials). Higher partials decay faster, which is
      // physically what happens in a real gong.
      const decayTime = 2.4 / Math.sqrt(p.mult);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(p.gain, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decayTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + decayTime + 0.05);
    }
    // Auto-close once the loudest partial has fully decayed.
    setTimeout(() => { ctx.close().catch(() => {}); }, 3000);
  } catch {
    // Audio is purely decorative — never let an audio failure block the
    // celebration overlay from rendering.
  }
}
