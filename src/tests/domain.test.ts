import { describe, expect, it } from 'vitest';
import { estimateDevice, resolveBaselineScenario, summarizeScenario, validateDevice } from '../domain';
import type { EnergyDocument, EnergyScenario } from '../types';

describe('energy domain', () => {
  it('calculates kWh and cost from watts, hours, days and price', () => {
    const result = estimateDevice({ id: 'a', name: '空调', watts: 1000, dailyHours: 2 }, 30, 0.5);
    expect(result).toEqual({ dailyKwh: 2, monthlyKwh: 60, monthlyCost: 30 });
  });

  it('keeps device shares explainable and sums to 100%', () => {
    const scenario: EnergyScenario = { id: 's', name: 'test', pricePerKwh: 1, daysPerMonth: 30, createdAt: '', devices: [
      { id: 'a', name: 'a', watts: 100, dailyHours: 1 }, { id: 'b', name: 'b', watts: 300, dailyHours: 1 },
    ] };
    const summary = summarizeScenario(scenario);
    expect(summary.total.monthlyKwh).toBe(12);
    expect(summary.devices.map((device) => device.share)).toEqual([0.25, 0.75]);
  });

  it('rejects negative power and more than 24 hours', () => {
    expect(validateDevice({ name: 'x', watts: -1, dailyHours: 1 })).toBe('功率不能为负数');
    expect(validateDevice({ name: 'x', watts: 1, dailyHours: 24.1 })).toBe('每日使用时间不能超过 24 小时');
  });
});

describe('resolveBaselineScenario', () => {
  const make = (id: string, createdAt: string): EnergyScenario => ({ id, name: id, pricePerKwh: 1, daysPerMonth: 30, createdAt, devices: [{ id: `${id}-d`, name: 'd', watts: 100, dailyHours: 1 }] });
  const a = make('a', '2026-01-01T00:00:00.000Z');
  const b = make('b', '2026-02-01T00:00:00.000Z');
  const c = make('c', '2026-03-01T00:00:00.000Z');
  const doc = (scenarios: EnergyScenario[], activeScenarioId: string, baselineScenarioId: string | null): EnergyDocument => ({ version: 1, scenarios, activeScenarioId, baselineScenarioId });

  it('returns null when no other scenario exists', () => {
    expect(resolveBaselineScenario(doc([a], 'a', null))).toBeNull();
  });

  it('honours the pinned baseline when it exists and is not active', () => {
    expect(resolveBaselineScenario(doc([a, b, c], 'a', 'c'))?.id).toBe('c');
  });

  it('falls back to the oldest other scenario regardless of list order', () => {
    expect(resolveBaselineScenario(doc([a, b, c], 'c', null))?.id).toBe('a');
    expect(resolveBaselineScenario(doc([c, b, a], 'c', null))?.id).toBe('a');
    expect(resolveBaselineScenario(doc([b, a, c], 'c', null))?.id).toBe('a');
  });

  it('ignores a pinned baseline that is dangling or is the active scenario', () => {
    expect(resolveBaselineScenario(doc([a, b], 'b', 'ghost'))?.id).toBe('a');
    expect(resolveBaselineScenario(doc([a, b], 'b', 'b'))?.id).toBe('a');
  });
});
