'use client';
/**
 * DateRangeFilter — the standard date filter used on every list page
 * (Submissions, Active Deals, …). One select with the shared presets;
 * picking "Specific date" or "Custom range" reveals the date input(s)
 * inline. Purely controlled — the page owns the value and does the
 * filtering with inDateRange()/resolveDateRange().
 */
import { CalendarDays } from 'lucide-react';
import { DATE_PRESET_OPTIONS, type DateRangeValue, type DatePreset } from '@/lib/date-range';

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div className="relative">
        <CalendarDays className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <select
          value={value.preset}
          onChange={(e) => onChange({ ...value, preset: e.target.value as DatePreset })}
          className="h-9 rounded-md border border-input bg-card pl-7 pr-2 text-sm"
          title="Filter by date"
        >
          {DATE_PRESET_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {value.preset === 'on_date' && (
        <input
          type="date"
          value={value.date ?? ''}
          onChange={(e) => onChange({ ...value, date: e.target.value })}
          className="h-9 rounded-md border border-input bg-card px-2 text-sm"
          title="Pick the date"
        />
      )}
      {value.preset === 'custom' && (
        <>
          <input
            type="date"
            value={value.from ?? ''}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            title="From (inclusive)"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={value.to ?? ''}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            title="To (inclusive)"
          />
        </>
      )}
    </div>
  );
}
