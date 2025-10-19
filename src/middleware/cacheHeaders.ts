import type { MiddlewareHandler } from "hono";

const isStatic = (path: string) => {
  return (
    path.startsWith("/assets/") ||
    path.endsWith(".js") ||
    path.endsWith(".css") ||
    path.endsWith(".png") ||
    path.endsWith(".jpg") ||
    path.endsWith(".jpeg") ||
    path.endsWith(".gif") ||
    path.endsWith(".svg") ||
    path.endsWith(".ico") ||
    path.endsWith(".webp") ||
    path.endsWith(".pdf")
  );
};

export const cacheHeaders: MiddlewareHandler = async (c, next) => {
  await next();

  const path = new URL(c.req.url).pathname;

  // Dynamic endpoints: disable caching to avoid edge caching of dynamic responses
  const isDynamic =
    !isStatic(path) ||
    path === "/health" ||
    path === "/healthz" ||
    path.startsWith("/bot") ||
    path.startsWith("/api");

  if (isDynamic) {
    c.header("Cache-Control", "no-store", { append: false });
    c.header("Pragma", "no-cache", { append: false });
    c.header("Expires", "0", { append: false });
    return;
  }

  // Static assets: enable long-term caching
  c.header("Cache-Control", "public, max-age=31536000, immutable", {
    append: false,
  });
};
