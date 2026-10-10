import { ShieldAlert } from "lucide-react";
import { Link } from "react-router";

export function SiteFooter() {
  return (
    <footer className="border-border mt-16 border-t">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="text-sm font-bold tracking-tight">
              voiceshield<span className="text-ok">.ai</span>
            </p>
            <p className="text-muted-foreground mt-2 max-w-sm text-xs leading-5">
              A public, in-browser voice-clone and scam-call checker. Version 1 analyses audio
              only; image, video and text detectors are on the roadmap.
            </p>
          </div>

          <div>
            <p className="text-muted-foreground mono-cap mb-2">product</p>
            <ul className="space-y-1.5 text-sm">
              <li>
                <Link to="/scan" className="hover:text-ok transition-colors">
                  run a scan
                </Link>
              </li>
              <li>
                <a href="/#how" className="hover:text-ok transition-colors">
                  how it works
                </a>
              </li>
              <li>
                <a href="/#faq" className="hover:text-ok transition-colors">
                  faq
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-muted-foreground mono-cap mb-2">privacy</p>
            <ul className="text-muted-foreground space-y-1.5 text-xs leading-5">
              <li>Files never leave your device.</li>
              <li>No accounts, no uploads, no training data.</li>
              <li>Results live in this tab only.</li>
            </ul>
          </div>
        </div>

        <div className="border-border mt-8 flex flex-col gap-3 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground flex items-center gap-2">
            <ShieldAlert className="text-warn size-4" aria-hidden />
            Detection is probabilistic, not proof. Never rely on it alone to move money.
          </p>
          <p className="text-muted-foreground">© 2026 VoiceShield AI · built for public use</p>
        </div>
      </div>
    </footer>
  );
}
