import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PORI — Trạm Định Lượng & Quản Trị Rủi Ro Danh Mục",
  description:
    "Pori (Portfolio + Risk) — Hệ thống phân tích bối cảnh thị trường, tầm soát cổ phiếu định lượng gắn với quản trị rủi ro danh mục (VPBankS NEO API & SSI FastConnect v3).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
