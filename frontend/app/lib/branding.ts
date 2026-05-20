/**
 * Brand text shown in the nav and footer alongside the logo.
 * Set to "" to hide the text and show only the logo image.
 */
export const APP_NAME = "";

/**
 * Optional logo image. Set to a path under /public, e.g. "/logo.png".
 * Leave as "" to skip the image.
 *
 *   Rendering rules (handled in components/BrandMark.tsx):
 *     APP_LOGO_SRC + APP_NAME  → image AND text side by side
 *     APP_LOGO_SRC only        → image only
 *     APP_NAME only            → text only
 *     neither                  → default built-in SVG LogoMark
 */
export const APP_LOGO_SRC = "/logo-1.jpg";

export const APP_TAGLINE = "AI-Powered Documentation Generator";
export const APP_DESCRIPTION =
  "Transform YouTube installation videos into professional step-by-step documentation using AI.";
