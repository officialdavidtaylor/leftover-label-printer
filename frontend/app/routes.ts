import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/marketing.tsx'),
  route('login', 'routes/login.tsx'),
  route('auth/callback', 'routes/auth.callback.tsx'),
  layout('routes/app-layout.tsx', [
    route('app/print/new', 'routes/app.print.new.tsx'),
    route('app/jobs/:jobId', 'routes/app.jobs.$jobId.tsx'),
  ]),
] satisfies RouteConfig;
