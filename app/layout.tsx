import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'coldmailpro emailverifier — SMTP Email Verification',
  description: 'SMTP, DNS, TLS, bulk verification, domain intelligence, monitoring, and worker analytics.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
