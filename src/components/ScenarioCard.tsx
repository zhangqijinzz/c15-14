import { formatNumber } from '../domain';
import type { EnergyScenario } from '../types';

interface ScenarioCardProps {
  scenario: EnergyScenario;
  totalKwh: number;
  active: boolean;
  baseline: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

export function ScenarioCard({ scenario, totalKwh, active, baseline, canRemove, onSelect, onRemove }: ScenarioCardProps) {
  return <div className={`scenario-card ${active ? 'active' : ''}`}>
    <button className="scenario-main" onClick={onSelect}>
      <span className="scenario-dot" />
      <span className="scenario-copy"><strong>{scenario.name}</strong><small>{scenario.devices.length} 台设备 · {formatNumber(totalKwh)} kWh / 月</small></span>
      {baseline && <em className="baseline-badge">对比基准</em>}
      <span className="arrow">→</span>
    </button>
    {canRemove && <button className="scenario-remove" onClick={onRemove} aria-label={`删除方案 ${scenario.name}`}>×</button>}
  </div>;
}
