import { expect, test, type Page } from '@playwright/test';

/**
 * Nhiệm vụ chính tuyến chương 1 (M5): người chơi mới phải đi được chuỗi mở đầu, nhận thưởng, và
 * không bị kẹt kể cả khi thoát giữa chừng rồi đăng nhập lại.
 *
 * Bấm NPC bằng hook `clickEntity` được vì luật M2 vẫn giữ: NPC chỉ cần ở trong bản đồ hiện tại là
 * nói chuyện được, không cần đứng sát. Chỉ mục tiêu `reach` mới phải đi bộ thật qua cổng.
 */

const PASSWORD = 'matkhau123';
const START_MAP_NAME = 'Làng Khởi Nguồn';
const TRAINING_MAP_NAME = 'Bãi Luyện Tập';
const HEADMASTER = 'Thầy Hiệu Trưởng';
const SHOP_TEACHER = 'Thầy Đồ';
const SCARECROW = 'Bù Nhìn Tập Luyện';

const QUEST_CHAO_LANG = 'quest-chao-lang';
const QUEST_DUONG_TOI_BAI_TAP = 'quest-duong-toi-bai-tap';
const QUEST_BAI_HOC_DAU_TIEN = 'quest-bai-hoc-dau-tien';

interface HookObjective {
  readonly kind: string;
  readonly description: string;
  readonly count: number;
  readonly progress: number;
  readonly done: boolean;
}

interface HookQuest {
  readonly questId: string;
  readonly name: string;
  readonly state: string;
  readonly objectives: readonly HookObjective[];
}

interface HookAvailableQuest {
  readonly questId: string;
  readonly name: string;
  readonly giverName: string;
}

interface HookMonster {
  readonly name: string;
  readonly alive: boolean;
}

interface HookQuestState {
  readonly active: readonly HookQuest[];
  readonly available: readonly HookAvailableQuest[];
  readonly completed: readonly string[];
  readonly unlockedFeatures: readonly string[];
}

interface HookCharacter {
  readonly level: number;
  readonly exp: number;
  readonly yen: number;
}

interface HookBattle {
  readonly isMyTurn: boolean;
  readonly outcome: string | null;
}

interface HookApi {
  readonly character: () => HookCharacter | null;
  readonly battle: () => HookBattle | null;
  readonly attackMonster: (name: string) => void;
  readonly clickEntity: (name: string) => void;
  readonly monsters: () => readonly HookMonster[];
  readonly questState: () => HookQuestState;
  readonly questLogOpen: () => boolean;
}

function uniqueSuffix(): string {
  return `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
}

/** Đăng ký tài khoản mới, tạo nhân vật và vào thế giới; trả về tên nhân vật. */
async function enterWorld(page: Page): Promise<string> {
  const suffix = uniqueSuffix();
  const username = `m5${suffix}`;
  const characterName = `M5${suffix.slice(-5)}`;

  await page.goto('/login');
  await page.locator('.tab', { hasText: 'Tạo tài khoản' }).click();
  await page.fill('#username', username);
  await page.fill('#password', PASSWORD);
  await page.locator('form button[type=submit]').click();
  await expect(page).toHaveURL(/\/characters$/);

  await page.fill('#character-name', characterName);
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('.list .card h2')).toHaveText(characterName);

  await page.goto('/play');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.hud .map-name')).toHaveText(START_MAP_NAME);
  return characterName;
}

async function character(page: Page): Promise<HookCharacter | null> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.character() : null;
  });
}

async function battle(page: Page): Promise<HookBattle | null> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.battle() : null;
  });
}

async function questState(page: Page): Promise<HookQuestState> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    if (!api) {
      throw new Error('chưa có hook __ninjaWorld');
    }
    return api.questState();
  });
}

async function monsters(page: Page): Promise<readonly HookMonster[]> {
  return page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.monsters() : [];
  });
}

/** Bấm vào một NPC (hoặc quái) trên canvas theo tên. */
async function clickEntity(page: Page, name: string): Promise<void> {
  await page.evaluate((entityName) => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    api?.clickEntity(entityName);
  }, name);
}

/** Bấm vào con quái còn sống gần nhất tên `name` để vào trận. */
async function attackMonster(page: Page, name: string): Promise<void> {
  // Phải có con nào còn sống trước đã: bãi có 4 bù nhìn nhưng bấm lúc cả bãi vừa gục thì không có
  // trận nào mở ra và bài kiểm thử sẽ treo ở chỗ chờ trận.
  await expect
    .poll(
      async () => (await monsters(page)).some((monster) => monster.name === name && monster.alive),
      {
        message: `chờ ${name} còn sống trước khi bấm`,
        timeout: 30_000,
      },
    )
    .toBe(true);
  await page.evaluate((monsterName) => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    api?.attackMonster(monsterName);
  }, name);
}

async function waitForBattle(page: Page, timeoutMs = 25_000): Promise<void> {
  await expect
    .poll(async () => (await battle(page)) !== null, {
      message: 'chờ trận đấu mở ra',
      timeout: timeoutMs,
    })
    .toBe(true);
}

/** Đánh tới khi trận kết thúc: chỉ bấm khi đang tới lượt, chờ tới khi có kết quả. */
async function fightToTheEnd(page: Page): Promise<HookBattle> {
  const deadline = Date.now() + 60_000;
  const attackButton = page.locator('.battle-panel').getByRole('button', { name: 'Đánh thường' });
  while (Date.now() < deadline) {
    const current = await battle(page);
    if (!current || current.outcome) {
      return current ?? { isMyTurn: false, outcome: null };
    }
    if (current.isMyTurn) {
      // Hạn ngắn cho cú bấm: trận vừa kết thúc thì nút biến mất và bảng kết trận thay chỗ.
      await attackButton.click({ timeout: 2_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(120);
  }
  throw new Error('trận đấu không kết thúc sau 60 giây');
}

/** Đánh hạ một con quái rồi đóng bảng kết trận. */
async function killOneMonster(page: Page, name: string): Promise<void> {
  await attackMonster(page, name);
  await waitForBattle(page);
  await fightToTheEnd(page);
  // Chỉ bấm nút trong bảng kết trận: túi đồ cũng có nút đóng (aria-label "Đóng túi đồ").
  await page.locator('.result').getByRole('button', { name: 'Đóng' }).click();
  await expect.poll(async () => (await battle(page)) === null, { timeout: 10_000 }).toBe(true);
}

/** Nói chuyện với NPC rồi chờ bảng hội thoại hiện ra. */
async function talkTo(page: Page, npcName: string): Promise<void> {
  await clickEntity(page, npcName);
  await expect(page.locator('.npc-dialog')).toBeVisible();
}

/** Mở/đóng nhật ký nhiệm vụ bằng nút trên HUD, chỉ bấm khi trạng thái chưa đúng. */
async function toggleQuestLog(page: Page, open: boolean): Promise<void> {
  const isOpen = await page.evaluate(() => {
    const api = (globalThis as unknown as { __ninjaWorld?: HookApi }).__ninjaWorld;
    return api ? api.questLogOpen() : false;
  });
  if (isOpen !== open) {
    await page.locator('.hud__quest').click();
  }
  if (open) {
    await expect(page.locator('.quest-log')).toBeVisible();
  } else {
    await expect(page.locator('.quest-log')).toBeHidden();
  }
}

/** Giữ một phím đi bộ cho tới khi vào đúng bản đồ (cổng tự kích hoạt khi đi vào vùng cổng). */
async function walkUntilMap(page: Page, key: string, mapName: string): Promise<void> {
  await page.keyboard.down(key);
  try {
    await expect
      .poll(async () => page.locator('.hud .map-name').textContent(), { timeout: 30_000 })
      .toBe(mapName);
  } finally {
    await page.keyboard.up(key);
  }
}

/** Hoàn thành nhiệm vụ "Chào làng": nhận ở thầy Hiệu Trưởng, chào Thầy Đồ, rồi trả. */
async function finishChaoLang(page: Page): Promise<void> {
  await talkTo(page, HEADMASTER);
  await page.locator('.npc-quest__accept').click();
  await talkTo(page, SHOP_TEACHER);
  await page.locator('.npc-close').click();
  await talkTo(page, HEADMASTER);
  await page.locator('.npc-quest__complete').click();
  await expect
    .poll(async () => (await questState(page)).completed, { timeout: 10_000 })
    .toContain(QUEST_CHAO_LANG);
}

/** Hoàn thành nhiệm vụ "Đường tới bãi tập": nhận, đi bộ sang bãi, đi về, trả. */
async function finishDuongToiBaiTap(page: Page): Promise<void> {
  await page.locator('.npc-quest__accept').click();
  // Đóng hộp thoại rồi mới đi: đúng đường người chơi đi, và không để lớp phủ nằm trên bản đồ.
  await page.locator('.npc-close').click();
  await walkUntilMap(page, 'ArrowRight', TRAINING_MAP_NAME);
  await expect
    .poll(async () => (await questState(page)).active[0]?.objectives[0]?.done, { timeout: 10_000 })
    .toBe(true);
  await walkUntilMap(page, 'ArrowLeft', START_MAP_NAME);
  await talkTo(page, HEADMASTER);
  await page.locator('.npc-quest__complete').click();
  await expect
    .poll(async () => (await questState(page)).completed, { timeout: 10_000 })
    .toContain(QUEST_DUONG_TOI_BAI_TAP);
}

test.describe('nhiệm vụ chính tuyến chương 1', () => {
  test('người chơi mới nhận, làm rồi trả hai nhiệm vụ đầu và được thưởng', async ({ page }) => {
    await enterWorld(page);

    // Nhật ký nhiệm vụ chỉ đường ngay từ đầu: đúng một nhiệm vụ mở đầu và người giao của nó.
    await toggleQuestLog(page, true);
    const log = page.locator('.quest-log');
    await expect(log.locator('.quest-log__available-item')).toHaveCount(1);
    await expect(log.locator('.quest-log__available-item')).toContainText('Chào làng');
    await expect(log.locator('.quest-log__available-item')).toContainText(HEADMASTER);
    await toggleQuestLog(page, false);

    const before = await character(page);

    // Nhận nhiệm vụ đầu tiên trong hội thoại với thầy Hiệu Trưởng.
    await talkTo(page, HEADMASTER);
    await expect(page.locator('.npc-quest__name')).toHaveText('Chào làng');
    await page.locator('.npc-quest__accept').click();
    await expect
      .poll(async () => (await questState(page)).active.map((quest) => quest.questId))
      .toEqual([QUEST_CHAO_LANG]);

    // Mục tiêu "nói chuyện với Thầy Đồ" xong ngay khi bấm vào thầy ấy.
    await talkTo(page, SHOP_TEACHER);
    await expect
      .poll(async () => (await questState(page)).active[0]?.objectives[0]?.done)
      .toBe(true);
    // Thầy Đồ không giao và không nhận trả nhiệm vụ này nên không hiện khối nhiệm vụ nào.
    await expect(page.locator('.npc-quest')).toHaveCount(0);
    await page.locator('.npc-close').click();

    // Nhật ký thấy tiến độ và lời nhắc đi trả.
    await toggleQuestLog(page, true);
    await expect(log.locator('.quest-log__objective')).toContainText('(1/1)');
    await expect(log.locator('.quest-log__ready')).toContainText(HEADMASTER);
    await toggleQuestLog(page, false);

    // Trả nhiệm vụ: nhận kinh nghiệm và yên, và nhiệm vụ kế tiếp hiện ra ngay trong hội thoại.
    await talkTo(page, HEADMASTER);
    await page.locator('.npc-quest__complete').click();
    await expect
      .poll(async () => (await questState(page)).completed, { timeout: 10_000 })
      .toContain(QUEST_CHAO_LANG);

    // Thưởng đi kèm `S2C_CHARACTER` gửi sau `S2C_QUEST_UPDATE`, nên chờ chỉ số đổi chứ không đọc ngay.
    await expect
      .poll(async () => (await character(page))?.exp ?? 0, { message: 'chờ nhận kinh nghiệm' })
      .toBeGreaterThan(before?.exp ?? 0);
    await expect
      .poll(async () => (await character(page))?.yen ?? 0, { message: 'chờ nhận yên' })
      .toBeGreaterThan(before?.yen ?? 0);
    // Hộp thoại đang mở phải tự đổi sang nhiệm vụ kế tiếp, không phải bấm lại NPC.
    await expect(page.locator('.npc-quest__name')).toHaveText('Đường tới bãi tập');

    // Nhiệm vụ 2: nhận, đi bộ sang bãi luyện tập cho mục tiêu `reach`, rồi về trả.
    await finishDuongToiBaiTap(page);
    const state = await questState(page);
    expect(state.available.map((quest) => quest.questId)).toContain(QUEST_BAI_HOC_DAU_TIEN);
    // Thứ tự trong `completed` là do server quyết định (theo lúc trả xong), nên chỉ so tập hợp.
    expect([...state.completed].sort()).toEqual([QUEST_CHAO_LANG, QUEST_DUONG_TOI_BAI_TAP].sort());
  });

  test('thoát giữa chừng rồi đăng nhập lại vẫn giữ nhiệm vụ đang làm và tiến độ', async ({
    page,
  }) => {
    await enterWorld(page);

    await finishChaoLang(page);
    await finishDuongToiBaiTap(page);

    // Nhận nhiệm vụ đánh quái rồi hạ đúng một con: tiến độ 1/2.
    await page.locator('.npc-quest__accept').click();
    await expect
      .poll(async () => (await questState(page)).active[0]?.questId)
      .toBe(QUEST_BAI_HOC_DAU_TIEN);
    await page.locator('.npc-close').click();
    await walkUntilMap(page, 'ArrowRight', TRAINING_MAP_NAME);
    await killOneMonster(page, SCARECROW);
    await expect
      .poll(async () => (await questState(page)).active[0]?.objectives[0]?.progress, {
        timeout: 15_000,
      })
      .toBe(1);

    // Thoát giữa chừng: tải lại trang, phiên đăng nhập giữ qua localStorage.
    await page.reload();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('.hud .map-name')).toHaveText(START_MAP_NAME);

    const resumed = await questState(page);
    expect(resumed.active.map((quest) => quest.questId)).toEqual([QUEST_BAI_HOC_DAU_TIEN]);
    expect(resumed.active[0]?.objectives[0]?.progress).toBe(1);
    expect([...resumed.completed].sort()).toEqual(
      [QUEST_CHAO_LANG, QUEST_DUONG_TOI_BAI_TAP].sort(),
    );

    // Nhật ký vẫn thấy tiến độ cũ, và hạ thêm một con nữa là nhiệm vụ sẵn sàng trả.
    await toggleQuestLog(page, true);
    await expect(page.locator('.quest-log__objective')).toContainText('(1/2)');
    await toggleQuestLog(page, false);

    await walkUntilMap(page, 'ArrowRight', TRAINING_MAP_NAME);
    await killOneMonster(page, SCARECROW);
    await expect
      .poll(async () => (await questState(page)).active[0]?.objectives[0]?.done, {
        timeout: 15_000,
      })
      .toBe(true);

    await walkUntilMap(page, 'ArrowLeft', START_MAP_NAME);
    await talkTo(page, HEADMASTER);
    await page.locator('.npc-quest__complete').click();
    await expect
      .poll(async () => (await questState(page)).completed, { timeout: 10_000 })
      .toContain(QUEST_BAI_HOC_DAU_TIEN);
  });

  test('hội thoại đổi nhánh theo trạng thái nhiệm vụ và đi tiếp được trong cây', async ({
    page,
  }) => {
    await enterWorld(page);

    // Chưa nhận nhiệm vụ nào: hội thoại mặc định, không có lựa chọn nào.
    await talkTo(page, HEADMASTER);
    await expect(page.locator('.npc-dialog')).toContainText('Làng Khởi Nguồn');
    await expect(page.locator('.npc-option')).toHaveCount(0);

    // Nhận nhiệm vụ đầu tiên: hội thoại đổi sang nhánh của nhiệm vụ đó và có lựa chọn.
    await page.locator('.npc-quest__accept').click();
    await expect(page.locator('.npc-dialog')).toContainText(SHOP_TEACHER);
    await expect(page.locator('.npc-dialog')).not.toContainText('Làng Khởi Nguồn');
    await expect(page.locator('.npc-option')).toHaveCount(2);

    // Đi tiếp trong cây: nhánh sau nói về quầy hàng của Thầy Đồ.
    await page.locator('.npc-option', { hasText: 'Thầy Đồ là ai' }).click();
    await expect(page.locator('.npc-dialog')).toContainText('quầy hàng');
    await expect(page.locator('.npc-option')).toHaveCount(1);

    // Lựa chọn không có nhánh kế tiếp thì đóng hộp thoại.
    await page.locator('.npc-option', { hasText: 'Con cảm ơn thầy' }).click();
    await expect(page.locator('.npc-dialog')).toBeHidden();

    // Nhật ký nhiệm vụ chỉ liệt kê nhiệm vụ đã đủ điều kiện nhận, không lộ nhiệm vụ khoá.
    await toggleQuestLog(page, true);
    await expect(page.locator('.quest-log__available-item')).toHaveCount(0);
    await expect(page.locator('.quest-log__quest')).toHaveCount(1);
    await expect(page.locator('.quest-log')).not.toContainText('Bái sư');
  });
});
