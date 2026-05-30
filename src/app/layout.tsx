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
    { media: '(prefers-color-scheme: dark)', color: '#0b1020' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const branding = await getPublicBranding();

  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body>
        <style
          dangerouslySetInnerHTML={{
            __html: `:root{--primary:${branding.primaryColor};--accent:${branding.primaryColor};--ring:${branding.primaryColor};}`,
          }}
        />
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
