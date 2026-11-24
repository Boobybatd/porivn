import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PORI — Công Cụ Định Lượng & Quản Trị Rủi Ro Danh Mục",
  description:
    "PORI (Portfolio + Risk) — Công cụ phân tích định lượng cổ phiếu, chấm điểm đa nhân tố và quản trị rủi ro danh mục chứng khoán Việt Nam (VPBankS NEO API & SSI FastConnect v3).",
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
