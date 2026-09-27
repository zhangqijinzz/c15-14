import { cloneScenario, resolveComparisonId, summarizeScenario, validateDevice, validateScenarioSettings } from './domain';
import { findScenario, type EnergyRepository } from './repository';
import type { EnergyDevice, EnergyDocument, EnergyScenario, Notice, ViewStatus } from './types';

export interface EnergyLensState {
  document: EnergyDocument | null;
  status: ViewStatus;
  notice: Notice | null;
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

  /** 用户是否显式指定了对比方案（false 时界面显示稳定默认选择） */
  get isComparisonExplicit(): boolean {
    return this.state.document?.comparisonScenarioId !== null
      && this.state.document?.comparisonScenarioId !== undefined;
  }

  /** 当前生效的对比方案：用户指定优先，否则回退到稳定默认；任何情况下都不为空方案 */
  get comparisonScenario(): EnergyScenario | null {
    if (!this.state.document) return null;
    const comparisonId = resolveComparisonId(
      this.state.document.scenarios,
      this.state.document.activeScenarioId,
      this.state.document.comparisonScenarioId,
    );
    return findScenario(this.state.document, comparisonId) ?? null;
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
    const id = `scenario-${Date.now()}`;
    const copy = cloneScenario(source, id, `${source.name} · 副本`);
    // 复制后立刻以“原方案”为对比对象，结论指向用户真正想比的方案，而不是列表里的其他方案
    const document = {
      ...this.state.document,
      scenarios: [...this.state.document.scenarios, copy],
      activeScenarioId: id,
      comparisonScenarioId: source.id,
    };
    this.persist(document, '方案已复制，已自动与原方案对比');
  }

  selectScenario(id: string): void {
    if (!this.state.document || !findScenario(this.state.document, id)) return;
    // 切到的新方案若正是被指定的对比对象，则把对比对象换成原当前方案，保持对比对可用
    const comparisonScenarioId = this.state.document.comparisonScenarioId === id
      ? this.state.document.activeScenarioId
      : this.state.document.comparisonScenarioId;
    this.persist(
      { ...this.state.document, activeScenarioId: id, comparisonScenarioId },
      '已切换方案',
    );
  }

  /** 用户显式指定对比方案；传 null 回到稳定默认选择 */
  setComparisonScenario(id: string | null): void {
    if (!this.state.document) return;
    if (id !== null && (id === this.state.document.activeScenarioId || !findScenario(this.state.document, id))) return;
    this.persist(
      { ...this.state.document, comparisonScenarioId: id },
      id === null ? '已恢复为自动选择对比方案' : '对比方案已指定',
    );
  }

  /** 删除方案，并保证对比结论不会指向已删除的空方案 */
  removeScenario(id: string): void {
    if (!this.state.document) return;
    if (this.state.document.scenarios.length <= 1) {
      this.setNotice({ kind: 'info', text: '至少保留一个方案，无法删除' });
      return;
    }
    const scenarios = this.state.document.scenarios.filter((scenario) => scenario.id !== id);
    const activeScenarioId = this.state.document.activeScenarioId === id
      ? scenarios[0].id
      : this.state.document.activeScenarioId;
    // 被删的是对比对象时清空显式选择，由稳定默认接手，绝不留下悬空引用
    const comparisonScenarioId = this.state.document.comparisonScenarioId === id
      ? null
      : this.state.document.comparisonScenarioId;
    this.persist(
      { ...this.state.document, scenarios, activeScenarioId, comparisonScenarioId },
      '方案已删除',
    );
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
