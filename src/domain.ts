import type { EnergyDevice, EnergyDocument, EnergyEstimate, EnergyScenario, ScenarioSummary } from './types';

export const MAX_DAILY_HOURS = 24;

export const exampleScenario: EnergyScenario = {
  id: 'scenario-home',
  name: '夏日居家方案',
  pricePerKwh: 0.62,
  daysPerMonth: 30,
  createdAt: '2026-01-01T00:00:00.000Z',
  devices: [
    { id: 'device-aircon', name: '客厅空调', watts: 1200, dailyHours: 6 },
    { id: 'device-fridge', name: '冰箱', watts: 150, dailyHours: 10 },
    { id: 'device-lamp', name: '书桌台灯', watts: 12, dailyHours: 5 },
  ],
};

export function estimateDevice(device: EnergyDevice, daysPerMonth: number, pricePerKwh: number): EnergyEstimate {
  const dailyKwh = (device.watts * device.dailyHours) / 1000;
  const monthlyKwh = dailyKwh * daysPerMonth;
  return { dailyKwh, monthlyKwh, monthlyCost: monthlyKwh * pricePerKwh };
}

export function summarizeScenario(scenario: EnergyScenario): ScenarioSummary {
  const devices = scenario.devices.map((device) => ({
    ...device,
    ...estimateDevice(device, scenario.daysPerMonth, scenario.pricePerKwh),
    share: 0,
  }));
  const total = devices.reduce(
    (sum, device) => ({
      dailyKwh: sum.dailyKwh + device.dailyKwh,
      monthlyKwh: sum.monthlyKwh + device.monthlyKwh,
      monthlyCost: sum.monthlyCost + device.monthlyCost,
    }),
    { dailyKwh: 0, monthlyKwh: 0, monthlyCost: 0 },
  );
  return {
    total,
    devices: devices.map((device) => ({ ...device, share: total.monthlyKwh ? device.monthlyKwh / total.monthlyKwh : 0 })),
  };
}

export function validateDevice(device: Pick<EnergyDevice, 'name' | 'watts' | 'dailyHours'>): string | null {
  if (!device.name.trim()) return '请填写设备名称';
  if (!Number.isFinite(device.watts) || device.watts < 0) return '功率不能为负数';
  if (!Number.isFinite(device.dailyHours) || device.dailyHours < 0) return '使用时间不能为负数';
  if (device.dailyHours > MAX_DAILY_HOURS) return '每日使用时间不能超过 24 小时';
  return null;
}

export function validateScenarioSettings(pricePerKwh: number, daysPerMonth: number): string | null {
  if (!Number.isFinite(pricePerKwh) || pricePerKwh < 0) return '电价不能为负数';
  if (!Number.isFinite(daysPerMonth) || daysPerMonth < 1 || daysPerMonth > 31) return '计费天数需在 1–31 天之间';
  return null;
}

export function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function cloneScenario(source: EnergyScenario, id: string, name: string): EnergyScenario {
  return { ...source, id, name, createdAt: new Date().toISOString(), devices: source.devices.map((device) => ({ ...device, id: `${id}-${device.id}` })) };
}

/** 按创建时间（并列时按 id）给出与列表顺序无关的稳定排序 */
export function sortByStableOrder(scenarios: EnergyScenario[]): EnergyScenario[] {
  return scenarios.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * 解析对比基准方案：
 * 1. 用户指定过的方案（仍存在且不是当前方案）优先；
 * 2. 否则回退到稳定默认——最早创建的非当前方案，不随列表顺序变化；
 * 3. 只剩一个方案时返回 null，此时不应出现任何对比结论。
 */
export function resolveBaselineScenario(document: EnergyDocument): EnergyScenario | null {
  const candidates = document.scenarios.filter((scenario) => scenario.id !== document.activeScenarioId);
  if (candidates.length === 0) return null;
  const pinned = candidates.find((scenario) => scenario.id === document.baselineScenarioId);
  return pinned ?? sortByStableOrder(candidates)[0];
}
