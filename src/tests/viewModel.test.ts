import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleScenario } from '../domain';
import type { EnergyDocument } from '../types';
import { EnergyLensViewModel } from '../viewModel';
import type { EnergyRepository } from '../repository';

function makeRepository(): EnergyRepository & { data: EnergyDocument; save: ReturnType<typeof vi.fn> } {
  const data: EnergyDocument = { version: 1, scenarios: [structuredClone(exampleScenario)], activeScenarioId: exampleScenario.id, baselineScenarioId: null };
  return { data, load: () => data, save: vi.fn((next: EnergyDocument) => { data.scenarios = next.scenarios; data.activeScenarioId = next.activeScenarioId; data.baselineScenarioId = next.baselineScenarioId; }) };
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

  it('shows no comparison while only one scenario exists', () => {
    expect(vm.comparison).toBeNull();
  });

  it('compares a fresh copy against its source, not the first scenario in the list', () => {
    vm.duplicateActive();
    const firstCopyId = vm.getState().document?.scenarios[1].id ?? '';
    vm.duplicateActive();
    // 第二个副本的来源是第一个副本；旧逻辑会错误地选列表里排第一的原始方案
    expect(vm.getState().document?.scenarios).toHaveLength(3);
    expect(vm.comparison?.baseline.id).toBe(firstCopyId);
    expect(vm.comparison?.deltaKwh).toBe(0);
  });

  it('keeps the user-pinned baseline when switching between scenarios', () => {
    vm.duplicateActive();
    vm.duplicateActive();
    vm.setBaseline(exampleScenario.id);
    expect(vm.comparison?.baseline.id).toBe(exampleScenario.id);
    const middleId = vm.getState().document?.scenarios[1].id ?? '';
    vm.selectScenario(middleId);
    expect(vm.comparison?.baseline.id).toBe(exampleScenario.id);
  });

  it('rejects a baseline that is missing or is the active scenario', () => {
    vm.duplicateActive();
    const activeId = vm.getState().document?.activeScenarioId ?? '';
    vm.setBaseline('scenario-that-does-not-exist');
    vm.setBaseline(activeId);
    expect(vm.getState().document?.baselineScenarioId).toBe(exampleScenario.id);
  });

  it('resets the pinned baseline when it becomes the active scenario', () => {
    vm.duplicateActive();
    vm.duplicateActive();
    const middleId = vm.getState().document?.scenarios[1].id ?? '';
    vm.setBaseline(middleId);
    vm.selectScenario(middleId);
    expect(vm.getState().document?.baselineScenarioId).toBeNull();
    // 自动回退到最早创建的非当前方案，与列表顺序无关
    expect(vm.comparison?.baseline.id).toBe(exampleScenario.id);
  });

  it('follows renames and parameter changes of the baseline scenario', () => {
    vm.duplicateActive();
    const copyId = vm.getState().document?.scenarios[1].id ?? '';
    // 副本当前是编辑对象：改名、调价、改参数
    vm.updateSettings({ name: '省电版方案', pricePerKwh: 0.9 });
    vm.updateDevice(`${copyId}-device-aircon`, { dailyHours: 1 });
    vm.selectScenario(exampleScenario.id);
    // 基准按 id 实时解析，副本的改动全部反映到结论里
    expect(vm.comparison?.baseline.id).toBe(copyId);
    expect(vm.comparison?.baseline.name).toBe('省电版方案');
    expect(vm.comparison?.deltaKwh).toBeGreaterThan(0);
  });

  it('reassigns the baseline explicitly when the pinned scenario is deleted', () => {
    vm.duplicateActive();
    vm.duplicateActive();
    const middleId = vm.getState().document?.scenarios[1].id ?? '';
    vm.setBaseline(middleId);
    vm.removeScenario(middleId);
    expect(vm.getState().document?.scenarios.some((scenario) => scenario.id === middleId)).toBe(false);
    expect(vm.getState().document?.baselineScenarioId).toBeNull();
    expect(vm.comparison?.baseline.id).toBe(exampleScenario.id);
    expect(vm.getState().notice?.text).toContain('对比基准已切换');
  });

  it('moves the active scenario to a stable survivor when the active one is deleted', () => {
    vm.duplicateActive();
    const copyId = vm.getState().document?.scenarios[1].id ?? '';
    vm.removeScenario(copyId);
    expect(vm.getState().document?.activeScenarioId).toBe(exampleScenario.id);
    expect(vm.comparison).toBeNull();
  });

  it('refuses to delete the last remaining scenario', () => {
    vm.removeScenario(exampleScenario.id);
    expect(vm.getState().document?.scenarios).toHaveLength(1);
    expect(vm.getState().notice?.kind).toBe('info');
  });
});
