import { Injectable, inject } from '@angular/core';
import {
  CharacterListResponseSchema,
  CharacterResponseSchema,
  type Character,
  type CreateCharacterRequest,
} from '@ninja/shared';
import { ApiService } from '../api/api.service';
import { CHARACTERS_PATH } from '../api/endpoints';
import { AuthService } from '../auth/auth.service';

/** Nhân vật của tài khoản đang đăng nhập: chỉ gọi API, mọi quy tắc đều do server quyết. */
@Injectable({ providedIn: 'root' })
export class CharacterService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  async list(): Promise<Character[]> {
    const response = await this.api.get(
      CHARACTERS_PATH,
      CharacterListResponseSchema,
      this.auth.accessToken(),
    );
    return response.characters;
  }

  /** Server kiểm tra tên trùng, giới hạn số nhân vật và quan hệ trường–phái. */
  async create(input: CreateCharacterRequest): Promise<Character> {
    const response = await this.api.post(
      CHARACTERS_PATH,
      input,
      CharacterResponseSchema,
      this.auth.accessToken(),
    );
    return response.character;
  }
}
