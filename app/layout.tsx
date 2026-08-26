import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Val Borbera Hillclimb — Mobile Mountain Time Attack",
  description: "Climb the Ligurian Apennines above Cabella Ligure to Capanne di Cosola in this mobile-first 3D mountain driving time-attack game.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Val Borbera",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#090d16",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full bg-slate-950">
      <body className="h-full w-full overflow-hidden bg-slate-950 text-slate-100 antialiased select-none">
        {children}
      </body>
    </html>
  );
}
