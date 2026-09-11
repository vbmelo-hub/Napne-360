import { Routes } from '@angular/router';
import { authGuard, adminGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'conta', canActivate:[authGuard], loadComponent:()=>import('./pages/account.component').then(m=>m.AccountComponent) },
  { path: 'login', loadComponent: () => import('./pages/login.component').then(m => m.LoginComponent) },
  { path: '', canActivate: [authGuard], loadComponent: () => import('./pages/home.component').then(m => m.HomeComponent) },
  { path: 'estudantes', canActivate: [authGuard], loadComponent: () => import('./pages/students.component').then(m => m.StudentsComponent) },
  { path: 'estudantes/:id', canActivate: [authGuard], loadComponent: () => import('./pages/student-detail.component').then(m => m.StudentDetailComponent) },
  { path: 'estudantes/:studentId/pei/:peiId', canActivate: [authGuard], loadComponent: () => import('./pages/pei-editor.component').then(m => m.PeiEditorComponent) },
  { path: 'administracao', canActivate: [authGuard, adminGuard], loadComponent: () => import('./pages/admin.component').then(m => m.AdminComponent) },
  { path: '**', redirectTo: '' }
];
