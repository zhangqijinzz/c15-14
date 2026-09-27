import { describe, expect, it } from 'vitest';
import { estimateDevice, pickDefaultComparisonId, resolveComparisonId, scenarioMonthlyKwh, summarizeScenario, validateDevice } from '../domain';
import type { EnergyScenario } from '../types';

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

  it('sums a scenario monthly kWh with the shared comparison formula', () => {
    const scenario: EnergyScenario = { id: 's', name: 'test', pricePerKwh: 1, daysPerMonth: 30, createdAt: '', devices: [
      { id: 'a', name: 'a', watts: 1000, dailyHours: 2 },
    ] };
    expect(scenarioMonthlyKwh(scenario)).toBe(60);
  });

  it('picks the earliest created other scenario as stable default regardless of list order', () => {
    const older: EnergyScenario = { id: 'old', name: 'old', pricePerKwh: 1, daysPerMonth: 30, createdAt: '2026-01-01T00:00:00.000Z', devices: [] };
    const newer: EnergyScenario = { id: 'new', name: 'new', pricePerKwh: 1, daysPerMonth: 30, createdAt: '2026-02-01T00:00:00.000Z', devices: [] };
    expect(pickDefaultComparisonId([newer, older], 'new')).toBe('old');
    expect(pickDefaultComparisonId([older, newer], 'new')).toBe('old');
    expect(pickDefaultComparisonId([older], 'old')).toBeNull();
  });

  it('resolves the explicit baseline and falls back when it was deleted or points at itself', () => {
    const a: EnergyScenario = { id: 'a', name: 'a', pricePerKwh: 1, daysPerMonth: 30, createdAt: '2026-01-01T00:00:00.000Z', devices: [] };
    const b: EnergyScenario = { id: 'b', name: 'b', pricePerKwh: 1, daysPerMonth: 30, createdAt: '2026-02-01T00:00:00.000Z', devices: [] };
    expect(resolveComparisonId([a, b], 'b', 'a')).toBe('a');
    // 被指定的方案已删除 → 回退默认
    expect(resolveComparisonId([a, b], 'b', 'gone')).toBe('a');
    // 被指定的是当前方案自身 → 回退默认
    expect(resolveComparisonId([a, b], 'b', 'b')).toBe('a');
    // 未指定 → 稳定默认
    expect(resolveComparisonId([a, b], 'b', null)).toBe('a');
    // 只有一个方案 → 不产生对比
    expect(resolveComparisonId([b], 'b', null)).toBeNull();
  });
});
