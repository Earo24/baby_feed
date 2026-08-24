import type { Metadata, Viewport } from 'next';
import { Inspector } from 'react-dev-inspector';
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
  themeColor: '#FFF8F0',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="zh-CN">
      <body className={`antialiased`} style={{ backgroundColor: '#FFF8F0' }}>
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
