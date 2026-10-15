import { Injectable, inject, isDevMode } from '@angular/core';
import { WorldState } from '../net/world-state';
import type { Point } from './world-logic';

declare global {
  interface Window {
    /** Hook chỉ tồn tại ở chế độ phát triển, dùng cho kiểm thử đầu-cuối Playwright. */
    __ninjaWorld?: NinjaWorldTestHook;
  }
}

/** Cầu nối cho e2e: đọc trạng thái client đang vẽ và mô phỏng một cú bấm chuột. */
export interface NinjaWorldTestHook {
  /** Tên mọi thực thể đang vẽ, kể cả nhân vật của mình. */
  entityNames(): string[];
  npcNames(): string[];
  /** Toạ độ thực thể theo góc nhìn client (đơn vị pixel của server). */
  position(name: string): Point | null;
  localPlayerName(): string;
  clickEntity(name: string): void;
}

export interface NinjaWorldTestActions {
  /** Mô phỏng đúng việc người chơi bấm chuột vào một thực thể. */
  clickEntity(name: string): void;
}

/**
 * Gắn hook kiểm thử lên `window.__ninjaWorld` khi chạy ở chế độ phát triển.
 *
 * Bản production **không** phơi hook này: `install()` mặc định chỉ chạy khi `isDevMode()`
 * trả về `true`, và trang `/play` gọi `uninstall()` khi rời đi.
 */
@Injectable({ providedIn: 'root' })
export class WorldTestHook {
  private readonly world = inject(WorldState);
  private installed = false;

  install(actions: NinjaWorldTestActions, enabled: boolean = isDevMode()): void {
    if (!enabled || this.installed || typeof window === 'undefined') {
      return;
    }
    this.installed = true;
    window.__ninjaWorld = {
      entityNames: () => this.world.entities().map((entity) => entity.name),
      npcNames: () =>
        this.world
          .entities()
          .filter((entity) => entity.kind === 'npc')
          .map((entity) => entity.name),
      position: (name) => {
        const entity = this.world.entities().find((candidate) => candidate.name === name);
        return entity ? { x: entity.x, y: entity.y } : null;
      },
      localPlayerName: () => this.world.self()?.name ?? '',
      clickEntity: (name) => {
        actions.clickEntity(name);
      },
    };
  }

  uninstall(): void {
    if (!this.installed) {
      return;
    }
    this.installed = false;
    delete window.__ninjaWorld;
  }
}
