import type { ReactNode } from "react";
import "@document-studio/react/styles.css";
export const metadata = { title: "Document Studio Next.js example" };
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, background: "#f5f6f7" }}>{children}</body>
    </html>
  );
}
