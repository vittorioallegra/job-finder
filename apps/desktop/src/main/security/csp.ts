/**
 * Content Security Policy for the renderer. The renderer never goes online: only the app's own
 * origin may load scripts, styles, images and fonts, and connect/fetch targets are limited to it.
 * Development adds the Vite dev server (websocket for HMR and inline preamble) on localhost only.
 */
export function buildContentSecurityPolicy(options: { development: boolean }): string {
  const scriptSrc = options.development ? "'self' 'unsafe-inline'" : "'self'";
  const connectSrc = options.development ? "'self' ws://localhost:* http://localhost:*" : "'self'";
  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}
