"use client";

import { useSyncExternalStore } from "react";
import {
  DENSITY_LABELS,
  PALETTE_LABELS,
  PALETTE_PREVIEW,
  readDensity,
  readPalette,
  saveDensity,
  savePalette,
  subscribeChartPrefs,
  type ChartPalette,
  type DashboardDensity,
} from "@/lib/chart-prefs";

/** Running and climbing in a palette, light half and dark half. */
function Swatches({ palette }: { palette: ChartPalette }) {
  const { light, dark } = PALETTE_PREVIEW[palette];
  return (
    <span aria-hidden="true" className="mt-1 flex gap-1.5">
      {light.map((c, i) => (
        <span key={c} className="relative inline-block h-3 w-6 overflow-hidden rounded-sm ring-1 ring-control">
          {/* Light half and dark half, so both themes are previewed. */}
          <span className="absolute inset-y-0 left-0 w-1/2" style={{ background: c }} />
          <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: dark[i] }} />
        </span>
      ))}
    </span>
  );
}

function Choice<T extends string>({
  name,
  value,
  current,
  title,
  hint,
  onPick,
  children,
}: {
  name: string;
  value: T;
  current: T;
  title: string;
  hint: string;
  onPick: (v: T) => void;
  children?: React.ReactNode;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3">
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        onChange={() => onPick(value)}
        className="mt-0.5 size-5 shrink-0 accent-accent"
      />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-ink-muted">{hint}</span>
        {children}
      </span>
    </label>
  );
}

/** Chart colours and Dashboard density (#61, design-visual V-L1). This device only. */
export function ChartSettings() {
  const palette = useSyncExternalStore(subscribeChartPrefs, readPalette, () => "standard" as const);
  const density = useSyncExternalStore(subscribeChartPrefs, readDensity, () => "summary" as const);

  return (
    <div className="space-y-5">
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-semibold">Chart colours</legend>
        <div className="space-y-2">
          {(Object.keys(PALETTE_LABELS) as ChartPalette[]).map((p) => (
            <Choice key={p} name="chart-palette" value={p} current={palette} onPick={savePalette} {...PALETTE_LABELS[p]}>
              <Swatches palette={p} />
            </Choice>
          ))}
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-semibold">Dashboard on a phone</legend>
        <div className="space-y-2">
          {(Object.keys(DENSITY_LABELS) as DashboardDensity[]).map((d) => (
            <Choice key={d} name="dashboard-density" value={d} current={density} onPick={saveDensity} {...DENSITY_LABELS[d]} />
          ))}
        </div>
      </fieldset>
      <p className="text-meta text-ink-muted">Saved on this device only.</p>
    </div>
  );
}
