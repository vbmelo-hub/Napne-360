import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/v1/') || request.url === '/api/v1/auth/login') return next(request);

  const auth = inject(AuthService);
  const token = auth.token();
  if (!token) return next(request);

  return next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })).pipe(
    catchError((error: HttpErrorResponse) => {
      const status = error.headers.get('X-Session-Status');
      if (error.status === 401 && request.url !== '/api/v1/auth/refresh'
          && (status || request.url !== '/api/v1/auth/password')) {
        auth.rejectSession(token, status);
      }
      return throwError(() => error);
    })
  );
};
