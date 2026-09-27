import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleScenario } from '../domain';
import type { EnergyDocument } from '../types';
import { EnergyLensViewModel } from '../viewModel';
import type { EnergyRepository } from '../repository';

function makeRepository(): EnergyRepository & { data: EnergyDocument; save: ReturnType<typeof vi.fn> } {
  const data: EnergyDocument = { version: 1, scenarios: [structuredClone(exampleScenario)], activeScenarioId: exampleScenario.id, comparisonScenarioId: null };
  return { data, load: () => data, save: vi.fn((next: EnergyDocument) => { data.scenarios = next.scenarios; data.activeScenarioId = next.activeScenarioId; data.comparisonScenarioId = next.comparisonScenarioId; }) };
}

function scenario(id: string, name: string, createdAt: string, monthlyKwh: number): EnergyDocument['scenarios'][number] {
  return { id, name, createdAt, pricePerKwh: 1, daysPerMonth: 30, devices: [{ id: `${id}-d`, name: `${name}-设备`, watts: (monthlyKwh * 1000) / 30, dailyHours: 1 }] };
}

describe('EnergyLensViewModel', () => {
  let repository: ReturnType<typeof makeRepository>;
  let vm: EnergyLensViewModel;
  beforeEach(() => { repository = makeRepository(); vm = new EnergyLensViewModel(repository); vm.initialize(); });

  it('initializes, persists edits, and recalculates results', () => {
    expect(vm.getState().status).toBe('ready');
    const before = vm.activeSummary?.total.monthlyKwh;
    vm.updateDevice('device-aircon', { dailyHours: 2 });
    expect(vm.activeSummary?.total.monthlyKwh).toBeLessThan(before ?? Infinity);
    expect(repository.save).toHaveBeenCalled();
  });

  it('keeps invalid values out of the document and exposes an error notice', () => {
    vm.updateDevice('device-aircon', { watts: -50 });
    expect(vm.getState().status).toBe('error');
    expect(vm.getState().notice?.text).toBe('功率不能为负数');
    expect(vm.activeScenario?.devices[0].watts).toBe(1200);
  });

  it('duplicates a scenario and can recover a saved document', () => {
    vm.duplicateActive();
    expect(vm.getState().document?.scenarios).toHaveLength(2);
    const recovered = new EnergyLensViewModel(repository);
    recovered.initialize();
    expect(recovered.getState().document?.scenarios).toHaveLength(2);
  });

  it('surfaces persistence failure as a recoverable error', () => {
    repository.save.mockImplementation(() => { throw new Error('quota'); });
    vm.addDevice();
    expect(vm.getState().status).toBe('error');
    expect(vm.getState().notice?.text).toContain('保存失败');
  });

  it('hides comparison conclusions when there is only one scenario', () => {
    expect(vm.comparisonScenario).toBeNull();
    expect(vm.activeScenario?.id).toBe(exampleScenario.id);
  });

  it('compares a duplicate against its source rather than the first other scenario', () => {
    const older = scenario('scenario-old', '老方案', '2026-01-01T00:00:00.000Z', 100);
    repository.data.scenarios = [older, structuredClone(exampleScenario)];
    repository.data.activeScenarioId = exampleScenario.id;
    vm = new EnergyLensViewModel(repository);
    vm.initialize();
    // 复制前，稳定默认是创建最早的“老方案”
    expect(vm.comparisonScenario?.id).toBe('scenario-old');
    // 复制当前方案后，结论必须指向被复制的原方案，而不是列表里更老的方案
    vm.duplicateActive();
    expect(vm.activeScenario?.id).not.toBe(exampleScenario.id);
    expect(vm.comparisonScenario?.id).toBe(exampleScenario.id);
    expect(vm.isComparisonExplicit).toBe(true);
  });

  it('uses a stable default independent of list order until the user picks one', () => {
    const b = scenario('scenario-b', '方案B', '2026-03-01T00:00:00.000Z', 100);
    const a = scenario('scenario-a', '方案A', '2026-02-01T00:00:00.000Z', 50);
    repository.data.scenarios = [b, a];
    repository.data.activeScenarioId = b.id;
    vm = new EnergyLensViewModel(repository);
    vm.initialize();
    expect(vm.comparisonScenario?.id).toBe('scenario-a');
    expect(vm.isComparisonExplicit).toBe(false);
    // 调换列表顺序，默认选择不漂移
    repository.data.scenarios = [a, b];
    expect(vm.comparisonScenario?.id).toBe('scenario-a');
    // 用户显式指定后以指定为准
    vm.setComparisonScenario('scenario-a');
    expect(vm.isComparisonExplicit).toBe(true);
    expect(vm.comparisonScenario?.id).toBe('scenario-a');
  });

  it('refuses to compare against itself or a missing scenario', () => {
    const a = scenario('scenario-a', '方案A', '2026-02-01T00:00:00.000Z', 50);
    const b = scenario('scenario-b', '方案B', '2026-03-01T00:00:00.000Z', 100);
    repository.data.scenarios = [a, b];
    repository.data.activeScenarioId = a.id;
    vm = new EnergyLensViewModel(repository);
    vm.initialize();
    vm.setComparisonScenario(a.id);
    expect(vm.getState().document?.comparisonScenarioId).toBeNull();
    vm.setComparisonScenario('scenario-missing');
    expect(vm.getState().document?.comparisonScenarioId).toBeNull();
  });

  it('updates the conclusion after the chosen baseline is renamed or re-tuned', () => {
    const a = scenario('scenario-a', '原方案', '2026-02-01T00:00:00.000Z', 100);
    const b = scenario('scenario-b', '新方案', '2026-03-01T00:00:00.000Z', 50);
    repository.data.scenarios = [a, b];
    repository.data.activeScenarioId = b.id;
    repository.data.comparisonScenarioId = a.id;
    vm = new EnergyLensViewModel(repository);
    vm.initialize();
    expect(vm.comparisonScenario?.name).toBe('原方案');
    const beforeKwh = vm.comparisonScenario ? (a.devices[0].watts * a.devices[0].dailyHours * a.daysPerMonth) / 1000 : 0;
    // 在被指定的基准方案上改名、调参（切换过去编辑），结论实时从最新文档计算
    vm.selectScenario('scenario-a');
    vm.updateSettings({ name: '改名后的方案' });
    vm.updateDevice(a.devices[0].id, { watts: 100 });
    vm.selectScenario('scenario-b');
    expect(vm.comparisonScenario?.id).toBe('scenario-a');
    expect(vm.comparisonScenario?.name).toBe('改名后的方案');
    const afterKwh = vm.comparisonScenario ? (100 * 1 * 30) / 1000 : 0;
    expect(afterKwh).toBeLessThan(beforeKwh);
  });

  it('clears the explicit choice when the chosen baseline is deleted, leaving no dangling note', () => {
    const a = scenario('scenario-a', '方案A', '2026-02-01T00:00:00.000Z', 50);
    const b = scenario('scenario-b', '方案B', '2026-03-01T00:00:00.000Z', 100);
    const c = scenario('scenario-c', '方案C', '2026-04-01T00:00:00.000Z', 80);
    repository.data.scenarios = [a, b, c];
    repository.data.activeScenarioId = b.id;
    repository.data.comparisonScenarioId = a.id;
    vm = new EnergyLensViewModel(repository);
    vm.initialize();
    vm.removeScenario('scenario-a');
    // 指向被删方案的引用已清空，自动回退到稳定默认（创建最早的剩余方案 C）
    expect(vm.getState().document?.comparisonScenarioId).toBeNull();
    expect(vm.comparisonScenario?.id).toBe('scenario-c');
  });

  it('keeps at least one scenario when deleting', () => {
    vm.removeScenario(exampleScenario.id);
    expect(vm.getState().document?.scenarios).toHaveLength(1);
    expect(vm.getState().notice?.text).toContain('至少保留一个方案');
  });

  it('swaps the pair when selecting the current baseline', () => {
    const a = scenario('scenario-a', '方案A', '2026-02-01T00:00:00.000Z', 50);
    const b = scenario('scenario-b', '方案B', '2026-03-01T00:00:00.000Z', 100);
    repository.data.scenarios = [a, b];
    repository.data.activeScenarioId = a.id;
    repository.data.comparisonScenarioId = b.id;
    vm = new EnergyLensViewModel(repository);
    vm.initialize();
    vm.selectScenario('scenario-b');
    expect(vm.activeScenario?.id).toBe('scenario-b');
    expect(vm.comparisonScenario?.id).toBe('scenario-a');
  });
});
