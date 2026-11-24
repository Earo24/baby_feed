import type { Metadata, Viewport } from 'next';
import { Inspector } from 'react-dev-inspector';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: '喂奶记录',
  description: '家人一起记录宝宝喂奶时间，不再遗忘',
  authors: [{ name: 'Feed Log' }],
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '喂奶记录',
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/icon-192.png',
  },
  openGraph: {
    title: '喂奶记录',
    description: '家人一起记录宝宝喂奶时间，不再遗忘',
    type: 'website',
    locale: 'zh_CN',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFF9F2' },
    { media: '(prefers-color-scheme: dark)', color: '#171310' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.NODE_ENV !== 'production';

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {isDev && <Inspector />}
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
