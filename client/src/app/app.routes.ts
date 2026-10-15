import { type Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Ninja School Online — Trang chủ',
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
  },
  {
    path: 'play',
    title: 'Ninja School Online — Thế giới',
    loadComponent: () => import('./game/world-canvas/world-canvas').then((m) => m.WorldCanvas),
  },
  { path: '**', redirectTo: '' },
];
