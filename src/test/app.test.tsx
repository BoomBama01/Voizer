// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import { InputPanel } from "@/components/scan/InputPanel";
import { WorkingPanel, type PipelineStage } from "@/components/scan/WorkingPanel";
import { DEMO_CLIPS } from "@/lib/demo/clips";
import Landing from "@/pages/Landing";
import Scan from "@/pages/Scan";

/** jsdom has no observers; components only need them not to throw. */
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function LocationProbe() {
  return <span data-testid="path">{useLocation().pathname + useLocation().search}</span>;
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.IntersectionObserver ??= ObserverStub;
  g.ResizeObserver ??= ObserverStub;
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  }
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = (() => undefined) as unknown as typeof window.scrollTo;
  window.matchMedia =
    window.matchMedia ??
    (((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList)) as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  cleanup();
});

// WaveSurfer needs a real Web Audio stack; the unit tests only care that the
// component wires up and renders its surrounding UI.
vi.mock("wavesurfer.js", () => ({
  default: {
    create: () => ({
      on: () => () => undefined,
      loadBlob: () => Promise.resolve(),
      playPause: () => Promise.resolve(),
      destroy: () => undefined,
    }),
  },
}));

vi.mock("wavesurfer.js/plugins/regions", () => ({
  default: {
    create: () => ({
      addRegion: () => undefined,
      clearRegions: () => undefined,
      destroy: () => undefined,
    }),
  },
}));

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<>{element}</>} />
        <Route path="/scan" element={<>{element}</>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("landing page", () => {
  it("renders the hero, CTAs and the required sections", () => {
    renderAt("/", <Landing />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Is that voice");
    expect(screen.getAllByRole("link", { name: /run a scan/i }).length).toBeGreaterThan(0);
    expect(document.querySelector("#how")).toBeTruthy();
    expect(document.querySelector("#signals")).toBeTruthy();
    expect(document.querySelector("#formats")).toBeTruthy();
    expect(document.querySelector("#faq")).toBeTruthy();
    expect(screen.getByText(/never sent anywhere|Nothing is uploaded/i)).toBeTruthy();
    expect(screen.getByText(/probabilistic|not proof/i)).toBeTruthy();
  });

  it("lists the three demo clips and links them to the scanner", () => {
    renderAt("/", <Landing />);
    expect(screen.getAllByRole("link", { name: /load demo/i })).toHaveLength(DEMO_CLIPS.length);
    for (const clip of DEMO_CLIPS) {
      expect(screen.getAllByText(clip.title).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("link", { name: /run the cloned-call demo/i })).toBeTruthy();
  });
});

describe("input panel", () => {
  it("renders the dropzone, recorder and demo buttons", () => {
    const onPick = vi.fn();
    const onDemo = vi.fn();
    render(
      <MemoryRouter>
        <InputPanel onPick={onPick} onDemo={onDemo} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /upload an audio file/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /start recording/i })).toBeTruthy();
    for (const clip of DEMO_CLIPS) {
      expect(screen.getByRole("button", { name: new RegExp(clip.title, "i") })).toBeTruthy();
    }
  });

  it("forwards demo clicks", () => {
    const onDemo = vi.fn();
    render(
      <MemoryRouter>
        <InputPanel onPick={vi.fn()} onDemo={onDemo} />
      </MemoryRouter>,
    );
    screen.getByRole("button", { name: /cloned bank call/i }).click();
    expect(onDemo).toHaveBeenCalledWith("cloned-call");
  });
});

describe("working panel", () => {
  it("lists every pipeline stage", () => {
    const stages: PipelineStage[] = [
      { id: "a", label: "verify container (magic bytes)", status: "done" },
      { id: "b", label: "score sliding 4-second windows", status: "active" },
      { id: "c", label: "calibrate probability + risk meter", status: "pending" },
    ];
    render(<WorkingPanel fileName="call.wav" stages={stages} progress={42} />);
    expect(screen.getByText("verify container (magic bytes)")).toBeTruthy();
    expect(screen.getByText("score sliding 4-second windows")).toBeTruthy();
    expect(screen.getByText("calibrate probability + risk meter")).toBeTruthy();
  });
});

describe("scan flow", () => {
  it("runs the cloned-call demo end to end and shows the verdict", async () => {
    render(
      <MemoryRouter initialEntries={["/scan?demo=cloned-call"]}>
        <Routes>
          <Route path="/scan" element={<Scan />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        expect(screen.getAllByText(/LIKELY AI-GENERATED/i).length).toBeGreaterThan(0);
      },
      { timeout: 15000 },
    );

    expect(screen.getAllByText(/combined risk meter/i).length).toBe(1);
    expect(screen.getAllByText(/HIGH RISK · \d+/i).length).toBe(1);
    expect(screen.getAllByText(/scam-script check/i).length).toBe(1);
    expect(screen.getAllByText(/sha-256/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/per-window synthetic probability/i).length).toBe(1);
    expect(screen.getAllByText(/AnyDesk/i).length).toBeGreaterThan(0);
  }, 30000);

  it("runs the natural voice memo demo as likely human", async () => {
    render(
      <MemoryRouter initialEntries={["/scan?demo=voice-memo"]}>
        <Routes>
          <Route path="/scan" element={<Scan />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        expect(screen.getAllByText(/LIKELY HUMAN/i).length).toBeGreaterThan(0);
      },
      { timeout: 15000 },
    );
    expect(screen.getAllByText(/SAFE · \d+/i).length).toBe(1);
    expect(screen.getAllByText(/no indicators/i).length).toBeGreaterThan(0);
  }, 30000);
});
