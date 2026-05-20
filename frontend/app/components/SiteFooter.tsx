import { APP_NAME } from "../lib/branding";
import { BrandMark } from "./BrandMark";

export function SiteFooter() {
  return (
    <footer className="w-full py-8 border-t border-black/5 bg-background mt-auto">
      <div className="flex flex-col items-center px-4 md:px-10 max-w-[1200px] mx-auto gap-2">
        <BrandMark variant="footer" />
        <p className="text-sm text-on-tertiary-container opacity-80 hover:opacity-100 transition-opacity text-center">
          © {new Date().getFullYear()} {APP_NAME || "Video2Text"}. Precision
          engineered intelligence.
        </p>
      </div>
    </footer>
  );
}
