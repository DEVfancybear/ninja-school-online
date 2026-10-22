import { Injectable, computed, signal } from '@angular/core';
import { Opcode, type M7State } from '@ninja/shared';

@Injectable({ providedIn: 'root' })
export class M7ClientState {
  private readonly value = signal<M7State | null>(null);
  readonly snapshot = this.value.asReadonly();
  readonly event = computed(() => this.value()?.event ?? null);
  readonly boss = computed(() => this.value()?.boss ?? null);

  applyPacket(op: number, payload: unknown): boolean {
    if (op !== Opcode.S2C_M7_STATE) return false;
    this.value.set(payload as M7State);
    return true;
  }

  reset(): void {
    this.value.set(null);
  }
}
