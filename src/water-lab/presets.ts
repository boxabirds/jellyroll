/** Starting points for the designer: each is a handful of settings laid over the defaults. */
export const PRESETS: Record<string, Record<string, number | string>> = {
  'Meadow pond': {},
  'Clear tropical': { color: '#27b7c4', absorption: 0.55, scatter: 0.7, clarity: 0.12, shoreFade: 0.15, causticStrength: 1.2 },
  'Murky pond': { color: '#4a7a3a', absorption: 2.6, scatter: 0.9, clarity: 0.05, shoreFade: 0.5, causticStrength: 0.2 },
  'Icy melt': { color: '#6fb5e8', absorption: 0.8, scatter: 0.8, rippleStrength: 1.1, foamAmount: 0.6, dropletTint: '#e8f6ff' },
  'Stormy': { waveHeight: 0.22, waveChop: 1, rippleStrength: 2.6, foamAmount: 1.6, crestFoam: 1.4, sprayAmount: 1.6, launchSpeed: 9 },
};
