import { GUILD_MAX_MEMBERS, Opcode, type GuildUpdate } from '@ninja/shared';
import { Injectable, computed, signal } from '@angular/core';

export function emptyGuildState(): GuildUpdate {
  return { guild: null, maxMembers: GUILD_MAX_MEMBERS };
}

/** Full server-owned guild snapshot; the client never predicts membership, level, or chat access. */
@Injectable({ providedIn: 'root' })
export class GuildState {
  private readonly value = signal<GuildUpdate>(emptyGuildState());
  readonly snapshot = this.value.asReadonly();
  readonly guild = computed(() => this.value().guild);

  applyPacket(op: number, payload: unknown): boolean {
    if (op !== Opcode.S2C_GUILD_UPDATE) return false;
    this.value.set(payload as GuildUpdate);
    return true;
  }

  reset(): void {
    this.value.set(emptyGuildState());
  }
}
