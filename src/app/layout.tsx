import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "highlight.js/styles/github-dark.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE = "Lumio";
const DESC =
  "Lumio — your AI companion for thinking, writing, coding, and getting things done. A fast, beautiful AI chat app.";

export const metadata: Metadata = {
  title: { default: `${SITE} — AI Assistant`, template: `%s · ${SITE}` },
  description: DESC,
  applicationName: SITE,
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: SITE },
  openGraph: {
    title: `${SITE} — AI Assistant`,
    description: DESC,
    type: "website",
  },
  twitter: { card: "summary", title: `${SITE} — AI Assistant`, description: DESC },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

// Set the theme class before paint to avoid a flash of the wrong theme.
const themeScript = `(function(){try{var t=localStorage.getItem('lumio.theme.v1');if(t==='light'){document.documentElement.classList.remove('dark');}else{document.documentElement.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full overscroll-none">{children}</body>
    </html>
  );
}
