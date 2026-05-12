import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAG تفسير الأحلام",
  description: "واجهة محلية لتجربة RAG على كتب تفسير الأحلام مع Gemini"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
