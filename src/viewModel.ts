import { cloneScenario, resolveBaselineScenario, sortByStableOrder, summarizeScenario, validateDevice, validateScenarioSettings } from './domain';
import { findScenario, type EnergyRepository } from './repository';
import type { EnergyDevice, EnergyDocument, EnergyScenario, Notice, ViewStatus } from './types';

export interface EnergyLensState {
  document: EnergyDocument | null;
  status: ViewStatus;
  notice: Notice | null;
}

export interface ScenarioComparison {
  baseline: EnergyScenario;
  baselineMonthlyKwh: number;
  activeMonthlyKwh: number;
  deltaKwh: number;
}

type Listener = (state: EnergyLensState) => void;

export class EnergyLensViewModel {
  private state: EnergyLensState = { document: null, status: 'loading', notice: null };
  private readonly listeners = new Set<Listener>();

  constructor(private readonly repository: EnergyRepository) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): EnergyLensState { return this.state; }

  initialize(): void {
    try {
      this.state = { document: this.repository.load(), status: 'ready', notice: null };
    } catch {
      this.state = { document: null, status: 'error', notice: { kind: 'error', text: '本地数据读取失败，请刷新重试' } };
    }
    this.emit();
  }

  get activeScenario(): EnergyScenario | null {
    if (!this.state.document) return null;
    return findScenario(this.state.document, this.state.document.activeScenarioId) ?? null;
  }

  get activeSummary() {
    return this.activeScenario ? summarizeScenario(this.activeScenario) : null;
  }

  /** 当前方案与对比基准的差异；只剩一个方案时为 null，界面不应显示对比结论 */
  get comparison(): ScenarioComparison | null {
    const document = this.state.document;
    const summary = this.activeSummary;
    if (!document || !summary) return null;
    const baseline = resolveBaselineScenario(document);
    if (!baseline) return null;
    const baselineMonthlyKwh = summarizeScenario(baseline).total.monthlyKwh;
    return { baseline, baselineMonthlyKwh, activeMonthlyKwh: summary.total.monthlyKwh, deltaKwh: summary.total.monthlyKwh - baselineMonthlyKwh };
  }

  updateDevice(deviceId: string, patch: Partial<Pick<EnergyDevice, 'name' | 'watts' | 'dailyHours'>>): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const device = scenario.devices.find((item) => item.id === deviceId);
    if (!device) return;
    const next = { ...device, ...patch };
    const error = validateDevice(next);
    if (error) {
      this.setNotice({ kind: 'error', text: error });
      return;
    }
    this.commit((current) => ({ ...current, devices: current.devices.map((item) => item.id === deviceId ? next : item) }), '参数已更新');
  }

  addDevice(): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const device: EnergyDevice = { id: `device-${Date.now()}`, name: '新设备', watts: 100, dailyHours: 1 };
    this.commit((current) => ({ ...current, devices: [...current.devices, device] }), '已添加设备，可继续修改参数');
  }

  removeDevice(deviceId: string): void {
    const scenario = this.activeScenario;
    if (!scenario || scenario.devices.length <= 1) {
      this.setNotice({ kind: 'info', text: '至少保留一个设备，便于计算方案' });
      return;
    }
    this.commit((current) => ({ ...current, devices: current.devices.filter((item) => item.id !== deviceId) }), '设备已移除');
  }

  updateSettings(patch: Partial<Pick<EnergyScenario, 'name' | 'pricePerKwh' | 'daysPerMonth'>>): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const next = { ...scenario, ...patch };
    const error = validateScenarioSettings(next.pricePerKwh, next.daysPerMonth);
    if (error) {
      this.setNotice({ kind: 'error', text: error });
      return;
    }
    this.commit((current) => ({ ...current, name: next.name.trim() || '未命名方案', pricePerKwh: next.pricePerKwh, daysPerMonth: next.daysPerMonth }), '计费参数已更新');
  }

  duplicateActive(): void {
    const source = this.activeScenario;
    if (!source || !this.state.document) return;
    // 同一毫秒内连续复制也不能撞 id，否则基准引用会同时指向多个方案
    const id = `scenario-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const copy = cloneScenario(source, id, `${source.name} · 副本`);
    // 新副本默认与它的来源方案对比，而不是列表里碰巧排第一的其他方案
    const document = { ...this.state.document, scenarios: [...this.state.document.scenarios, copy], activeScenarioId: id, baselineScenarioId: source.id };
    this.persist(document, '方案已复制，现在可以修改副本');
  }

  selectScenario(id: string): void {
    if (!this.state.document || !findScenario(this.state.document, id)) return;
    // 方案不能与自己对比：被设为当前方案后，原基准引用失效，回到自动选择
    const baselineScenarioId = this.state.document.baselineScenarioId === id ? null : this.state.document.baselineScenarioId;
    this.persist({ ...this.state.document, activeScenarioId: id, baselineScenarioId }, '已切换方案');
  }

  setBaseline(id: string): void {
    const document = this.state.document;
    if (!document || id === document.activeScenarioId) return;
    const target = findScenario(document, id);
    if (!target) return;
    this.persist({ ...document, baselineScenarioId: id }, `对比基准已设为「${target.name}」`);
  }

  removeScenario(id: string): void {
    const document = this.state.document;
    if (!document) return;
    const target = findScenario(document, id);
    if (!target) return;
    if (document.scenarios.length <= 1) {
      this.setNotice({ kind: 'info', text: '至少保留一个方案，便于继续推演' });
      return;
    }
    const scenarios = document.scenarios.filter((scenario) => scenario.id !== id);
    const activeScenarioId = document.activeScenarioId === id ? sortByStableOrder(scenarios)[0].id : document.activeScenarioId;
    // 被删的若是基准，立即清除引用并回退到稳定默认，不留指向空方案的结论
    const baselineRemoved = document.baselineScenarioId === id;
    const next: EnergyDocument = { ...document, scenarios, activeScenarioId, baselineScenarioId: baselineRemoved ? null : document.baselineScenarioId };
    let notice = `已删除方案「${target.name}」`;
    if (baselineRemoved) {
      const fallback = resolveBaselineScenario(next);
      if (fallback) notice += `，对比基准已切换为「${fallback.name}」`;
    }
    this.persist(next, notice);
  }

  complete(): void {
    this.state = { ...this.state, status: 'completed', notice: { kind: 'success', text: '本次推演已保存，可随时回来继续调整' } };
    this.emit();
  }

  private commit(update: (scenario: EnergyScenario) => EnergyScenario, notice: string): void {
    if (!this.state.document) return;
    const document = { ...this.state.document, scenarios: this.state.document.scenarios.map((scenario) => scenario.id === this.state.document?.activeScenarioId ? update(scenario) : scenario) };
    this.persist(document, notice);
  }

  private persist(document: EnergyDocument, notice: string): void {
    try {
      this.repository.save(document);
      this.state = { document, status: 'editing', notice: { kind: 'success', text: notice } };
    } catch {
      this.state = { ...this.state, status: 'error', notice: { kind: 'error', text: '保存失败，当前页面仍可继续编辑' } };
    }
    this.emit();
  }

  private setNotice(notice: Notice): void {
    this.state = { ...this.state, status: notice.kind === 'error' ? 'error' : 'editing', notice };
    this.emit();
  }

  private emit(): void { this.listeners.forEach((listener) => listener(this.state)); }
}
