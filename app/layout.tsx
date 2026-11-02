import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayRecon · Reconciliation",
  description:
    "Payment reconciliation for Indian freelancers and exporters paid in USD, EUR and GBP.",
};

// Without this the layout viewport defaults to ~980px on phones and the
// responsive breakpoints never match — the desktop layout shows zoomed.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Set the theme before paint to avoid a flash of the wrong theme.
const themeScript = `(function(){try{var p=new URLSearchParams(location.search).get('theme');var t=(p==='light'||p==='dark')?p:(localStorage.getItem('pma-theme')||'dark');document.documentElement.setAttribute('data-theme',t);if(p){localStorage.setItem('pma-theme',t);}}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
