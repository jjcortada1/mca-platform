'use client';

import { FlaskConical } from 'lucide-react';

/**
 * A permanent, unmissable marker that the screen is showing fake data.
 *
 * The failure mode this prevents is quoting a demo number to a real
 * person, so it sits above everything and does not dismiss.
 */
export function DemoBanner() {
  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-amber-500 text-amber-950 px-3 py-1.5 text-[12px] font-semibold">
      <FlaskConical className="h-3.5 w-3.5" />
      Demo mode — everything on screen is sample data. Your real company is untouched.
    </div>
  );
}
