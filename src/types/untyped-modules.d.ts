/**
 * Ambient declarations for dependencies that ship no types.
 *
 * These are deliberately minimal — just enough that `tsc --noEmit` is clean
 * and can therefore be trusted as a gate. Without them the whole run is
 * noisy, and noise is how three genuinely broken migrations went unnoticed.
 */

/**
 * `web-push` has no bundled .d.ts. Only the two calls the app actually
 * makes are declared, so a typo in either one is still caught.
 */
declare module 'web-push' {
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
    payload?: string | Buffer | null,
    options?: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
}

/**
 * The pdf.js worker is imported as a MODULE rather than through
 * `new URL(..., import.meta.url)` — see the comment in
 * src/lib/underwriting/pdf.ts for why (webpack emits the URL form as a raw
 * asset, which Next then minifies as a classic script and chokes on). It
 * has no type declarations; nothing reads its shape.
 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  const workerModule: unknown;
  export default workerModule;
}
