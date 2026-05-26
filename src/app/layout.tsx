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
