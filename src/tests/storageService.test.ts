// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { exampleScenario } from '../domain';
import { LocalEnergyRepository } from '../repository';

describe('local persistence recovery', () => {
  beforeEach(() => localStorage.clear());

  it('falls back to a valid example when saved JSON is damaged', () => {
    localStorage.setItem('energy-lens.document.v1', JSON.stringify({ version: 1, scenarios: [null], activeScenarioId: 'missing' }));
    const recovered = new LocalEnergyRepository().load();
    expect(recovered.activeScenarioId).toBe(exampleScenario.id);
    expect(recovered.scenarios[0].devices.length).toBeGreaterThan(0);
  });

  it('loads documents saved before the baseline field existed', () => {
    localStorage.setItem('energy-lens.document.v1', JSON.stringify({ version: 1, scenarios: [structuredClone(exampleScenario)], activeScenarioId: exampleScenario.id }));
    const recovered = new LocalEnergyRepository().load();
    expect(recovered.baselineScenarioId).toBeNull();
  });

  it('drops a saved baseline that is dangling or points at the active scenario', () => {
    const other = { ...structuredClone(exampleScenario), id: 'scenario-other', name: '另一个方案' };
    const saved = { version: 1, scenarios: [structuredClone(exampleScenario), other], activeScenarioId: exampleScenario.id };
    localStorage.setItem('energy-lens.document.v1', JSON.stringify({ ...saved, baselineScenarioId: 'ghost' }));
    expect(new LocalEnergyRepository().load().baselineScenarioId).toBeNull();
    localStorage.setItem('energy-lens.document.v1', JSON.stringify({ ...saved, baselineScenarioId: exampleScenario.id }));
    expect(new LocalEnergyRepository().load().baselineScenarioId).toBeNull();
    localStorage.setItem('energy-lens.document.v1', JSON.stringify({ ...saved, baselineScenarioId: other.id }));
    expect(new LocalEnergyRepository().load().baselineScenarioId).toBe(other.id);
  });
});
