import type { ReactNode } from "react";

export const metadata = {
  title: "Notive",
  description: "Notive — Phase B scaffold",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
