import { APP_LOGO_SRC, APP_NAME } from "../lib/branding";
import { LogoMark } from "./icons";

type Variant = "nav" | "footer";

const SIZES: Record<Variant, { img: string; text: string; fallbackIcon: string }> = {
  nav: {
    img: "h-8 w-auto",
    text: "text-2xl font-bold tracking-tight text-on-surface",
    fallbackIcon: "h-6 w-auto text-primary",
  },
  footer: {
    img: "h-10 w-auto",
    text: "text-2xl font-bold text-on-surface",
    fallbackIcon: "h-7 w-auto text-primary",
  },
};

export function BrandMark({ variant = "nav" }: { variant?: Variant }) {
  const s = SIZES[variant];
  const hasImg = APP_LOGO_SRC.trim().length > 0;
  const hasText = APP_NAME.trim().length > 0;

  if (!hasImg && !hasText) {
    return <LogoMark className={s.fallbackIcon} />;
  }

  return (
    <div className="flex items-center gap-2.5">
      {hasImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={APP_LOGO_SRC}
          alt={hasText ? APP_NAME : "Logo"}
          className={s.img}
        />
      )}
      {hasText && <span className={s.text}>{APP_NAME}</span>}
    </div>
  );
}
