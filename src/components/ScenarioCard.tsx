import { formatNumber } from '../domain';
import type { EnergyScenario } from '../types';

interface ScenarioCardProps {
  scenario: EnergyScenario;
  totalKwh: number;
  active: boolean;
  isBaseline: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

export function ScenarioCard({ scenario, totalKwh, active, isBaseline, canRemove, onSelect, onRemove }: ScenarioCardProps) {
  return <div className={`scenario-card ${active ? 'active' : ''}`}>
    <button className="scenario-main" onClick={onSelect}>
      <span className="scenario-dot" />
      <span className="scenario-copy">
        <strong>{scenario.name}</strong>
        <small>{scenario.devices.length} 台设备 · {formatNumber(totalKwh)} kWh / 月</small>
      </span>
      <span className="arrow">→</span>
    </button>
    <div className="scenario-tags">
      {isBaseline && <span className="baseline-tag">对比基准</span>}
      {active && <span className="active-tag">当前</span>}
      {canRemove && <button className="scenario-remove" onClick={onRemove} aria-label={`删除方案${scenario.name}`}>×</button>}
    </div>
  </div>;
}
