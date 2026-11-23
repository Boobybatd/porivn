import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pori | Portfolio-Aware Market & Risk Cockpit",
  description:
    "Pori (Portfolio + Risk) — Hệ thống phân tích bối cảnh thị trường, tầm soát cổ phiếu định lượng gắn với quản trị rủi ro danh mục.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
