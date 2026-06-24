import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SessionProvider } from '@/components/session-provider';
import { ToastProvider } from '@/components/toast';
import { getPublicBranding } from '@/lib/branding';

export async function generateMetadata(): Promise<Metadata> {
  const b = await getPublicBranding();
  return {
    title: b.productName,
    description: `${b.productName} — operations dashboard`,
    manifest: '/manifest.json',
    applicationName: b.productName,
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: b.productName,
    },
    icons: {
      icon: [
        { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
        { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      ],
      apple: [
        { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      ],
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    // Updated to match the new premium dark base (#0F1115). Browsers use
    // this to tint the mobile address bar / PWA chrome.
    { media: '(prefers-color-scheme: dark)', color: '#0F1115' },
  ],
};

/**
 * Conservative CSS color sanitizer for the tenant primary color injected into
 * a <style> tag at request time. We accept ONLY shapes that look like valid
 * color values; anything else returns null and the page falls back to the
 * default CSS token. This prevents CSS injection through the branding store.
 *
 * Accepted shapes:
 *   - HSL triple as used by the design system: "220 47% 17%" (whitespace-OK)
 *   - hex:       "#abc" or "#aabbcc"
 *   - rgb(a):    "rgb(1,2,3)" / "rgba(1,2,3,0.5)"
 *   - hsl(a):    "hsl(220,47%,17%)" / "hsla(...)"
 *   - bare color keywords up to 30 alphabetic chars
 */
function sanitizeCssColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = String(input).trim();
  if (!v || v.length > 80) return null;
  // No braces/semicolons/quotes/angle brackets/backslashes — these are the
  // characters needed to break out of a CSS property value into another rule.
  if (/[{};"'<>\\]/.test(v)) return null;
  // Allowed shapes:
  const shapes: RegExp[] = [
    /^\d{1,3}\s+\d{1,3}(?:\.\d+)?%\s+\d{1,3}(?:\.\d+)?%$/,         // HSL triple
    /^#[0-9a-fA-F]{3,8}$/,                                          // hex
    /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/,
    /^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/,
    /^[a-zA-Z]{1,30}$/,                                             // keyword
  ];
  return shapes.some((re) => re.test(v)) ? v : null;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const branding = await getPublicBranding();
  const safeColor = sanitizeCssColor(branding.primaryColor);

  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="format-detection" content="telephone=no" />
        {/* Pre-paint theme script. Defaults to LIGHT mode (JJ reverted the
            dark-default). Dark mode is still available as an opt-in via the
            sidebar toggle, but it's no longer applied unless the user has
            explicitly chosen it. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('mca-theme');var r=document.documentElement;if(t==='dark'){r.classList.add('dark');}else{r.classList.remove('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        {safeColor && (
          <style
            dangerouslySetInnerHTML={{
              __html: `:root{--primary:${safeColor};--accent:${safeColor};--ring:${safeColor};}`,
            }}
          />
        )}
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}


