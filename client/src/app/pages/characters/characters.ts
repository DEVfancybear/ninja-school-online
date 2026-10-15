import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  CreateCharacterRequestSchema,
  MAX_CHARACTERS_PER_ACCOUNT,
  SCHOOLS,
  SCHOOL_CLASSES,
  type Character,
  type CharacterClass,
  type School,
} from '@ninja/shared';
import { apiErrorMessage } from '../../core/api/api-error';
import { type FieldErrors, validateSchema } from '../../core/api/validation';
import { AuthService } from '../../core/auth/auth.service';
import { CharacterService } from '../../core/character/character.service';
import { CLASS_LABELS, SCHOOL_LABELS } from '../../core/game-labels';

const FIRST_SCHOOL: School = SCHOOLS[0];

/** Danh sách nhân vật của tài khoản + biểu mẫu tạo nhân vật mới. */
@Component({
  selector: 'app-characters',
  imports: [FormsModule, RouterLink],
  templateUrl: './characters.html',
  styleUrl: './characters.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Characters implements OnInit {
  private readonly charactersApi = inject(CharacterService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly maxCharacters = MAX_CHARACTERS_PER_ACCOUNT;
  readonly schools = SCHOOLS;
  readonly accountName = computed(() => this.auth.account()?.username ?? '');

  readonly characterList = signal<Character[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly busy = signal(false);
  readonly fieldErrors = signal<FieldErrors>({});
  readonly formError = signal<string | null>(null);

  readonly name = signal('');
  readonly school = signal<School>(FIRST_SCHOOL);
  readonly class = signal<CharacterClass>(SCHOOL_CLASSES[FIRST_SCHOOL][0]);

  /** Mỗi trường chỉ đào tạo hai phái — đổi trường là đổi luôn danh sách phái. */
  readonly availableClasses = computed(() => SCHOOL_CLASSES[this.school()]);
  readonly canCreate = computed(() => this.characterList().length < MAX_CHARACTERS_PER_ACCOUNT);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  schoolLabel(school: School): string {
    return SCHOOL_LABELS[school];
  }

  classLabel(characterClass: CharacterClass): string {
    return CLASS_LABELS[characterClass];
  }

  formatYen(yen: number): string {
    return yen.toLocaleString('vi-VN');
  }

  fieldError(field: string): string | undefined {
    return this.fieldErrors()[field];
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.characterList.set(await this.charactersApi.list());
    } catch (error) {
      this.loadError.set(apiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  changeSchool(school: School): void {
    this.school.set(school);
    this.class.set(SCHOOL_CLASSES[school][0]);
    this.fieldErrors.set({});
  }

  async createCharacter(): Promise<void> {
    if (this.busy() || !this.canCreate()) {
      return;
    }

    const outcome = validateSchema(CreateCharacterRequestSchema, {
      name: this.name().trim(),
      school: this.school(),
      class: this.class(),
    });
    if (!outcome.ok) {
      this.fieldErrors.set(outcome.fieldErrors);
      this.formError.set('Vui lòng kiểm tra lại thông tin nhân vật.');
      return;
    }

    this.fieldErrors.set({});
    this.formError.set(null);
    this.busy.set(true);
    try {
      const created = await this.charactersApi.create(outcome.data);
      this.characterList.update((current) => [...current, created]);
      this.name.set('');
      this.changeSchool(FIRST_SCHOOL);
    } catch (error) {
      this.formError.set(apiErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
