"use client";
import Link from "next/link";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function TopBar() {
  const pathname = usePathname();
  const links = [
    { href: "/", label: "Overview" },
    { href: "/symbol/BTC-USD", label: "Symbols" },
    { href: "/anomalies", label: "Anomalies" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-black/30 backdrop-blur-xl [html.light_&]:border-black/10 [html.light_&]:bg-white/60">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-current">
          <Logo size={24} />
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {links.map((l) => {
            const active =
              l.href === "/"
                ? pathname === "/"
                : pathname.startsWith(l.href.split("/").slice(0, 2).join("/"));
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm transition",
                  active
                    ? "bg-white/10 text-white [html.light_&]:bg-black/5 [html.light_&]:text-black"
                    : "text-white/60 hover:text-white [html.light_&]:text-zinc-600 [html.light_&]:hover:text-black",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
