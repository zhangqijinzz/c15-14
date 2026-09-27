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

  it('migrates legacy documents without a comparison choice', () => {
    localStorage.setItem('energy-lens.document.v1', JSON.stringify({ version: 1, scenarios: [exampleScenario], activeScenarioId: exampleScenario.id }));
    const recovered = new LocalEnergyRepository().load();
    expect(recovered.comparisonScenarioId).toBeNull();
  });

  it('normalizes a dangling comparison choice instead of pointing at an empty scenario', () => {
    localStorage.setItem('energy-lens.document.v1', JSON.stringify({
      version: 1,
      scenarios: [exampleScenario],
      activeScenarioId: exampleScenario.id,
      comparisonScenarioId: 'deleted-scenario',
    }));
    const recovered = new LocalEnergyRepository().load();
    expect(recovered.comparisonScenarioId).toBeNull();
  });
});
