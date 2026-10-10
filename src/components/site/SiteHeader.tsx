import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Radio } from "lucide-react";
import { Link, useLocation } from "react-router";

const LANDING_LINKS = [
  { href: "#how", label: "how it works" },
  { href: "#signals", label: "signals" },
  { href: "#formats", label: "formats" },
  { href: "#faq", label: "faq" },
];

export function SiteHeader() {
  const location = useLocation();
  const onLanding = location.pathname === "/";

  return (
    <header className="border-border bg-background/95 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link
          to="/"
          className="group flex items-center gap-2 focus-visible:ring-ring rounded-sm outline-none focus-visible:ring-2"
          aria-label="VoiceShield AI home"
        >
          <span className="bg-ok text-background flex size-6 items-center justify-center rounded-[3px]">
            <Radio className="size-4" aria-hidden />
          </span>
          <span className="text-sm font-bold tracking-tight">
            voiceshield<span className="text-ok">.ai</span>
          </span>
        </Link>

        <nav
          aria-label="Sections"
          className="text-muted-foreground ml-2 hidden items-center gap-1 text-xs md:flex"
        >
          {onLanding ? (
            LANDING_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="hover:text-foreground hover:bg-accent rounded-sm px-2 py-1.5 transition-colors"
              >
                [{link.label}]
              </a>
            ))
          ) : (
            <Link
              to="/"
              className="hover:text-foreground hover:bg-accent rounded-sm px-2 py-1.5 transition-colors"
            >
              [home]
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground hidden text-[11px] tracking-wide lg:inline">
            v1.0 · voice clones
          </span>
          <Button
            asChild
            size="sm"
            className={cn("cursor-pointer gap-1.5 text-xs font-bold tracking-wide uppercase")}
          >
            <Link to="/scan">
              run a scan
              <span aria-hidden>→</span>
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
