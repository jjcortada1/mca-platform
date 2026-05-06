import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '@/components/session-provider';
import { ToastProvider } from '@/components/toast';
import { getPublicBranding } from '@/lib/branding';

export async function generateMetadata(): Promise<Metadata> {
  const b = await getPublicBranding();
  return {
    title: b.productName,
    description: `${b.productName} — operations dashboard`,
    icons: b.logoUrl
      ? [{ rel: 'icon', url: b.logoUrl }]
      : [{ rel: 'icon', url: '/favicon.svg', type: 'image/svg+xml' }],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const branding = await getPublicBranding();

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
        />
        {/* Inject tenant primary color into CSS custom property */}
        <style
          dangerouslySetInnerHTML={{
            __html: `:root{--primary:${branding.primaryColor};--accent:${branding.primaryColor};--ring:${branding.primaryColor};}`,
          }}
        />
      </head>
      <body>
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
