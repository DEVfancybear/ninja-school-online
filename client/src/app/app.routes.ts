import { type Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    title: 'Ninja School Online — Trang chủ',
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
  },
  {
    path: 'login',
    title: 'Ninja School Online — Đăng nhập',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: 'characters',
    title: 'Ninja School Online — Nhân vật',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/characters/characters').then((m) => m.Characters),
  },
  {
    path: 'play',
    title: 'Ninja School Online — Thế giới',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/play/play').then((m) => m.Play),
  },
  { path: '**', redirectTo: '' },
];
