import { exampleScenario, pickDefaultComparisonId } from './domain';
import { readDocument, writeDocument } from './services/storageService';
import type { EnergyDocument, EnergyScenario } from './types';

export interface EnergyRepository {
  load(): EnergyDocument;
  save(document: EnergyDocument): void;
}

export class LocalEnergyRepository implements EnergyRepository {
  load(): EnergyDocument {
    const saved = readDocument();
    if (!saved || saved.scenarios.length === 0) {
      return { version: 1, scenarios: [exampleScenario], activeScenarioId: exampleScenario.id, comparisonScenarioId: null };
    }
    const activeExists = saved.scenarios.some((scenario) => scenario.id === saved.activeScenarioId);
    const document = activeExists ? saved : { ...saved, activeScenarioId: saved.scenarios[0].id };
    // 归一化对比选择：老数据缺字段、指向已删除方案或指向自身时，统一交回“稳定默认”
    const preferred = typeof document.comparisonScenarioId === 'string' ? document.comparisonScenarioId : null;
    const preferredValid = preferred !== null
      && preferred !== document.activeScenarioId
      && document.scenarios.some((scenario) => scenario.id === preferred);
    return { ...document, comparisonScenarioId: preferredValid ? preferred : null };
  }

  save(document: EnergyDocument): void {
    // 保存前再守一道：对比方案必须真实存在且不是当前方案
    const preferredValid = document.comparisonScenarioId !== null
      && document.comparisonScenarioId !== document.activeScenarioId
      && document.scenarios.some((scenario) => scenario.id === document.comparisonScenarioId);
    writeDocument({ ...document, comparisonScenarioId: preferredValid ? document.comparisonScenarioId : null });
  }
}

export function findScenario(document: EnergyDocument, id: string | null): EnergyScenario | undefined {
  if (id === null) return undefined;
  return document.scenarios.find((scenario) => scenario.id === id);
}

/** 供 UI 展示稳定默认选择（用户尚未显式指定时），不会随列表顺序漂移 */
export function defaultComparisonId(document: EnergyDocument): string | null {
  return pickDefaultComparisonId(document.scenarios, document.activeScenarioId);
}
