import { UrlGenerator } from "./components/UrlGenerator";

export default function Home() {
  return (
    <main className="pt-32 pb-20 px-4 md:px-10 max-w-[1200px] mx-auto w-full">
      <Hero />
    </main>
  );
}

function Hero() {
  return (
    <section className="flex flex-col items-center text-center mb-8">
      <div className="inline-flex items-center px-3 py-1 rounded-full bg-surface-container-high border border-black/10 mb-6">
        <span className="font-mono text-xs text-primary uppercase tracking-widest">
          AI-Powered Documentation Generator
        </span>
      </div>
      <h1 className="text-3xl md:text-5xl font-bold tracking-tight md:tracking-tighter max-w-3xl mb-6 leading-tight">
        Transform YouTube installation videos into professional{" "}
        <span className="text-primary">step-by-step documentation</span> using
        AI.
      </h1>
      <p className="text-base text-on-surface-variant max-w-2xl mb-12">
        Stop pausing and rewinding. Let our AI watch the tutorial, extract
        high-resolution frames, and draft structured technical guides in
        seconds.
      </p>

      <UrlGenerator />
    </section>
  );
}
